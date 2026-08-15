import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chooseUniqueClientId,
  decideGmailImport,
  type GmailMessage,
  messageIdsFromHistory,
  parseGmailMessage,
} from "./gmail-message.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-email-sync-secret",
};
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

// This repository does not include generated Supabase Database types.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

type EmailAccount = {
  id: string;
  organization_id: string;
  user_id: string;
  connected_email: string;
  status: string;
  sync_cursor: string | null;
};

type SafeGoogleDiagnostic = {
  code: string | number | null;
  status: string | null;
  message: string;
};

type GoogleErrorPayload = {
  code?: string | number;
  status?: string;
  message?: string;
  errors?: Array<{ reason?: string }>;
};

type GoogleResponsePayload = Partial<GmailMessage> & {
  error?: GoogleErrorPayload | string;
  error_description?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  historyId?: string;
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
  history?: unknown[];
};

type AccountSyncResult = {
  ok: boolean;
  account_id: string;
  mode?: "initial" | "incremental";
  considered?: number;
  created?: number;
  linked?: number;
  skipped?: number;
  skipped_unmatched?: number;
  skipped_category?: number;
  skipped_bulk?: number;
  synced_at?: string;
  error?: string;
};

type ImportOutcome =
  | "created"
  | "linked"
  | "skipped_excluded"
  | "skipped_unmatched"
  | "skipped_category"
  | "skipped_bulk";

class SyncError extends Error {
  constructor(public code: string, public reconnectRequired = false) {
    super(code);
  }
}

class GoogleApiError extends SyncError {
  constructor(
    code: string,
    public stage: string,
    public httpStatus: number,
    public diagnostic: SafeGoogleDiagnostic,
  ) {
    super(code);
  }
}

function readSupabaseKey(
  collectionName: string,
  singleName: string,
  legacyName: string,
): string {
  const collection = Deno.env.get(collectionName);
  if (collection) {
    try {
      const keys = JSON.parse(collection);
      if (typeof keys.default === "string" && keys.default) return keys.default;
    } catch {
      // Fall back to single or legacy keys below.
    }
  }
  return Deno.env.get(singleName) || Deno.env.get(legacyName) || "";
}

function numberSetting(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

function redact(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce(
    (safe, secret) => safe.split(secret).join("[REDACTED]"),
    value,
  ).slice(0, 500);
}

function safeGoogleError(
  result: GoogleResponsePayload | null,
  secrets: string[] = [],
): SafeGoogleDiagnostic {
  const nested = result?.error && typeof result.error === "object"
    ? result.error
    : null;
  const rawCode = nested?.errors?.[0]?.reason ?? nested?.code ??
    (typeof result?.error === "string" ? result.error : null);
  const rawStatus = nested?.status ?? null;
  const rawMessage = nested?.message ?? result?.error_description ??
    (typeof result?.error === "string" ? result.error : "Unknown Google error");
  return {
    code: typeof rawCode === "string" || typeof rawCode === "number"
      ? rawCode
      : null,
    status: typeof rawStatus === "string" ? rawStatus : null,
    message: redact(
      typeof rawMessage === "string" ? rawMessage : "Unknown Google error",
      secrets,
    ),
  };
}

async function readGoogleResponse(
  response: Response,
): Promise<GoogleResponsePayload | null> {
  try {
    const result: unknown = await response.json();
    return result && typeof result === "object"
      ? result as GoogleResponsePayload
      : null;
  } catch {
    return null;
  }
}

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

async function requireGoogleReconnect(
  admin: AdminClient,
  accountId: string,
  status: "token_expired" | "permission_revoked",
  reason: string,
): Promise<never> {
  const { error } = await admin.from("email_accounts").update({
    status,
    last_error: reason,
  }).eq("id", accountId).eq("provider", "google");
  if (error) {
    console.error("Gmail sync state update failed", {
      account_id: accountId,
      sync_stage: "reconnect_state",
    });
  }
  throw new SyncError(reason, true);
}

async function refreshGoogleToken(
  admin: AdminClient,
  accountId: string,
  refreshToken: string,
): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    throw new SyncError("google_provider_not_configured");
  }
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const result = await readGoogleResponse(response);
  const diagnostic = safeGoogleError(result, [refreshToken, clientSecret]);
  if (!response.ok) {
    console.error("Gmail sync token refresh failed", {
      account_id: accountId,
      sync_stage: "token_refresh",
      http_status: response.status,
      google_error: diagnostic,
    });
    if (diagnostic.code === "invalid_grant") {
      return await requireGoogleReconnect(
        admin,
        accountId,
        "permission_revoked",
        "google_invalid_grant",
      );
    }
    throw new GoogleApiError(
      "google_token_refresh_failed",
      "token_refresh",
      response.status,
      diagnostic,
    );
  }
  const accessToken = typeof result?.access_token === "string"
    ? result.access_token
    : "";
  if (!accessToken) throw new SyncError("google_refresh_missing_access_token");
  const expiresIn = Number(result?.expires_in);
  const expiresAt = new Date(
    Date.now() +
      (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  ).toISOString();
  const newRefreshToken =
    typeof result?.refresh_token === "string" && result.refresh_token
      ? result.refresh_token
      : null;
  const { error } = await admin.rpc("store_email_account_tokens", {
    target_account: accountId,
    access_token: accessToken,
    refresh_token: newRefreshToken,
    token_expires_at: expiresAt,
  });
  if (error) throw new SyncError("google_token_persist_failed");
  return accessToken;
}

