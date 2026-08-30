// Reacts automatically to a new inbound email/WhatsApp message (fired by a
// Supabase Database Webhook on communications INSERT — see
// supabase/agent-auto-triage-setup.md for the one-time dashboard wiring).
//
// Internal record-keeping (contact match/create, follow-up task, calendar
// entry) happens immediately, no approval needed. Anything that would leave
// the firm — an email or WhatsApp reply — only ever gets proposed through
// the same agent_actions approval queue the manual chat agent uses; nothing
// here can send anything on its own.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toolDefinitionsFor, type ToolContext } from "../_shared/agent-tools.ts";
import {
  AGENT_AUTO_SYSTEM_PROMPT,
  isRetryableProviderError,
  loadProviderKey,
  runProviderLoop,
} from "../_shared/agent-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-triage-secret",
};

const readSupabaseKey = (collectionName: string, singleName: string, legacyName: string) => {
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

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

async function resolveAssignee(admin: any, record: any): Promise<string | null> {
  if (record.matter_id) {
    const { data: matter } = await admin.from("matters").select("responsible_user_id")
      .eq("id", record.matter_id).maybeSingle();
    if (matter?.responsible_user_id) return matter.responsible_user_id;
  }
  if (record.communication_type === "email") {
    const { data: message } = await admin.from("email_messages").select("account_id")
      .eq("communication_id", record.id).maybeSingle();
    if (message?.account_id) {
      const { data: account } = await admin.from("email_accounts").select("user_id")
        .eq("id", message.account_id).maybeSingle();
      if (account?.user_id) return account.user_id;
    }
  }
  if (record.communication_type === "whatsapp") {
    const { data: message } = await admin.from("whatsapp_messages").select("integration_id")
      .eq("communication_id", record.id).maybeSingle();
    if (message?.integration_id) {
      const { data: integration } = await admin.from("whatsapp_integrations").select("connected_by")
        .eq("id", message.integration_id).maybeSingle();
      if (integration?.connected_by) return integration.connected_by;
    }
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const configuredSecret = Deno.env.get("AGENT_TRIAGE_SECRET") || "";
  const suppliedSecret = request.headers.get("x-agent-triage-secret") || "";
  if (!configuredSecret || !constantTimeEqual(configuredSecret, suppliedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const service = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) throw new Error("Supabase function configuration is incomplete");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const payload = await request.json();
    const record = payload?.record;
    if (
      !record || record.direction !== "inbound" ||
      !["email", "whatsapp"].includes(record.communication_type)
    ) {
      return Response.json({ skipped: true }, { headers: corsHeaders });
    }

    const assignee = await resolveAssignee(admin, record);
    if (!assignee) {
      console.error("agent-auto-triage: could not resolve an assignee", { communication_id: record.id });
      return Response.json({ skipped: true, reason: "no_assignee" }, { headers: corsHeaders });
    }

    let contactId = record.contact_id as string | null;
    if (!contactId && !record.client_id) {
      const isEmail = record.communication_type === "email";
      const { data: contact, error: contactError } = await admin.from("contacts").insert({
        organization_id: record.organization_id,
        full_name: record.sender_name || record.sender_address || "Unknown sender",
        email: isEmail ? record.sender_address : null,
        phone: isEmail ? null : record.sender_address,
        source: "manual",
        created_by: assignee,
      }).select("id").single();
      if (!contactError && contact) {
        contactId = contact.id;
        await admin.from("communications").update({ contact_id: contactId }).eq("id", record.id);
      } else if (contactError) {
        console.error("agent-auto-triage: contact auto-create failed", contactError);
      }
    }

    const senderLabel = record.sender_name || record.sender_address || "unknown sender";
    const { data: task, error: taskError } = await admin.from("tasks").insert({
      organization_id: record.organization_id,
      client_id: record.client_id || null,
      matter_id: record.matter_id || null,
      title: `New ${record.communication_type} from ${senderLabel}`.slice(0, 200),
      description: String(record.body || "").slice(0, 2000),
      assigned_to: assignee,
      created_by: assignee,
    }).select("id").single();
    if (taskError) console.error("agent-auto-triage: task auto-create failed", taskError);

    const anthropicKey = await loadProviderKey(admin, record.organization_id, "anthropic");
    const openaiKey = await loadProviderKey(admin, record.organization_id, "openai");
    if (!anthropicKey && !openaiKey) {
      return Response.json({ ok: true, task_id: task?.id, contact_id: contactId, agent_skipped: "no_provider" }, {
        headers: corsHeaders,
      });
    }

    const ctx: ToolContext = {
      admin,
      organizationId: record.organization_id,
      userId: assignee,
      conversationId: null,
      messageId: null,
      mode: "auto",
    };
    const tools = toolDefinitionsFor("auto");
    const subjectLine = record.subject ? ` — Subject: ${record.subject}` : "";
    const history = [{
      role: "user" as const,
      content: `New inbound ${record.communication_type} from ${senderLabel}${subjectLine}\n\n${record.body || ""}`,
    }];

    const primaryProvider = anthropicKey ? "anthropic" : "openai";
    const primaryKey = anthropicKey || openaiKey!;
    try {
      await runProviderLoop(primaryProvider, primaryKey, history, tools, ctx, AGENT_AUTO_SYSTEM_PROMPT);
    } catch (error) {
      const fallbackProvider = primaryProvider === "anthropic" ? "openai" : "anthropic";
      const fallbackKey = primaryProvider === "anthropic" ? openaiKey : anthropicKey;
      if (fallbackKey && isRetryableProviderError(error)) {
        await runProviderLoop(fallbackProvider, fallbackKey, history, tools, ctx, AGENT_AUTO_SYSTEM_PROMPT);
      } else {
        console.error("agent-auto-triage: model loop failed", error);
      }
    }

    return Response.json({ ok: true, task_id: task?.id, contact_id: contactId }, { headers: corsHeaders });
  } catch (error) {
    // Always 200 here: this is called by a Database Webhook with no human
    // waiting on the response, and a non-2xx just triggers pointless retries.
    console.error("agent-auto-triage error", error);
    return Response.json({
      error: error instanceof Error ? error.message : ((error as any)?.message || "Agent auto-triage error"),
    }, { status: 200, headers: corsHeaders });
  }
});
