// Invite a colleague to the caller's firm.
//
// Admins only. Records the invitation, creates (or reuses) the login and
// returns a one-time sign-in link for the admin to send (WhatsApp, email...).
// A link is returned instead of an email because the free Supabase email
// quota is tiny and invitations were silently not arriving. Opening the link
// signs the colleague in and FLUXO asks them to choose a password; the
// accept-team-invitation function then marks the invitation accepted.
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

    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const role = String(body?.role || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["admin", "lawyer", "staff"].includes(role)) {
      throw new Error("Invalid invitation");
    }

    const { data: inviter } = await admin.from("profiles").select("organization_id,role,status").eq("id", user.id).single();
    if (!inviter || inviter.status !== "active" || !["admin", "administrator"].includes(String(inviter.role).toLowerCase())) {
      throw new Error("Admin access required");
    }

    const existing = await findUserByEmail(admin, email);
    if (existing) {
      const { data: profile } = await admin.from("profiles").select("organization_id").eq("id", existing.id).maybeSingle();
      if (profile?.organization_id && profile.organization_id !== inviter.organization_id) {
        throw new Error("This email already has a FLUXO account in another firm");
      }
    }

    // One pending invitation per email: re-inviting replaces the old one.
    await admin.from("team_invitations").update({ status: "revoked" })
      .eq("organization_id", inviter.organization_id).eq("email", email).eq("status", "pending");
    const { data: invitation, error: insertError } = await admin.from("team_invitations")
      .insert({ organization_id: inviter.organization_id, email, role, invited_by: user.id }).select("id").single();
    if (insertError) throw insertError;

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: existing ? "magiclink" : "invite",
      email,
      options: {
        redirectTo: siteUrl,
        data: { organization_id: inviter.organization_id, role, team_invitation_id: invitation.id },
      },
    });
    if (linkError || !link?.user) {
      await admin.from("team_invitations").update({ status: "revoked" }).eq("id", invitation.id);
      throw linkError || new Error("Could not create the account");
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: link.user.id,
      organization_id: inviter.organization_id,
      email,
      full_name: email.split("@")[0],
      role,
      status: "active",
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
