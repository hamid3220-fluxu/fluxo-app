import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { base64UrlDecode, base64UrlEncode, generateVapidKeys, sendWebPush } from "./web-push.ts";

const encoder = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const text = (value: string): Bytes => encoder.encode(value) as Bytes;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// Plays the browser: decrypts an aes128gcm push body per RFC 8291.
async function decrypt(body: Bytes, userAgent: CryptoKeyPair, authSecret: Bytes) {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const serverPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const userAgentPublic = new Uint8Array(await crypto.subtle.exportKey("raw", userAgent.publicKey));
  const serverKey = await crypto.subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, userAgent.privateKey, 256));
  const keyInfo = new Uint8Array([...text("WebPush: info\0"), ...userAgentPublic, ...serverPublic]);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  assertEquals(plain[plain.length - 1], 2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

Deno.test("sendWebPush encrypts a payload the browser can decrypt and signs a valid VAPID JWT", async () => {
  const userAgent = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const authSecret = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const subscription = {
    endpoint: "https://push.example.test/send/abc",
    p256dh: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", userAgent.publicKey))),
    auth: base64UrlEncode(authSecret),
  };
  const keys = await generateVapidKeys("https://fluxo.mentedev.pt");

  let captured: { headers: Headers; body: Bytes } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captured = { headers: new Headers(init.headers), body: init.body as Bytes };
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try {
    const message = { title: "Reminder: Hearing", body: "Starts at 09:30", url: "/?open=event:1" };
    const result = await sendWebPush(subscription, message, keys);
    assertEquals(result, { ok: true, status: 201, gone: false });

    const sent = captured!;
    assertEquals(sent.headers.get("content-encoding"), "aes128gcm");
    assertEquals(JSON.parse(await decrypt(sent.body, userAgent, authSecret)), message);

    const authorization = sent.headers.get("authorization")!;
    assertMatch(authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const [, token, publicKey] = authorization.match(/^vapid t=(\S+), k=(\S+)$/)!;
    assertEquals(publicKey, keys.publicKey);
    const [header, claims, signature] = token.split(".");
    assertEquals(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims))).aud, "https://push.example.test");
    const verifyKey = await crypto.subtle.importKey(
      "raw", base64UrlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, verifyKey, base64UrlDecode(signature), text(`${header}.${claims}`),
    );
    assertEquals(valid, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendWebPush reports expired subscriptions as gone", async () => {
  const userAgent = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const subscription = {
    endpoint: "https://push.example.test/send/expired",
    p256dh: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", userAgent.publicKey))),
    auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))),
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 410 })) as typeof fetch;
  try {
    const result = await sendWebPush(subscription, { title: "x" }, await generateVapidKeys("https://fluxo.mentedev.pt"));
    assertEquals(result, { ok: false, status: 410, gone: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});
