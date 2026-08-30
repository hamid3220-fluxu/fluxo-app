import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_APP_ID = "2088510845875579";
const GRAPH_VERSION = "v26.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type PhoneNumber = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  code_verification_status?: string;
};

const readSupabaseKey = (
  collectionName: string,
  singleName: string,
  legacyName: string,
) => {
  const collection = Deno.env.get(collectionName);
  if (collection) {
    try {
      const keys = JSON.parse(collection);
      if (typeof keys.default === "string" && keys.default) return keys.default;
    } catch {
      // Fall back to the single or legacy key below.
    }
  }
  return Deno.env.get(singleName) || Deno.env.get(legacyName) || "";
};

const safeId = (value: unknown) => {
  const id = String(value || "").trim();
  return /^\d{5,30}$/.test(id) ? id : "";
};

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function graphRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${GRAPH_URL}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  const result = await readJson(response);
  if (!response.ok) {
    const code = result?.error?.code ? ` (${result.error.code})` : "";
    throw new Error(`Meta rejected the WhatsApp request${code}`);
  }
  return result;
}

// Sends a WhatsApp text message on behalf of the org's connected number.
// Any active org member may call this (not admin-only, unlike connect) —
// callers are expected to be either the frontend (direct user action) or
// agent-execute-action forwarding an operator's own approved-action send,
// so the resulting whatsapp_messages/communications row is attributed to a
// real, already-authorized human either way.
async function handleSendMessage(
  admin: ReturnType<typeof createClient>,
  profile: { organization_id: string },
  corsHeaders: Record<string, string>,
  body: any,
) {
  const toPhone = String(body.to || "").replace(/[^0-9]/g, "");
  const messageBody = String(body.body || "").trim();
  if (toPhone.length < 8 || toPhone.length > 15) {
    throw new Error("A valid recipient phone number is required");
  }
  if (!messageBody || messageBody.length > 4096) {
    throw new Error("Message text is required");
  }

  const { data: integration, error: integrationError } = await admin
    .from("whatsapp_integrations")
    .select("id,phone_number_id,display_phone_number")
    .eq("organization_id", profile.organization_id)
    .eq("status", "connected")
    .maybeSingle();
  if (integrationError) throw integrationError;
  if (!integration) throw new Error("WhatsApp is not connected for this organization");

  const { data: tokenBundle, error: tokenError } = await admin.rpc(
    "read_whatsapp_integration_token",
    { target_integration: integration.id },
  );
  if (tokenError) throw tokenError;
  if (!tokenBundle?.access_token) throw new Error("WhatsApp access token is unavailable");

  const sendResult = await graphRequest(
    `${integration.phone_number_id}/messages`,
    String(tokenBundle.access_token),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: messageBody },
      }),
    },
  );
  const providerMessageId = sendResult?.messages?.[0]?.id;
  if (!providerMessageId) throw new Error("WhatsApp did not return a message id");

  const { data: linked, error: linkError } = await admin.rpc(
    "upsert_whatsapp_message_communication",
    {
      target_integration: integration.id,
      target_provider_message_id: providerMessageId,
      target_direction: "outbound",
      target_body: messageBody,
      target_sender_name: null,
      target_sender_phone: integration.display_phone_number || null,
      target_recipient_phone: toPhone,
      target_message_type: "text",
      target_occurred_at: new Date().toISOString(),
      target_metadata: {},
    },
  );
  if (linkError) throw linkError;

  return Response.json({
    ok: true,
    communication_id: Array.isArray(linked) ? linked[0]?.communication_id : linked?.communication_id,
  }, { headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: corsHeaders,
    });
  }

  let integrationId = "";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = readSupabaseKey(
      "SUPABASE_PUBLISHABLE_KEYS",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
    );
    const serviceKey = readSupabaseKey(
      "SUPABASE_SECRET_KEYS",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    const appSecret = Deno.env.get("META_APP_SECRET") || "";
    if (!supabaseUrl || !anonKey || !serviceKey || !appSecret) {
      throw new Error("WhatsApp integration configuration is incomplete");
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("organization_id,status,role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile || profile.status !== "active") {
      throw new Error("Inactive profile");
    }

    const body = await request.json();

    if (body?.action === "send") {
      return await handleSendMessage(admin, profile, corsHeaders, body);
    }

    if (
      !["admin", "administrator"].includes(
        String(profile.role || "").toLowerCase(),
      )
    ) {
      throw new Error(
        "Only an organization administrator can connect WhatsApp",
      );
    }

    if (body?.action !== "connect") throw new Error("Unsupported action");
    const code = String(body.code || "").trim();
    const wabaId = safeId(body.waba_id);
    const requestedPhoneNumberId = body.phone_number_id
      ? safeId(body.phone_number_id)
      : "";
    if (
      !code || code.length > 4096 || !wabaId ||
      (body.phone_number_id && !requestedPhoneNumberId)
    ) {
      throw new Error("Invalid WhatsApp signup response");
    }

    const tokenForm = new URLSearchParams({
      client_id: META_APP_ID,
      client_secret: appSecret,
      code,
    });
    const tokenResponse = await fetch(`${GRAPH_URL}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenForm,
    });
    const tokens = await readJson(tokenResponse);
    if (
      !tokenResponse.ok || typeof tokens?.access_token !== "string" ||
      !tokens.access_token
    ) {
      throw new Error("Meta authorization could not be completed");
    }
    const accessToken = tokens.access_token as string;
    const expiresIn = Number(tokens.expires_in);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    await graphRequest(`${wabaId}?fields=id,name`, accessToken);
    const phoneResult = await graphRequest(
      `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status&limit=100`,
      accessToken,
    );
    const phones = Array.isArray(phoneResult?.data)
      ? phoneResult.data as PhoneNumber[]
      : [];
    const phone = requestedPhoneNumberId
      ? phones.find((item) => item.id === requestedPhoneNumberId)
      : phones.length === 1
      ? phones[0]
      : undefined;
    if (!phone?.id) {
      throw new Error(
        phones.length > 1
          ? "More than one WhatsApp number was returned; select one number and try again"
          : "The connected WhatsApp number could not be found",
      );
    }

    const { data: existing, error: existingError } = await admin
      .from("whatsapp_integrations")
      .select("id,organization_id")
      .eq("phone_number_id", phone.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.organization_id !== profile.organization_id) {
      throw new Error(
        "This WhatsApp number is already connected to another organization",
      );
    }

    const integrationValues = {
      organization_id: profile.organization_id,
      waba_id: wabaId,
      phone_number_id: phone.id,
      display_phone_number: phone.display_phone_number || null,
      verified_name: phone.verified_name || null,
      connection_mode: "coexistence",
      status: "pending",
      connected_by: user.id,
      last_error: null,
    };
    const integrationResult = existing
      ? await admin.from("whatsapp_integrations").update(integrationValues).eq(
        "id",
        existing.id,
      ).select("id").single()
      : await admin.from("whatsapp_integrations").insert(integrationValues)
        .select("id").single();
    if (integrationResult.error || !integrationResult.data?.id) {
      throw integrationResult.error ||
        new Error("WhatsApp connection could not be saved");
    }
    integrationId = integrationResult.data.id;

    const { error: tokenError } = await admin.rpc(
      "store_whatsapp_integration_token",
      {
        target_integration: integrationId,
        access_token: accessToken,
        token_expires_at: expiresAt,
      },
    );
    if (tokenError) throw tokenError;

    await graphRequest(`${wabaId}/subscribed_apps`, accessToken, {
      method: "POST",
    });
    const connectedAt = new Date().toISOString();
    const { error: connectedError } = await admin.from("whatsapp_integrations")
      .update({
        status: "connected",
        webhook_subscribed_at: connectedAt,
        last_error: null,
      }).eq("id", integrationId);
    if (connectedError) throw connectedError;

    return Response.json({
      ok: true,
      integration: {
        id: integrationId,
        status: "connected",
        display_phone_number: phone.display_phone_number || null,
        verified_name: phone.verified_name || null,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "WhatsApp integration error";
    if (integrationId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const serviceKey = readSupabaseKey(
          "SUPABASE_SECRET_KEYS",
          "SUPABASE_SECRET_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        );
        if (supabaseUrl && serviceKey) {
          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false },
          });
          await admin.from("whatsapp_integrations").update({
            status: "error",
            last_error: message.slice(0, 500),
          }).eq("id", integrationId);
        }
      } catch {
        // Preserve the original safe error response.
      }
    }
    return Response.json({ error: message }, {
      status: 400,
      headers: corsHeaders,
    });
  }
});
