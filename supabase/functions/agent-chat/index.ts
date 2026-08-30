import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toolDefinitionsFor, type ToolContext } from "../_shared/agent-tools.ts";
import { isRetryableProviderError, loadProviderKey, runProviderLoop, type NormalizedMessage } from "../_shared/agent-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const MAX_HISTORY_MESSAGES = 40;

function rowsToNormalized(rows: any[]): NormalizedMessage[] {
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    toolCalls: Array.isArray(row.tool_calls) && row.tool_calls.length ? row.tool_calls : undefined,
  }));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
    const service = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw new Error("Supabase function configuration is incomplete");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await admin.from("profiles").select("organization_id,status")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active") throw new Error("Inactive profile");
    const organizationId = profile.organization_id as string;

    const body = await request.json();
    const messageText = String(body?.message || "").trim();
    if (!messageText) throw new Error("Message is required");
    if (messageText.length > 8000) throw new Error("Message is too long");

    let conversationId = body?.conversation_id ? String(body.conversation_id) : "";
    if (conversationId) {
      const { data: conversation } = await admin.from("agent_conversations")
        .select("id,organization_id").eq("id", conversationId).maybeSingle();
      if (!conversation || conversation.organization_id !== organizationId) {
        throw new Error("Conversation not found");
      }
    } else {
      const { data: conversation, error } = await admin.from("agent_conversations").insert({
        organization_id: organizationId,
        created_by: user.id,
        title: messageText.slice(0, 80),
      }).select("id").single();
      if (error) throw error;
      conversationId = conversation.id;
    }

    const { data: historyRows } = await admin.from("agent_messages")
      .select("role,content,tool_calls").eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }).limit(MAX_HISTORY_MESSAGES);

    const { data: userMessageRow, error: userMessageError } = await admin.from("agent_messages").insert({
      conversation_id: conversationId,
      organization_id: organizationId,
      role: "user",
      content: messageText,
    }).select("id,role,content,tool_calls,provider,created_at").single();
    if (userMessageError) throw userMessageError;

    const anthropicKey = await loadProviderKey(admin, organizationId, "anthropic");
    const openaiKey = await loadProviderKey(admin, organizationId, "openai");
    if (!anthropicKey && !openaiKey) {
      throw new Error("No AI provider is configured. An admin must add an API key in Settings.");
    }

    const ctx: ToolContext = {
      admin,
      organizationId,
      userId: user.id,
      conversationId,
      messageId: userMessageRow.id,
      mode: "manual",
    };
    const tools = toolDefinitionsFor("manual");
    const history = [...rowsToNormalized(historyRows || []), { role: "user", content: messageText } as NormalizedMessage];

    let outcome;
    const primaryProvider = anthropicKey ? "anthropic" : "openai";
    const primaryKey = anthropicKey || openaiKey!;
    try {
      outcome = await runProviderLoop(primaryProvider, primaryKey, history, tools, ctx);
    } catch (error) {
      const fallbackProvider = primaryProvider === "anthropic" ? "openai" : "anthropic";
      const fallbackKey = primaryProvider === "anthropic" ? openaiKey : anthropicKey;
      if (fallbackKey && isRetryableProviderError(error)) {
        outcome = await runProviderLoop(fallbackProvider, fallbackKey, history, tools, ctx);
      } else {
        throw error;
      }
    }

    const rowsToInsert = outcome.produced.map((message) => ({
      conversation_id: conversationId,
      organization_id: organizationId,
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls || null,
      provider: message.role === "assistant" ? outcome.provider : null,
    }));
    const { data: insertedRows, error: insertError } = await admin.from("agent_messages")
      .insert(rowsToInsert).select("id,role,content,tool_calls,provider,created_at");
    if (insertError) throw insertError;

    await admin.from("agent_conversations").update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    return Response.json({
      conversation_id: conversationId,
      messages: [userMessageRow, ...(insertedRows || [])],
    }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent chat error" },
      { status: 400, headers: corsHeaders },
    );
  }
});
