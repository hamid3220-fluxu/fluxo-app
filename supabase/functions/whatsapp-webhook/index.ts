import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseWhatsAppEchoMessage,
  parseWhatsAppMessage,
  safeWhatsAppStatus,
  type WhatsAppWebhookValue,
} from "./whatsapp-message.ts";
import { validMetaSignature } from "./webhook-security.ts";

// This repository does not include generated Supabase Database types.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<
      { field?: string; value?: WhatsAppWebhookValue & Record<string, unknown> }
    >;
  }>;
};

type WhatsAppIntegration = {
  id: string;
  organization_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  status: string;
};

const jsonHeaders = { "Content-Type": "application/json" };

const readSupabaseKey = (
  collectionName: string,
  singleName: string,
  legacyName: string,
): string => {
  const collection = Deno.env.get(collectionName);
  if (collection) {
    try {
      const keys = JSON.parse(collection);
      if (typeof keys.default === "string" && keys.default) return keys.default;
    } catch {
      // Fall back to the single or legacy key.
    }
  }
  return Deno.env.get(singleName) || Deno.env.get(legacyName) || "";
};

async function findIntegration(
  admin: AdminClient,
  phoneNumberId: string,
  cache: Map<string, WhatsAppIntegration | null>,
): Promise<WhatsAppIntegration | null> {
  if (cache.has(phoneNumberId)) return cache.get(phoneNumberId) || null;
  const { data, error } = await admin
    .from("whatsapp_integrations")
    .select("id,organization_id,phone_number_id,display_phone_number,status")
    .eq("phone_number_id", phoneNumberId)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw error;
  const integration = data as WhatsAppIntegration | null;
  cache.set(phoneNumberId, integration);
  return integration;
}

async function saveMessage(
  admin: AdminClient,
  integration: WhatsAppIntegration,
  direction: "inbound" | "outbound",
  parsed: ReturnType<typeof parseWhatsAppMessage>,
): Promise<boolean> {
  const { data, error } = await admin.rpc(
    "upsert_whatsapp_message_communication",
    {
      target_integration: integration.id,
      target_provider_message_id: parsed.providerMessageId,
      target_direction: direction,
      target_body: parsed.body,
      target_sender_name: parsed.senderName,
      target_sender_phone: parsed.senderPhone,
      target_recipient_phone: parsed.recipientPhone,
      target_message_type: parsed.messageType,
      target_occurred_at: parsed.occurredAt,
      target_metadata: parsed.metadata,
    },
  );
  if (error) throw error;
  return Boolean(Array.isArray(data) ? data[0]?.inserted : data?.inserted);
}

async function applyStatus(
  admin: AdminClient,
  integration: WhatsAppIntegration,
  status: NonNullable<WhatsAppWebhookValue["statuses"]>[number],
): Promise<boolean> {
  const providerStatus = safeWhatsAppStatus(status.status);
  const providerMessageId = String(status.id || "").trim();
  if (!providerStatus || !providerMessageId) return false;
  const providerError = status.errors?.[0] || null;
  const { data, error } = await admin.rpc("apply_whatsapp_message_status", {
    target_integration: integration.id,
    target_provider_message_id: providerMessageId,
    target_status: providerStatus,
    target_conversation_id: status.conversation?.id || null,
    target_error: providerError,
  });
  if (error) throw error;
  return Boolean(data);
}

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";

  if (request.method === "GET") {
    const mode = requestUrl.searchParams.get("hub.mode");
    const suppliedToken = requestUrl.searchParams.get("hub.verify_token");
    const challenge = requestUrl.searchParams.get("hub.challenge");
    if (
      mode === "subscribe" && verifyToken && suppliedToken === verifyToken &&
      challenge
    ) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Webhook verification failed", { status: 403 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: jsonHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = readSupabaseKey(
      "SUPABASE_SECRET_KEYS",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    const appSecret = Deno.env.get("META_APP_SECRET") || "";
    if (!supabaseUrl || !serviceKey || !verifyToken || !appSecret) {
      throw new Error("WhatsApp webhook configuration is incomplete");
    }

    const rawBody = await request.text();
    const signatureOk = await validMetaSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      appSecret,
    );
    if (!signatureOk) {
      return Response.json({ error: "Invalid signature" }, {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const payload = JSON.parse(rawBody) as WebhookPayload;
    if (payload.object !== "whatsapp_business_account") {
      return Response.json({ ok: true, ignored: true }, {
        headers: jsonHeaders,
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const integrationCache = new Map<string, WhatsAppIntegration | null>();
    const stats = {
      created: 0,
      duplicate: 0,
      statuses: 0,
      ignored: 0,
      errors: 0,
    };

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = String(value.metadata?.phone_number_id || "")
          .trim();
        if (!phoneNumberId) {
          stats.ignored += 1;
          continue;
        }
        const integration = await findIntegration(
          admin,
          phoneNumberId,
          integrationCache,
        );
        if (!integration) {
          stats.ignored += 1;
          continue;
        }

        if (change.field === "messages") {
          for (const message of value.messages || []) {
            try {
              const inserted = await saveMessage(
                admin,
                integration,
                "inbound",
                parseWhatsAppMessage(value, message),
              );
              stats[inserted ? "created" : "duplicate"] += 1;
            } catch (error) {
              stats.errors += 1;
              console.error("WhatsApp inbound message failed", {
                phone_number_id: phoneNumberId,
                provider_message_id: message.id || null,
                error: error instanceof Error ? error.message : "unknown",
              });
            }
          }
          for (const status of value.statuses || []) {
            try {
              if (await applyStatus(admin, integration, status)) {
                stats.statuses += 1;
              } else stats.ignored += 1;
            } catch (error) {
              stats.errors += 1;
              console.error("WhatsApp status update failed", {
                phone_number_id: phoneNumberId,
                provider_message_id: status.id || null,
                error: error instanceof Error ? error.message : "unknown",
              });
            }
          }
        } else if (change.field === "smb_message_echoes") {
          for (const message of value.message_echoes || []) {
            try {
              const inserted = await saveMessage(
                admin,
                integration,
                "outbound",
                parseWhatsAppEchoMessage(value, message),
              );
              stats[inserted ? "created" : "duplicate"] += 1;
            } catch (error) {
              stats.errors += 1;
              console.error("WhatsApp app message echo failed", {
                phone_number_id: phoneNumberId,
                provider_message_id: message.id || null,
                error: error instanceof Error ? error.message : "unknown",
              });
            }
          }
        } else {
          stats.ignored += 1;
        }
      }
    }

    return Response.json({ ok: true, ...stats }, { headers: jsonHeaders });
  } catch (error) {
    console.error("WhatsApp webhook request failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "WhatsApp webhook request failed" },
      { status: 400, headers: jsonHeaders },
    );
  }
});
