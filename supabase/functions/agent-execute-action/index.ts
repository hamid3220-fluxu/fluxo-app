// Operator approve/reject endpoint for agent_actions. This is the only place
// a proposed AI-agent action can turn into a real send/write — everything
// upstream (agent-chat's propose_* tools) only ever queues a row here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function invokeFunction(baseUrl: string, anonKey: string, authorization: string, name: string, body: unknown) {
  const response = await fetch(`${baseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: authorization,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `${name} rejected the request`);
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anon = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
    const service = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anon || !service) throw new Error("Supabase function configuration is incomplete");
    const admin = createClient(supabaseUrl, service, { auth: { persistSession: false } });

    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    // `caller` acts AS the approving operator — used to perform the actual
    // write for direct-insert action types, so ordinary RLS scopes it and
    // created_by/owner_id land on this human, not the agent or a service role.
    const caller = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await admin.from("profiles").select("organization_id,status,role")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active") throw new Error("Inactive profile");
    const canApprove = ["admin", "lawyer", "administrator"].includes(
      String(profile.role || "").toLowerCase(),
    );
    if (!canApprove) throw new Error("Only an admin or lawyer can approve or reject agent actions");

    const body = await request.json();
    const actionId = String(body?.action_id || "");
    const decision = body?.decision;
    if (!actionId || !["approve", "reject"].includes(decision)) {
      throw new Error("action_id and a valid decision are required");
    }

    const { data: action, error: actionError } = await admin.from("agent_actions")
      .select("*").eq("id", actionId).single();
    if (actionError || !action) throw new Error("Action not found");
    if (action.organization_id !== profile.organization_id) throw new Error("Action not found");
    if (action.status !== "proposed") throw new Error("This action has already been decided");

    if (decision === "reject") {
      const { error } = await admin.from("agent_actions").update({
        status: "rejected",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", actionId).eq("status", "proposed");
      if (error) throw error;
      return Response.json({ ok: true, status: "rejected" }, { headers: corsHeaders });
    }

    // Atomically claim the row before doing anything real, so two operators
    // approving at once can't both trigger the side effect.
    const { data: claimed, error: claimError } = await admin.from("agent_actions").update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", actionId).eq("status", "proposed").select("*").single();
    if (claimError || !claimed) throw new Error("This action was already handled by someone else");

    const payload = claimed.payload || {};
    let result: unknown;
    try {
      switch (claimed.action_type) {
        case "send_email": {
          const { data: account } = await admin.from("email_accounts")
            .select("provider").eq("user_id", user.id).eq("status", "connected").limit(1).maybeSingle();
          if (!account) {
            throw new Error("Connect an email account in Settings before approving this send");
          }
          result = await invokeFunction(supabaseUrl, anon, authorization, "email-integration", {
            action: "send",
            provider: account.provider,
            to: payload.to,
            cc: payload.cc || undefined,
            bcc: payload.bcc || undefined,
            subject: payload.subject,
            body: payload.body,
            client_id: payload.client_id || undefined,
            matter_id: payload.matter_id || undefined,
          });
          break;
        }
        case "send_whatsapp": {
          result = await invokeFunction(supabaseUrl, anon, authorization, "whatsapp-integration", {
            action: "send",
            to: payload.to_phone,
            body: payload.body,
          });
          break;
        }
        case "create_task": {
          const { data, error } = await caller.from("tasks").insert({
            organization_id: profile.organization_id,
            title: payload.title,
            description: payload.description || null,
            client_id: payload.client_id || null,
            matter_id: payload.matter_id || null,
            due_date: payload.due_date || null,
            priority: payload.priority || "medium",
            assigned_to: payload.assigned_to || null,
            created_by: user.id,
          }).select("id").single();
          if (error) throw error;
          result = data;
          break;
        }
        case "create_calendar_event": {
          const { data, error } = await caller.from("calendar_events").insert({
            organization_id: profile.organization_id,
            owner_id: user.id,
            title: payload.title,
            description: payload.description || null,
            event_type: "meeting",
            starts_at: payload.starts_at,
            ends_at: payload.ends_at,
            all_day: false,
            timezone: payload.timezone,
            location: payload.location || null,
            client_id: payload.client_id || null,
            matter_id: payload.matter_id || null,
          }).select("id").single();
          if (error) throw error;
          result = data;
          break;
        }
        case "create_contact": {
          const { data, error } = await caller.from("contacts").insert({
            organization_id: profile.organization_id,
            full_name: payload.full_name,
            email: payload.email || null,
            phone: payload.phone || null,
            company: payload.company || null,
            source: "manual",
            created_by: user.id,
          }).select("id").single();
          if (error) throw error;
          result = data;
          break;
        }
        case "update_contact": {
          const updates: Record<string, unknown> = {};
          for (const field of ["full_name", "email", "phone", "company"] as const) {
            if (payload[field]) updates[field] = payload[field];
          }
          const { data, error } = await caller.from("contacts").update(updates)
            .eq("id", payload.contact_id).eq("organization_id", profile.organization_id)
            .select("id").single();
          if (error) throw error;
          result = data;
          break;
        }
        case "create_matter": {
          const { data, error } = await caller.from("matters").insert({
            organization_id: profile.organization_id,
            client_id: payload.client_id,
            title: payload.title,
            legal_area: payload.legal_area || null,
            description: payload.description || null,
            created_by: user.id,
          }).select("id").single();
          if (error) throw error;
          result = data;
          break;
        }
        case "update_matter": {
          const updates: Record<string, unknown> = {};
          for (const field of ["title", "status", "description"] as const) {
            if (payload[field]) updates[field] = payload[field];
          }
          const { data, error } = await caller.from("matters").update(updates)
            .eq("id", payload.matter_id).eq("organization_id", profile.organization_id)
            .select("id").single();
          if (error) throw error;
          result = data;
          break;
        }
        default:
          throw new Error(`Unknown action type: ${claimed.action_type}`);
      }
    } catch (dispatchError) {
      const message = dispatchError instanceof Error ? dispatchError.message : "Action failed";
      await admin.from("agent_actions").update({
        status: "failed",
        executed_at: new Date().toISOString(),
        error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", actionId);
      return Response.json({ error: message }, { status: 400, headers: corsHeaders });
    }

    await admin.from("agent_actions").update({
      status: "executed",
      executed_at: new Date().toISOString(),
      result: result ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", actionId);

    return Response.json({ ok: true, status: "executed", result }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent action error" },
      { status: 400, headers: corsHeaders },
    );
  }
});