async function createGoogleRequester(
  admin: AdminClient,
  account: EmailAccount,
) {
  const { data: bundleRows, error: bundleError } = await admin.rpc(
    "read_email_token_bundle",
    { target_account: account.id },
  );
  if (bundleError) throw new SyncError("google_token_bundle_unavailable");
  const bundle = Array.isArray(bundleRows) ? bundleRows[0] : bundleRows;
  if (!bundle?.access_token) {
    throw new SyncError("google_access_token_unavailable");
  }
  let token = String(bundle.access_token);
  const refreshToken = bundle.refresh_token ? String(bundle.refresh_token) : "";
  const expiresAt = bundle.expires_at
    ? new Date(bundle.expires_at).getTime()
    : 0;
  let refreshed = false;
  if (expiresAt && expiresAt <= Date.now() + GOOGLE_REFRESH_WINDOW_MS) {
    if (!refreshToken) {
      return await requireGoogleReconnect(
        admin,
        account.id,
        "token_expired",
        "google_refresh_token_unavailable",
      );
    }
    token = await refreshGoogleToken(admin, account.id, refreshToken);
    refreshed = true;
  }

  return async (
    path: string,
    stage: string,
  ): Promise<GoogleResponsePayload | null> => {
    let response = await fetch(`${GMAIL_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let result = await readGoogleResponse(response);
    if (response.status === 401) {
      if (!refreshToken) {
        return await requireGoogleReconnect(
          admin,
          account.id,
          "token_expired",
          "google_refresh_token_unavailable",
        );
      }
      if (refreshed) {
        return await requireGoogleReconnect(
          admin,
          account.id,
          "permission_revoked",
          "google_unauthorized_after_refresh",
        );
      }
      token = await refreshGoogleToken(admin, account.id, refreshToken);
      refreshed = true;
      response = await fetch(`${GMAIL_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      result = await readGoogleResponse(response);
    }
    if (!response.ok) {
      const diagnostic = safeGoogleError(result, [token, refreshToken]);
      console.error("Gmail sync provider request failed", {
        account_id: account.id,
        sync_stage: stage,
        http_status: response.status,
        google_error: diagnostic,
      });
      if (response.status === 401) {
        return await requireGoogleReconnect(
          admin,
          account.id,
          "permission_revoked",
          "google_unauthorized_after_refresh",
        );
      }
      if (
        response.status === 403 &&
        (`${diagnostic.code} ${diagnostic.message}`).match(
          /insufficientpermissions|insufficient (authentication )?(permission|scope)/i,
        )
      ) {
        return await requireGoogleReconnect(
          admin,
          account.id,
          "permission_revoked",
          "google_gmail_read_permission_required",
        );
      }
      throw new GoogleApiError(
        `gmail_${stage}_${response.status}`,
        stage,
        response.status,
        diagnostic,
      );
    }
    return result;
  };
}

async function initialMessageIds(
  gmailRequest: (
    path: string,
    stage: string,
  ) => Promise<GoogleResponsePayload | null>,
  days: number,
  maximumMessages: number,
): Promise<{ messageIds: string[]; nextCursor: string }> {
  const profile = await gmailRequest("/profile", "profile");
  const nextCursor = String(profile?.historyId || "");
  if (!nextCursor) throw new SyncError("gmail_profile_missing_history_id");
  const messageIds: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      maxResults: String(Math.min(100, maximumMessages - messageIds.length)),
      q: `newer_than:${days}d -in:spam -in:trash -in:drafts`,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailRequest(`/messages?${params}`, "messages_list");
    for (const message of result?.messages || []) {
      const id = String(message?.id || "").trim();
      if (id && !messageIds.includes(id)) messageIds.push(id);
      if (messageIds.length >= maximumMessages) break;
    }
    pageToken = messageIds.length < maximumMessages
      ? String(result?.nextPageToken || "")
      : "";
  } while (pageToken);
  return { messageIds, nextCursor };
}

