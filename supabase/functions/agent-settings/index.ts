import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { platformProviderKey } from "../_shared/agent-providers.ts";

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

const PROVIDERS = ["anthropic", "openai"] as const;

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

    const { data: profile } = await admin.from("profiles").select("organization_id,status,role")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active") throw new Error("Inactive profile");
    const organizationId = profile.organization_id as string;
    const isAdmin = ["admin", "administrator"].includes(String(profile.role || "").toLowerCase());

    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    if (action === "status") {
      const { data: rows, error } = await admin.from("agent_provider_credentials")
        .select("provider,status,updated_at").eq("organization_id", organizationId);
      if (error) throw error;
      const byProvider = new Map((rows || []).map((row: any) => [row.provider, row]));
      const result = PROVIDERS.map((provider) => {
        const row = byProvider.get(provider);
        if (row?.status === "configured") return row;
        if (platformProviderKey(provider)) return { provider, status: "platform_default", updated_at: null };
        return row || { provider, status: "not_configured", updated_at: null };
      });
      return Response.json({ providers: result }, { headers: corsHeaders });
    }

    if (action === "save") {
      if (!isAdmin) throw new Error("Admin access required");
      const provider = body?.provider;
      if (!PROVIDERS.includes(provider)) throw new Error("Unsupported provider");
      const apiKey = String(body?.api_key || "").trim();
      if (!apiKey || apiKey.length > 500) throw new Error("A valid API key is required");

      const { data: credential, error: credentialError } = await admin
        .from("agent_provider_credentials")
        .upsert({
          organization_id: organizationId,
          provider,
          configured_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id,provider" })
        .select("id").single();
      if (credentialError) throw credentialError;

      const { error: storeError } = await admin.rpc("store_agent_provider_key", {
        target_credential: credential.id,
        api_key: apiKey,
      });
      if (storeError) {
        await admin.from("agent_provider_credentials").update({
          status: "error",
          last_error: storeError.message.slice(0, 500),
        }).eq("id", credential.id);
        throw storeError;
      }

      await admin.from("agent_provider_credentials").update({
        status: "configured",
        last_error: null,
      }).eq("id", credential.id);

      return Response.json({ ok: true, provider, status: "configured" }, { headers: corsHeaders });
    }

    throw new Error("Unsupported action");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : ((error as any)?.message || "Agent settings error") },
      { status: 400, headers: corsHeaders },
    );
  }
});
