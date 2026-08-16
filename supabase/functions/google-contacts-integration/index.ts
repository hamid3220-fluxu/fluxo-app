import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/contacts.readonly'
];

type GoogleField<T> = T & { metadata?: { primary?: boolean } };
type GooglePerson = {
  resourceName?: string;
  etag?: string;
  names?: GoogleField<{ displayName?: string }>[];
  emailAddresses?: GoogleField<{ value?: string }>[];
  phoneNumbers?: GoogleField<{ value?: string }>[];
  organizations?: GoogleField<{ name?: string }>[];
};

const readSupabaseKey = (collectionName: string, singleName: string, legacyName: string) => {
  const collection = Deno.env.get(collectionName);
  if (collection) {
    try {
      const keys = JSON.parse(collection);
      if (typeof keys.default === 'string' && keys.default) return keys.default;
    } catch {
      // Fall back to the single or legacy key.
    }
  }
  return Deno.env.get(singleName) || Deno.env.get(legacyName) || '';
};

const hash = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
).map(byte => byte.toString(16).padStart(2, '0')).join('');

const normalizedEmail = (value?: string) => value?.trim().toLowerCase() || null;
const normalizedPhone = (value?: string) => value?.replace(/[^0-9]/g, '') || null;
const primaryValue = <T>(values?: GoogleField<T>[]) =>
  values?.find(value => value.metadata?.primary) || values?.[0];

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = readSupabaseKey(
      'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'
    );
    const serviceKey = readSupabaseKey(
      'SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'
    );
    const siteUrl = Deno.env.get('SITE_URL') || '';
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';

    if (!supabaseUrl || !anonKey || !serviceKey || !siteUrl) {
      throw new Error('Supabase function configuration is incomplete');
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname.endsWith('/callback')) {
      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      if (!code || !state) throw new Error('Invalid OAuth callback');

      const stateHash = await hash(state);
      const { data: savedState, error: stateError } = await admin
        .from('contact_oauth_states')
        .select('*')
        .eq('state_hash', stateHash)
        .eq('provider', 'google')
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (stateError || !savedState) throw new Error('OAuth state is invalid or expired');

      const { data: claimedState } = await admin
        .from('contact_oauth_states')
        .update({ used_at: new Date().toISOString() })
        .eq('state_hash', stateHash)
        .is('used_at', null)
        .select('state_hash')
        .single();
      if (!claimedState) throw new Error('OAuth state was already used');
      if (!clientId || !clientSecret) throw new Error('Google Contacts is not configured');

      const tokenForm = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: savedState.redirect_uri,
        grant_type: 'authorization_code'
      });
      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenForm
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) throw new Error('Google token exchange failed');

      const grantedScopes = String(tokens.scope || '').split(' ');
      if (!grantedScopes.includes('https://www.googleapis.com/auth/contacts.readonly')) {
        throw new Error('Google Contacts read permission was not granted');
      }

      const identityResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const identity = await identityResponse.json();
      if (!identityResponse.ok || !identity.sub) throw new Error('Google identity lookup failed');

      const { data: integration, error: integrationError } = await admin
        .from('contact_integrations')
        .upsert({
          organization_id: savedState.organization_id,
          user_id: savedState.user_id,
          provider: 'google',
          connected_email: identity.email || null,
          provider_account_id: identity.sub,
          status: 'connected',
          last_error: null
        }, { onConflict: 'user_id,provider' })
        .select('id')
        .single();
      if (integrationError || !integration) throw integrationError || new Error('Integration save failed');

      const expiresAt = new Date(
        Date.now() + (Number(tokens.expires_in) || 3600) * 1000
      ).toISOString();
      const { error: secretError } = await admin.rpc('store_contact_integration_tokens', {
        target_integration: integration.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expires_at: expiresAt
      });
      if (secretError) throw secretError;

      return Response.redirect(`${siteUrl}?contact_provider=google&contact_status=connected`, 302);
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new Error('Unauthorized');
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: profile } = await admin
      .from('profiles')
      .select('organization_id,status')
      .eq('id', user.id)
      .single();
    if (!profile || profile.status !== 'active') throw new Error('Inactive profile');

    const body = await request.json();

    if (body.action === 'connect') {
      if (!clientId || !clientSecret) {
        return Response.json({ status: 'not_configured' }, { headers: corsHeaders });
      }

      const state = crypto.randomUUID() + crypto.randomUUID();
      const redirectUri = `${supabaseUrl}/functions/v1/google-contacts-integration/callback`;
      const { error: saveStateError } = await admin.from('contact_oauth_states').insert({
        state_hash: await hash(state),
        organization_id: profile.organization_id,
        user_id: user.id,
        provider: 'google',
        redirect_uri: redirectUri
      });
      if (saveStateError) throw saveStateError;

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        state,
        access_type: 'offline',
        include_granted_scopes: 'true',
        prompt: 'consent'
      });
      return Response.json({
        authorization_url: `${GOOGLE_AUTHORIZE_URL}?${params}`
      }, { headers: corsHeaders });
    }

    const { data: integration, error: integrationError } = await admin
      .from('contact_integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle();
    if (integrationError) throw integrationError;

    if (body.action === 'disconnect') {
      if (integration) {
        const { error } = await admin.rpc('delete_contact_integration_tokens', {
          target_integration: integration.id
        });
        if (error) throw error;
      }
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (body.action !== 'import') throw new Error('Unsupported action');
    if (!integration || integration.status !== 'connected') {
      throw new Error('Google Contacts is not connected');
    }

    const { data: storedTokens, error: tokenReadError } = await admin.rpc(
      'read_contact_integration_tokens', { target_integration: integration.id }
    );
    if (tokenReadError || !storedTokens?.access_token) throw new Error('Google token is unavailable');

    let accessToken = storedTokens.access_token as string;
    const expiresAt = storedTokens.expires_at ? new Date(storedTokens.expires_at).getTime() : 0;
    if (expiresAt <= Date.now() + 60_000) {
      if (!storedTokens.refresh_token || !clientId || !clientSecret) {
        await admin.from('contact_integrations').update({ status: 'token_expired' }).eq('id', integration.id);
        throw new Error('Google permission has expired; reconnect Google Contacts');
      }

      const refreshForm = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: storedTokens.refresh_token,
        grant_type: 'refresh_token'
      });
      const refreshResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: refreshForm
      });
      const refreshed = await refreshResponse.json();
      if (!refreshResponse.ok || !refreshed.access_token) {
        await admin.from('contact_integrations').update({
          status: 'permission_revoked', last_error: 'Google refresh failed'
        }).eq('id', integration.id);
        throw new Error('Google permission was revoked; reconnect Google Contacts');
      }

      accessToken = refreshed.access_token;
      const refreshedExpiresAt = new Date(
        Date.now() + (Number(refreshed.expires_in) || 3600) * 1000
      ).toISOString();
      const { error: refreshStoreError } = await admin.rpc('store_contact_integration_tokens', {
        target_integration: integration.id,
        access_token: accessToken,
        refresh_token: null,
        token_expires_at: refreshedExpiresAt
      });
      if (refreshStoreError) throw refreshStoreError;
    }

    const { data: existingContacts, error: contactsError } = await admin
      .from('contacts')
      .select('id,normalized_email,normalized_phone')
      .eq('organization_id', profile.organization_id);
    if (contactsError) throw contactsError;

    const emailToContact = new Map<string, string>();
    const phoneToContact = new Map<string, string>();
    for (const contact of existingContacts || []) {
      if (contact.normalized_email) emailToContact.set(contact.normalized_email, contact.id);
      if (contact.normalized_phone) phoneToContact.set(contact.normalized_phone, contact.id);
    }

    const { data: existingLinks, error: linksError } = await admin
      .from('contact_import_links')
      .select('provider_resource_name,contact_id')
      .eq('integration_id', integration.id);
    if (linksError) throw linksError;
    const linkedResources = new Map(
      (existingLinks || []).map(link => [link.provider_resource_name, link.contact_id])
    );

    const stats = { found: 0, created: 0, matched: 0, skipped: 0 };
    let pageToken = '';
    let pageCount = 0;

    do {
      const params = new URLSearchParams({
        personFields: 'names,emailAddresses,phoneNumbers,organizations,metadata',
        pageSize: '1000',
        sources: 'READ_SOURCE_TYPE_CONTACT'
      });
      if (pageToken) params.set('pageToken', pageToken);

      const peopleResponse = await fetch(`${GOOGLE_PEOPLE_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const peopleResult = await peopleResponse.json();
      if (!peopleResponse.ok) {
        await admin.from('contact_integrations').update({
          status: peopleResponse.status === 401 ? 'token_expired' : 'import_error',
          last_error: `Google People API returned ${peopleResponse.status}`
        }).eq('id', integration.id);
        throw new Error('Google Contacts import failed');
      }

      for (const person of (peopleResult.connections || []) as GooglePerson[]) {
        stats.found += 1;
        if (!person.resourceName || linkedResources.has(person.resourceName)) {
          stats.skipped += 1;
          continue;
        }

        const email = primaryValue(person.emailAddresses)?.value?.trim() || null;
        const phone = primaryValue(person.phoneNumbers)?.value?.trim() || null;
        const emailKey = normalizedEmail(email || undefined);
        const phoneKey = normalizedPhone(phone || undefined);
        if (!emailKey && !phoneKey) {
          stats.skipped += 1;
          continue;
        }

        const emailMatch = emailKey ? emailToContact.get(emailKey) : undefined;
        const phoneMatch = phoneKey ? phoneToContact.get(phoneKey) : undefined;
        if (emailMatch && phoneMatch && emailMatch !== phoneMatch) {
          stats.skipped += 1;
          continue;
        }

        let contactId = emailMatch || phoneMatch;
        if (contactId) {
          stats.matched += 1;
        } else {
          const fullName = primaryValue(person.names)?.displayName?.trim()
            || email || phone || 'Unnamed contact';
          const company = primaryValue(person.organizations)?.name?.trim() || null;
          const { data: created, error: createError } = await admin
            .from('contacts')
            .insert({
              organization_id: profile.organization_id,
              full_name: fullName,
              email,
              phone,
              company,
              source: 'google',
              source_owner_id: user.id,
              created_by: user.id
            })
            .select('id,normalized_email,normalized_phone')
            .single();
          if (createError || !created) {
            stats.skipped += 1;
            continue;
          }
          contactId = created.id;
          if (created.normalized_email) emailToContact.set(created.normalized_email, created.id);
          if (created.normalized_phone) phoneToContact.set(created.normalized_phone, created.id);
          stats.created += 1;
        }

        const { error: linkError } = await admin.from('contact_import_links').insert({
          organization_id: profile.organization_id,
          integration_id: integration.id,
          contact_id: contactId,
          provider_resource_name: person.resourceName,
          provider_etag: person.etag || null
        });
        if (!linkError) linkedResources.set(person.resourceName, contactId);
      }

      pageToken = peopleResult.nextPageToken || '';
      pageCount += 1;
      if (pageCount >= 100 && pageToken) throw new Error('Google Contacts import exceeded the safe page limit');
    } while (pageToken);

    await admin.from('contact_integrations').update({
      status: 'connected',
      last_import_at: new Date().toISOString(),
      last_error: null
    }).eq('id', integration.id);

    return Response.json({ ok: true, ...stats }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'Google Contacts integration error'
    }, { status: 400, headers: corsHeaders });
  }
});