async function incrementalMessageIds(
  gmailRequest: (
    path: string,
    stage: string,
  ) => Promise<GoogleResponsePayload | null>,
  cursor: string,
): Promise<{ messageIds: string[]; nextCursor: string }> {
  const messageIds = new Set<string>();
  let pageToken = "";
  let nextCursor = cursor;
  do {
    const params = new URLSearchParams({
      startHistoryId: cursor,
      maxResults: "500",
    });
    params.append("historyTypes", "messageAdded");
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailRequest(`/history?${params}`, "history_list");
    for (const id of messageIdsFromHistory(result?.history || [])) {
      messageIds.add(id);
    }
    nextCursor = String(result?.historyId || nextCursor);
    pageToken = String(result?.nextPageToken || "");
  } while (pageToken);
  return { messageIds: [...messageIds], nextCursor };
}

async function matchedClientId(
  admin: AdminClient,
  account: EmailAccount,
  emails: string[],
): Promise<string | null> {
  for (const email of [...new Set(emails)]) {
    const { data, error } = await admin.from("clients").select("id,email").eq(
      "organization_id",
      account.organization_id,
    ).ilike("email", email);
    if (error) throw new SyncError("client_lookup_failed");
    const clientId = chooseUniqueClientId(data, email);
    if (clientId) return clientId;
  }
  return null;
}

type ExistingImportContext = {
  existingMessage: boolean;
  existingAcceptedThread: boolean;
  clientId: string | null;
  matterId: string | null;
};

async function existingImportContext(
  admin: AdminClient,
  account: EmailAccount,
  providerMessageId: string,
  providerThreadId: string | null,
): Promise<ExistingImportContext> {
  const { data: existingMessage, error: messageError } = await admin.from(
    "email_messages",
  ).select("communication_id").eq("account_id", account.id).eq(
    "provider_message_id",
    providerMessageId,
  ).maybeSingle();
  if (messageError) throw new SyncError("email_import_context_failed");
  if (existingMessage) {
    return {
      existingMessage: true,
      existingAcceptedThread: false,
      clientId: null,
      matterId: null,
    };
  }
  if (!providerThreadId) {
    return {
      existingMessage: false,
      existingAcceptedThread: false,
      clientId: null,
      matterId: null,
    };
  }
  const { data: threadMessages, error: threadError } = await admin.from(
    "email_messages",
  ).select("communication_id").eq("account_id", account.id).eq(
    "provider_thread_id",
    providerThreadId,
  );
  if (threadError) throw new SyncError("email_import_context_failed");
  const communicationIds = [
    ...new Set(
      (threadMessages || []).map((row: { communication_id?: string }) =>
        String(row.communication_id || "")
      ).filter(Boolean),
    ),
  ];
  if (!communicationIds.length) {
    return {
      existingMessage: false,
      existingAcceptedThread: false,
      clientId: null,
      matterId: null,
    };
  }
  const { data: accepted, error: acceptedError } = await admin.from(
    "communications",
  ).select("client_id,matter_id").eq(
    "organization_id",
    account.organization_id,
  ).in("id", communicationIds).not("client_id", "is", null).order(
    "occurred_at",
    { ascending: false },
  ).limit(1).maybeSingle();
  if (acceptedError) throw new SyncError("email_import_context_failed");
  return {
    existingMessage: false,
    existingAcceptedThread: Boolean(accepted?.client_id),
    clientId: accepted?.client_id ? String(accepted.client_id) : null,
    matterId: accepted?.matter_id ? String(accepted.matter_id) : null,
  };
}

