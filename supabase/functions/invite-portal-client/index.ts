// Invite a firm's client to the Client Portal.
//
// Called by firm staff (any active, non-client member of the firm). Creates a
// portal login (profiles.role = 'client', linked to the client record) and
// returns a one-time sign-in link to send to the client (WhatsApp, email...).
// Opening it signs them in and FLUXO asks them to choose a password. A link
// is returned instead of sending email because the free Supabase email quota
// is tiny. Calling it again for the same client returns a fresh link.
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

async function findUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user: any) => String(user.email || "").toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
    const service = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    const siteUrl = Deno.env.get("SITE_URL") || "https://fluxo.mentedev.pt";
    if (!url || !anon || !service) throw new Error("Supabase function configuration is incomplete");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { data: staff } = await admin.from("profiles").select("organization_id,role,status").eq("id", user.id).single();
    if (!staff || staff.status !== "active" || !staff.organization_id || staff.role === "client") {
      throw new Error("Only firm staff can invite clients to the portal");
    }

    const body = await request.json().catch(() => ({}));
    const clientId = String(body?.clientId || "");
    const email = String(body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");

    const { data: client } = await admin.from("clients").select("id,full_name,organization_id")
      .eq("id", clientId).maybeSingle();
    if (!client || client.organization_id !== staff.organization_id) throw new Error("Client not found");

    const existing = await findUserByEmail(admin, email);
    if (existing) {
      const { data: profile } = await admin.from("profiles").select("organization_id,role,linked_client_id")
        .eq("id", existing.id).maybeSingle();
      const sameClient = profile?.role === "client" && profile.linked_client_id === client.id;
      if (profile && !sameClient) throw new Error("This email already has another FLUXO account");
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: existing ? "magiclink" : "invite",
      email,
      options: { redirectTo: siteUrl, data: { full_name: client.full_name } },
    });
    if (linkError || !link?.user) throw linkError || new Error("Could not create the portal account");

    const { error: profileError } = await admin.from("profiles").upsert({
      id: link.user.id,
      organization_id: client.organization_id,
      full_name: client.full_name,
      email,
      role: "client",
      linked_client_id: client.id,
      status: "active",
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    return Response.json({ ok: true, invite_link: link.properties?.action_link }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : ((error as any)?.message || "Invitation failed") },
      { status: 400, headers: corsHeaders },
    );
  }
});
