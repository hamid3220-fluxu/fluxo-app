// Platform owner tools: list firms and create a new firm with its first admin.
//
// Only users in public.platform_admins may call this. Creating a firm returns
// an invitation link for the new admin instead of sending an email: the
// built-in Supabase email service is heavily rate-limited on the free plan,
// so the owner copies the link and sends it (WhatsApp, email...). Opening it
// signs the admin in and FLUXO asks them to choose a password.
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

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function findUserByEmail(admin: any, email: string) {
  // listUsers has no email filter; page through (fine at FLUXO's scale).
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
    const { data: owner } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!owner) throw new Error("Only FLUXO platform owners can manage firms");

    const body = await request.json().catch(() => ({}));

    if (body?.action === "list") {
      const [{ data: organizations, error }, { data: profiles }] = await Promise.all([
        admin.from("organizations").select("id,name,created_at").order("created_at", { ascending: true }),
        admin.from("profiles").select("id,organization_id,full_name,email,role,status"),
      ]);
      if (error) throw error;
      const firms = (organizations || []).map((organization: any) => {
        const members = (profiles || []).filter((profile: any) => profile.organization_id === organization.id);
        return {
          id: organization.id,
          name: organization.name,
          created_at: organization.created_at,
          members: members.length,
          admins: members
            .filter((member: any) => ["admin", "administrator"].includes(String(member.role || "").toLowerCase()))
            .map((member: any) => ({ id: member.id, name: member.full_name, email: member.email })),
        };
      });
      return Response.json({ firms }, { headers: corsHeaders });
    }

    if (body?.action === "create") {
      const organizationName = String(body.organization_name || "").trim();
      const adminName = String(body.admin_name || "").trim();
      const adminEmail = String(body.admin_email || "").trim().toLowerCase();
      if (!organizationName || organizationName.length > 120) throw new Error("Enter the firm's name");
      if (!adminName || adminName.length > 120) throw new Error("Enter the administrator's name");
      if (!isEmail(adminEmail)) throw new Error("Enter a valid email address");

      const existing = await findUserByEmail(admin, adminEmail);
      if (existing) {
        const { data: profile } = await admin.from("profiles").select("organization_id").eq("id", existing.id).maybeSingle();
        if (profile?.organization_id) throw new Error("This email already has a FLUXO account in another firm");
      }

      const { data: organization, error: orgError } = await admin.from("organizations")
        .insert({ name: organizationName }).select("id,name").single();
      if (orgError) throw orgError;

      // invite for new people; magic link if the account exists without a firm.
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: existing ? "magiclink" : "invite",
        email: adminEmail,
        options: { redirectTo: siteUrl, data: { full_name: adminName } },
      });
      if (linkError || !link?.user) {
        await admin.from("organizations").delete().eq("id", organization.id);
        throw linkError || new Error("Could not create the administrator account");
      }

      const { error: profileError } = await admin.from("profiles").upsert({
        id: link.user.id,
        organization_id: organization.id,
        full_name: adminName,
        email: adminEmail,
        role: "admin",
        status: "active",
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (profileError) {
        await admin.from("organizations").delete().eq("id", organization.id);
        throw profileError;
      }

      return Response.json({
        ok: true,
        organization,
        invite_link: link.properties?.action_link,
      }, { headers: corsHeaders });
    }

    if (body?.action === "new_link") {
      // Fresh sign-in link for an admin who has not opened (or lost) theirs.
      const userId = String(body.user_id || "");
      const { data: profile } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
      if (!profile?.email) throw new Error("Administrator not found");
      const { data: link, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: profile.email,
        options: { redirectTo: siteUrl },
      });
      if (error) throw error;
      return Response.json({ ok: true, invite_link: link.properties?.action_link }, { headers: corsHeaders });
    }

    throw new Error("Unsupported action");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : ((error as any)?.message || "Platform admin error") },
      { status: 400, headers: corsHeaders },
    );
  }
});