async function importMessage(
  admin: AdminClient,
  account: EmailAccount,
  message: GmailMessage,
): Promise<ImportOutcome> {
  const parsed = parseGmailMessage(message, account.connected_email);
  if (parsed.skip) return "skipped_excluded";
  const existing = await existingImportContext(
    admin,
    account,
    parsed.providerMessageId,
    parsed.providerThreadId,
  );
  const clientId = await matchedClientId(
    admin,
    account,
    parsed.clientMatchEmails,
  );
  const decision = decideGmailImport(parsed, {
    clientId,
    existingMessage: existing.existingMessage,
    existingAcceptedThread: existing.existingAcceptedThread,
  });
  if (!decision.import) return `skipped_${decision.reason}` as ImportOutcome;
  const { data: rows, error } = await admin.rpc(
    "upsert_email_message_communication",
    {
      target_account: account.id,
      target_provider_message_id: parsed.providerMessageId,
      target_provider_thread_id: parsed.providerThreadId,
      target_internet_message_id: parsed.internetMessageId,
      target_direction: parsed.direction,
      target_subject: parsed.subject || null,
      target_body: parsed.body || null,
      target_sender_name: parsed.sender.name,
      target_sender_address: parsed.sender.address || null,
      target_recipient_name: parsed.recipient.name,
      target_recipient_address: parsed.recipient.address || null,
      target_cc: parsed.cc,
      target_bcc: parsed.bcc,
      target_headers: parsed.headers,
      target_occurred_at: parsed.occurredAt,
      target_status: parsed.status,
      target_is_important: parsed.isImportant,
      target_client_id: existing.clientId || clientId,
      target_matter_id: existing.matterId,
    },
  );
  if (error) throw new SyncError("email_import_transaction_failed");
  const imported = Array.isArray(rows) ? rows[0] : rows;
  if (!imported?.email_message_id) {
    throw new SyncError("email_import_result_missing");
  }
  if (parsed.attachments.length) {
    const attachments = parsed.attachments.map((attachment) => ({
      email_message_id: imported.email_message_id,
      provider_attachment_id: attachment.providerAttachmentId,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      file_size: attachment.size,
    }));
    const { error: attachmentError } = await admin.from("email_attachments")
      .upsert(attachments, {
        onConflict: "email_message_id,provider_attachment_id",
      });
    if (attachmentError) {
      throw new SyncError("email_attachment_metadata_failed");
    }
  }
  return imported.created ? "created" : "linked";
}

async function syncGoogleAccount(admin: AdminClient, account: EmailAccount) {
  const gmailRequest = await createGoogleRequester(admin, account);
  const initialDays = numberSetting("GMAIL_SYNC_INITIAL_DAYS", 30, 1, 90);
  const initialMaximum = numberSetting(
    "GMAIL_SYNC_INITIAL_MAX_MESSAGES",
    250,
    1,
    500,
  );
  let plan: { messageIds: string[]; nextCursor: string };
  let mode: "initial" | "incremental" = account.sync_cursor
    ? "incremental"
    : "initial";
  if (account.sync_cursor) {
    try {
      plan = await incrementalMessageIds(gmailRequest, account.sync_cursor);
    } catch (error) {
      if (
        !(error instanceof GoogleApiError) || error.stage !== "history_list" ||
        error.httpStatus !== 404
      ) throw error;
      mode = "initial";
      plan = await initialMessageIds(gmailRequest, initialDays, initialMaximum);
    }
  } else {
    plan = await initialMessageIds(
      gmailRequest,
      initialDays,
      initialMaximum,
    );
  }

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let skippedUnmatched = 0;
  let skippedCategory = 0;
  let skippedBulk = 0;
  const deferredMessages: GmailMessage[] = [];
  const recordOutcome = (outcome: ImportOutcome) => {
    if (outcome === "created") created++;
    else if (outcome === "linked") linked++;
    else {
      skipped++;
      if (outcome === "skipped_unmatched") skippedUnmatched++;
      if (outcome === "skipped_category") skippedCategory++;
      if (outcome === "skipped_bulk") skippedBulk++;
    }
  };
  for (const messageId of plan.messageIds) {
    try {
      const message = await gmailRequest(
        `/messages/${encodeURIComponent(messageId)}?format=full`,
        "message_get",
      );
      if (!message) throw new SyncError("gmail_message_response_empty");
      const outcome = await importMessage(admin, account, message);
      if (outcome.startsWith("skipped_") && outcome !== "skipped_excluded") {
        deferredMessages.push(message);
      } else recordOutcome(outcome);
    } catch (error) {
      if (
        error instanceof GoogleApiError && error.stage === "message_get" &&
        error.httpStatus === 404
      ) {
        skipped++;
        continue;
      }
      throw error;
    }
  }
  for (const message of deferredMessages) {
    recordOutcome(await importMessage(admin, account, message));
  }
  const syncedAt = new Date().toISOString();
  const { error: stateError } = await admin.from("email_accounts").update({
    sync_cursor: plan.nextCursor,
    last_sync_at: syncedAt,
    last_error: null,
    status: "connected",
  }).eq("id", account.id).eq("provider", "google");
  if (stateError) throw new SyncError("gmail_sync_state_persist_failed");
  return {
    account_id: account.id,
    mode,
    considered: plan.messageIds.length,
    created,
    linked,
    skipped,
    skipped_unmatched: skippedUnmatched,
    skipped_category: skippedCategory,
    skipped_bulk: skippedBulk,
    synced_at: syncedAt,
  };
}

