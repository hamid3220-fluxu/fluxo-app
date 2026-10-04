// Minimal Web Push sender (VAPID, RFC 8292 + aes128gcm payload encryption,
// RFC 8291) on top of WebCrypto, so it runs in Supabase Edge Functions with
// no third-party library.

export type VapidKeys = {
  publicKey: string; // base64url, uncompressed P-256 point (65 bytes)
  privateJwk: JsonWebKey;
  subject: string; // mailto: or https: contact for push services
};

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };

const encoder = new TextEncoder();

// Byte arrays backed by a plain ArrayBuffer, as WebCrypto requires.
type Bytes = Uint8Array<ArrayBuffer>;
const text = (value: string): Bytes => encoder.encode(value) as Bytes;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Bytes {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((total, part) => total + part.length, 0)));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: base64UrlEncode(publicRaw), privateJwk, subject };
}

async function vapidAuthorization(endpoint: string, keys: VapidKeys): Promise<string> {
  const header = base64UrlEncode(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(text(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })));
  const signingKey = await crypto.subtle.importKey(
    "jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  // WebCrypto returns the raw r||s signature, which is exactly what JWS ES256 uses.
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, signingKey, text(`${header}.${claims}`),
  ));
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// RFC 8291: encrypt one payload for one subscription (single aes128gcm record).
async function encryptPayload(subscription: PushSubscriptionRow, payload: Bytes) {
  const userAgentPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);

  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const userAgentKey = await crypto.subtle.importKey("raw", userAgentPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: userAgentKey }, ephemeral.privateKey, 256,
  ));

  const keyInfo = concat(text("WebPush: info\0"), userAgentPublic, serverPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const contentKey = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record; no extra padding.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, aesKey, concat(payload, Uint8Array.of(2)),
  ));

  const recordSize = new Uint8Array(new ArrayBuffer(4));
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, Uint8Array.of(serverPublic.length), serverPublic, ciphertext);
}

export type PushResult = { ok: boolean; status: number; gone: boolean };

export async function sendWebPush(
  subscription: PushSubscriptionRow,
  message: Record<string, unknown>,
  keys: VapidKeys,
): Promise<PushResult> {
  const body = await encryptPayload(subscription, text(JSON.stringify(message)));
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 60 * 60),
      Urgency: "high",
    },
    body,
  });
  await response.body?.cancel();
  // 404/410: the browser unsubscribed or the subscription expired.
  return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
}
