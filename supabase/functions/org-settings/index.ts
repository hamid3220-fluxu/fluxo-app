// Admin-only organisation branding save. Goes through the service-role
// client instead of relying on client-side Storage RLS for the logo upload,
// which turned out to be a much less reliable path than the other
// admin-gated writes in this codebase (agent-settings, whatsapp-integration).
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

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

    const { data: profile } = await admin.from("profiles").select("organization_id,status,role")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active") throw new Error("Inactive profile");
    const isAdmin = ["admin", "administrator"].includes(String(profile.role || "").toLowerCase());
    if (!isAdmin) throw new Error("Admin access required");

    const body = await request.json();
    if (!["save", "reset"].includes(body?.action)) throw new Error("Unsupported action");

    if (body.action === "reset") {
      const { error: resetError } = await admin.from("organizations")
        .update({ name: null, logo_url: null }).eq("id", profile.organization_id);
      if (resetError) throw resetError;
      return Response.json({ ok: true, name: null, logo_url: null }, { headers: corsHeaders });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string") updates.name = body.name.trim();

    if (body.logo_base64 && body.logo_extension) {
      const bytes = base64ToBytes(String(body.logo_base64));
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Logo must be under 5MB");
      const ext = String(body.logo_extension).replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
      const path = `${profile.organization_id}/logo.${ext}`;
      const { error: uploadError } = await admin.storage.from("org-assets").upload(path, bytes, {
        upsert: true,
        contentType: String(body.logo_content_type || "image/png"),
      });
      if (uploadError) throw uploadError;
      const { data: pub } = admin.storage.from("org-assets").getPublicUrl(path);
      updates.logo_url = `${pub.publicUrl}?t=${Date.now()}`;
    }

    if (Object.keys(updates).length === 0) throw new Error("Nothing to save");

    const { error: updateError } = await admin.from("organizations").update(updates)
      .eq("id", profile.organization_id);
    if (updateError) throw updateError;

    return Response.json({ ok: true, ...updates }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Organisation settings error" },
      { status: 400, headers: corsHeaders },
    );
  }
});