async function recordAccountFailure(
  admin: AdminClient,
  account: EmailAccount,
  error: unknown,
): Promise<string> {
  const code = error instanceof SyncError ? error.code : "gmail_sync_failed";
  if (!(error instanceof SyncError && error.reconnectRequired)) {
    const { error: updateError } = await admin.from("email_accounts").update({
      status: "connected",
      last_error: code,
    }).eq("id", account.id).eq("provider", "google");
    if (updateError) {
      console.error("Gmail sync state update failed", {
        account_id: account.id,
        sync_stage: "failure_state",
      });
    }
  }
  console.error("Gmail account sync failed", {
    account_id: account.id,
    sync_stage: "account",
    error_code: code,
  });
  return code;
}

async function requestAccounts(
  request: Request,
  admin: AdminClient,
  anonKey: string,
  body: Record<string, unknown>,
): Promise<EmailAccount[]> {
  const configuredSecret = Deno.env.get("EMAIL_SYNC_SECRET") || "";
  const suppliedSecret = request.headers.get("x-email-sync-secret") || "";
  if (
    configuredSecret && suppliedSecret &&
    constantTimeEqual(configuredSecret, suppliedSecret)
  ) {
    let query = admin.from("email_accounts").select(
      "id,organization_id,user_id,connected_email,status,sync_cursor",
    )
      .eq("provider", "google").in("status", ["connected", "sync_error"]).not(
        "connected_email",
        "is",
        null,
      )
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(numberSetting("GMAIL_SYNC_ACCOUNT_LIMIT", 10, 1, 50));
    if (typeof body.account_id === "string" && body.account_id) {
      query = query.eq("id", body.account_id);
    }
    const { data, error } = await query;
    if (error) throw new SyncError("gmail_accounts_query_failed");
    return data || [];
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new SyncError("unauthorized");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new SyncError("unauthorized");
  const { data: profile } = await admin.from("profiles").select(
    "organization_id,status",
  ).eq("id", user.id).single();
  if (!profile || profile.status !== "active") {
    throw new SyncError("inactive_profile");
  }
  const { data, error } = await admin.from("email_accounts").select(
    "id,organization_id,user_id,connected_email,status,sync_cursor",
  )
    .eq("user_id", user.id).eq("organization_id", profile.organization_id).eq(
      "provider",
      "google",
    )
    .in("status", ["connected", "sync_error"]).not(
      "connected_email",
      "is",
      null,
    ).maybeSingle();
  if (error) throw new SyncError("gmail_account_query_failed");
  return data ? [data] : [];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, {
        status: 405,
        headers: corsHeaders,
      });
    }
    const url = Deno.env.get("SUPABASE_URL") || "";
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
    if (!url || !anonKey || !serviceKey) {
      throw new SyncError("supabase_function_configuration_incomplete");
    }
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // An empty JSON body is valid for user-triggered sync.
    }
    const accounts = await requestAccounts(request, admin, anonKey, body);
    const results: AccountSyncResult[] = [];
    for (const account of accounts) {
      try {
        results.push({ ok: true, ...await syncGoogleAccount(admin, account) });
      } catch (error) {
        results.push({
          ok: false,
          account_id: account.id,
          error: await recordAccountFailure(admin, account, error),
        });
      }
    }
    return Response.json({
      ok: results.every((result) => result.ok),
      accounts: results.length,
      results,
    }, { headers: corsHeaders });
  } catch (error) {
    const code = error instanceof SyncError ? error.code : "gmail_sync_failed";
    const status = code === "unauthorized"
      ? 401
      : code === "inactive_profile"
      ? 403
      : 400;
    return Response.json({ error: code }, { status, headers: corsHeaders });
  }
});
