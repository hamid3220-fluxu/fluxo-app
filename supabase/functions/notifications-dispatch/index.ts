// Notifications engine for FLUXO.
//
// Called two ways:
// * Every five minutes by pg_cron (header x-notifications-secret, checked
//   against the Vault secret created by the notifications migration). Each run
//   creates calendar reminders, "task due soon" alerts, and each user's daily
//   plan once their local plan time has passed.
// * By a signed-in user with {"action": "generate_day_plan"} to (re)build
//   today's plan on demand from the dashboard.
//
// Deploy with --no-verify-jwt: the cron call carries no user JWT, so user
// calls are authenticated in code instead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { completeText } from "../_shared/agent-providers.ts";
import { generateVapidKeys, sendWebPush, type VapidKeys } from "../_shared/web-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notifications-secret",
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

const DEFAULT_TIMEZONE = "Europe/Lisbon";
const MINUTE = 60_000;
const TASK_DUE_LEAD_MINUTES = 30;
const DAY_PLANS_PER_RUN = 15;

type Preferences = {
  user_id: string;
  organization_id: string;
  day_plan_enabled: boolean;
  day_plan_time: string;
  day_plan_language: "en" | "pt";
  timezone: string;
  last_day_plan_date: string | null;
};

const defaultPreferences = (userId: string, organizationId: string): Preferences => ({
  user_id: userId,
  organization_id: organizationId,
  day_plan_enabled: true,
  day_plan_time: "08:00",
  day_plan_language: "en",
  timezone: DEFAULT_TIMEZONE,
  last_day_plan_date: null,
});

// ---------------------------------------------------------------------------
// Time zone helpers (no external library: Intl does the zone math)
// ---------------------------------------------------------------------------
function safeTimeZone(timeZone: string | null | undefined) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timeZone || DEFAULT_TIMEZONE });
    return timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function localParts(instant: Date | number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Local wall-clock date + time in a zone → UTC instant (ms).
function zonedToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const local = localParts(guess, timeZone);
  const [ly, lm, ld] = local.date.split("-").map(Number);
  const [lh, lmin] = local.time.split(":").map(Number);
  const offset = Date.UTC(ly, lm - 1, ld, lh, lmin) - guess;
  return guess - offset;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function notify(
  admin: any,
  userId: string,
  organizationId: string,
  kind: string,
  title: string,
  body: string | null,
  linkType: string,
  linkId: string | null,
  dedupeKey: string,
) {
  const { error } = await admin.rpc("create_notification", {
    target_user: userId,
    target_organization: organizationId,
    target_kind: kind,
    target_title: title,
    target_body: body,
    target_link_type: linkType,
    target_link_id: linkId,
    target_dedupe_key: dedupeKey,
  });
  if (error) console.error("notifications-dispatch: create_notification failed", kind, error.message);
}

async function loadPreferencesMap(admin: any, userIds: string[]) {
  const map = new Map<string, Preferences>();
  if (!userIds.length) return map;
  const { data } = await admin.from("notification_preferences").select("*").in("user_id", userIds);
  for (const row of data || []) map.set(row.user_id, row as Preferences);
  return map;
}

// ---------------------------------------------------------------------------
// Calendar reminders
// ---------------------------------------------------------------------------
async function runEventReminders(admin: any, now: number) {
  const { data: events, error } = await admin.from("calendar_events")
    .select("id,organization_id,owner_id,title,starts_at,location,timezone,reminder_minutes_before")
    .eq("reminder_enabled", true).eq("status", "scheduled").eq("all_day", false)
    .gt("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + 7 * 24 * 60 * MINUTE).toISOString());
  if (error) throw error;
  let created = 0;
  for (const event of events || []) {
    const startsAt = new Date(event.starts_at).getTime();
    if (startsAt - (event.reminder_minutes_before || 0) * MINUTE > now) continue;
    const timeZone = safeTimeZone(event.timezone);
    const body = [`Starts at ${localParts(startsAt, timeZone).time}`, event.location].filter(Boolean).join(" · ");
    await notify(
      admin, event.owner_id, event.organization_id, "event_reminder", `Reminder: ${event.title}`, body,
      "event", event.id, `event_reminder:${event.id}:${event.starts_at}`,
    );
    created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Tasks with a due time: alert shortly before it
// ---------------------------------------------------------------------------
async function runTaskDueAlerts(admin: any, now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  const { data: tasks, error } = await admin.from("tasks")
    .select("id,organization_id,title,due_date,due_time,assigned_to")
    .in("status", ["todo", "in_progress"]).not("assigned_to", "is", null).not("due_time", "is", null)
    .gte("due_date", addDays(today, -1)).lte("due_date", addDays(today, 1));
  if (error) throw error;
  const assignees: string[] = [...new Set<string>((tasks || []).map((task: any) => String(task.assigned_to)))];
  const prefs = await loadPreferencesMap(admin, assignees);
  let created = 0;
  for (const task of tasks || []) {
    const timeZone = safeTimeZone(prefs.get(task.assigned_to)?.timezone);
    const time = String(task.due_time).slice(0, 5);
    const dueAt = zonedToUtc(task.due_date, time, timeZone);
    if (now < dueAt - TASK_DUE_LEAD_MINUTES * MINUTE || now > dueAt + 60 * MINUTE) continue;
    await notify(
      admin, task.assigned_to, task.organization_id, "task_due", `Due soon: ${task.title}`, `Due at ${time}`,
      "task", task.id, `task_due:${task.id}:${task.due_date}T${time}`,
    );
    created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Daily plan
// ---------------------------------------------------------------------------
const LANGUAGE_NAMES = { en: "English", pt: "European Portuguese" };

async function gatherDayFacts(admin: any, userId: string, organizationId: string, date: string, timeZone: string) {
  const dayStart = new Date(zonedToUtc(date, "00:00", timeZone)).toISOString();
  const dayEnd = new Date(zonedToUtc(addDays(date, 1), "00:00", timeZone)).toISOString();
  const weekEnd = new Date(zonedToUtc(addDays(date, 8), "00:00", timeZone)).toISOString();

  const [timed, allDay, deadlines, tasks, messages, actions] = await Promise.all([
    admin.from("calendar_events").select("title,event_type,starts_at,ends_at,location,clients(full_name),matters(title)")
      .eq("owner_id", userId).eq("status", "scheduled").eq("all_day", false)
      .gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
    admin.from("calendar_events").select("title,event_type,location,clients(full_name),matters(title)")
      .eq("owner_id", userId).eq("status", "scheduled").eq("all_day", true)
      .lte("all_day_start", date).gte("all_day_end", date),
    admin.from("calendar_events").select("title,starts_at,all_day_start,matters(title)")
      .eq("owner_id", userId).eq("status", "scheduled").eq("event_type", "deadline")
      .gte("starts_at", dayEnd).lt("starts_at", weekEnd).order("starts_at"),
    admin.from("tasks").select("title,priority,status,due_date,due_time,clients(full_name),matters(title)")
      .eq("organization_id", organizationId).eq("assigned_to", userId).in("status", ["todo", "in_progress"])
      .not("due_date", "is", null).lte("due_date", addDays(date, 3)).order("due_date").limit(40),
    admin.from("communications").select("communication_type,subject,body,sender_name,sender_address,is_important,occurred_at")
      .eq("organization_id", organizationId).eq("created_by", userId).eq("direction", "inbound").eq("status", "unread")
      .order("is_important", { ascending: false }).order("occurred_at", { ascending: false }).limit(15),
    admin.from("agent_actions").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("proposed_by", userId).eq("status", "proposed"),
  ]);

  const time = (value: string) => localParts(new Date(value), timeZone).time;
  const taskRows = tasks.data || [];
  const describeTask = (task: any) => ({
    title: task.title,
    priority: task.priority,
    due: task.due_date + (task.due_time ? ` ${String(task.due_time).slice(0, 5)}` : ""),
    client: task.clients?.full_name || undefined,
    matter: task.matters?.title || undefined,
  });
  return {
    date,
    events_today: [
      ...(allDay.data || []).map((event: any) => ({
        when: "all day", title: event.title, type: event.event_type, location: event.location || undefined,
        client: event.clients?.full_name || undefined, matter: event.matters?.title || undefined,
      })),
      ...(timed.data || []).map((event: any) => ({
        when: `${time(event.starts_at)}–${time(event.ends_at)}`, title: event.title, type: event.event_type,
        location: event.location || undefined, client: event.clients?.full_name || undefined,
        matter: event.matters?.title || undefined,
      })),
    ],
    overdue_tasks: taskRows.filter((task: any) => task.due_date < date).map(describeTask),
    tasks_due_today: taskRows.filter((task: any) => task.due_date === date).map(describeTask),
    tasks_next_3_days: taskRows.filter((task: any) => task.due_date > date).map(describeTask),
    deadlines_next_7_days: (deadlines.data || []).map((event: any) => ({
      title: event.title, date: localParts(new Date(event.starts_at), timeZone).date,
      matter: event.matters?.title || undefined,
    })),
    unread_messages: (messages.data || []).map((message: any) => ({
      type: message.communication_type,
      from: message.sender_name || message.sender_address,
      subject: message.subject || String(message.body || "").slice(0, 120),
      important: message.is_important || undefined,
    })),
    ai_suggestions_waiting_for_approval: actions.count || 0,
  };
}

type DayFacts = Awaited<ReturnType<typeof gatherDayFacts>>;

function isEmptyDay(facts: DayFacts) {
  return !facts.events_today.length && !facts.overdue_tasks.length && !facts.tasks_due_today.length &&
    !facts.tasks_next_3_days.length && !facts.deadlines_next_7_days.length && !facts.unread_messages.length &&
    !facts.ai_suggestions_waiting_for_approval;
}

// Used when no AI provider is configured or the call fails.
function templatePlan(facts: DayFacts) {
  if (isEmptyDay(facts)) return "Nothing is scheduled for today and no tasks are due. A good day to get ahead.";
  const lines: string[] = [];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(title, ...items.map((item) => `- ${item}`), "");
  };
  section("Today's schedule", facts.events_today.map((event: any) => `${event.when} ${event.title}`));
  section("Overdue", facts.overdue_tasks.map((task: any) => `${task.title} (due ${task.due})`));
  section("Due today", facts.tasks_due_today.map((task: any) => `${task.title} (${task.priority})`));
  section("Deadlines this week", facts.deadlines_next_7_days.map((item: any) => `${item.date} ${item.title}`));
  section("Messages to answer", facts.unread_messages.map((message: any) => `${message.from}: ${message.subject}`));
  if (facts.ai_suggestions_waiting_for_approval) {
    lines.push(`${facts.ai_suggestions_waiting_for_approval} AI suggestion(s) waiting for your approval.`);
  }
  return lines.join("\n").trim();
}

async function generateDayPlan(admin: any, prefs: Preferences, fullName: string | null, date: string) {
  const timeZone = safeTimeZone(prefs.timezone);
  const facts = await gatherDayFacts(admin, prefs.user_id, prefs.organization_id, date, timeZone);
  let content = templatePlan(facts);
  let provider: string | null = null;
  if (!isEmptyDay(facts)) {
    const system = [
      "You write the daily plan for a lawyer using FLUXO, a law firm office assistant.",
      "Use only the facts provided; never invent meetings, tasks, clients, or deadlines.",
      `Write in ${LANGUAGE_NAMES[prefs.day_plan_language] || "English"}.`,
      "Start with one short greeting line using the person's first name if given.",
      "Then these sections, in this order, skipping any that would be empty: today's schedule; priorities (a numbered list, most urgent first: overdue items, court or filing deadlines, urgent/high priority, then due today); messages to answer; coming up this week.",
      "Plain text only: section titles on their own line and '-' bullets, no markdown symbols like # or **. Use 24-hour times. Keep it under 250 words.",
    ].join(" ");
    try {
      const result = await completeText(
        admin, prefs.organization_id, system,
        `Person: ${fullName || "unknown"}\nFacts (JSON):\n${JSON.stringify(facts)}`,
      );
      if (result?.text) {
        content = result.text.trim();
        provider = result.provider;
      }
    } catch (error) {
      console.error("notifications-dispatch: AI day plan failed, using template", error);
    }
  }

  const { error } = await admin.from("day_plans").upsert({
    organization_id: prefs.organization_id,
    user_id: prefs.user_id,
    plan_date: date,
    content,
    provider,
    created_at: new Date().toISOString(),
  }, { onConflict: "user_id,plan_date" });
  if (error) throw error;

  await admin.from("notification_preferences").upsert({
    ...prefs,
    last_day_plan_date: date,
  }, { onConflict: "user_id" });

  await notify(
    admin, prefs.user_id, prefs.organization_id, "day_plan", `Your plan for ${date}`,
    content.slice(0, 300), "dashboard", null, `day_plan:${date}`,
  );
  return { plan_date: date, content, provider };
}

async function runDayPlans(admin: any, now: number) {
  const { data: profiles, error } = await admin.from("profiles").select("id,organization_id,full_name")
    .eq("status", "active").not("organization_id", "is", null);
  if (error) throw error;
  const prefs = await loadPreferencesMap(admin, (profiles || []).map((profile: any) => profile.id));
  let generated = 0;
  for (const profile of profiles || []) {
    if (generated >= DAY_PLANS_PER_RUN) break; // the rest are picked up five minutes later
    const userPrefs = prefs.get(profile.id) || defaultPreferences(profile.id, profile.organization_id);
    if (!userPrefs.day_plan_enabled) continue;
    const local = localParts(now, safeTimeZone(userPrefs.timezone));
    if (userPrefs.last_day_plan_date === local.date) continue;
    if (local.time < String(userPrefs.day_plan_time).slice(0, 5)) continue;
    try {
      await generateDayPlan(admin, userPrefs, profile.full_name, local.date);
      generated++;
    } catch (error) {
      console.error("notifications-dispatch: day plan failed for", profile.id, error);
    }
  }
  return generated;
}

// ---------------------------------------------------------------------------
// Push delivery
// ---------------------------------------------------------------------------
const PUSH_SUBJECT = "https://fluxo.mentedev.pt";
let cachedVapidKeys: VapidKeys | null = null;

// Generated once on first use and kept in Vault (see push migration).
async function loadVapidKeys(admin: any): Promise<VapidKeys> {
  if (cachedVapidKeys) return cachedVapidKeys;
  const { data: stored, error } = await admin.rpc("read_push_vapid_keys");
  if (error) throw error;
  if (stored?.publicKey) return (cachedVapidKeys = stored as VapidKeys);
  const { data: saved, error: saveError } = await admin.rpc("store_push_vapid_keys", {
    keys: await generateVapidKeys(PUSH_SUBJECT),
  });
  if (saveError) throw saveError;
  return (cachedVapidKeys = saved as VapidKeys);
}

function notificationUrl(notification: any) {
  return notification.link_type && notification.link_id
    ? `/?open=${notification.link_type}:${notification.link_id}`
    : notification.link_type === "agent" ? "/?open=agent" : "/";
}

// Sends one message to every device of a user; drops subscriptions the push
// service reports as gone. Returns how many devices accepted it.
async function pushToUser(admin: any, userId: string, message: Record<string, unknown>) {
  const { data: subscriptions } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth")
    .eq("user_id", userId);
  if (!subscriptions?.length) return { devices: 0, sent: 0 };
  const keys = await loadVapidKeys(admin);
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      const result = await sendWebPush(subscription, message, keys);
      if (result.ok) {
        sent++;
        await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", subscription.id);
      } else if (result.gone) {
        await admin.from("push_subscriptions").delete().eq("id", subscription.id);
      } else {
        console.error("notifications-dispatch: push rejected", result.status);
      }
    } catch (error) {
      console.error("notifications-dispatch: push failed", error);
    }
  }
  return { devices: subscriptions.length, sent };
}

async function deliverPush(admin: any, notificationId: string) {
  const { data: notification } = await admin.from("notifications")
    .select("id,user_id,kind,title,body,link_type,link_id,delivery").eq("id", notificationId).maybeSingle();
  if (!notification || notification.delivery?.push) return "skipped";
  // Claim it first so the trigger call and the cron retry never both send.
  const { data: claimed } = await admin.from("notifications")
    .update({ delivery: { ...notification.delivery, push: "sending" } })
    .eq("id", notificationId).filter("delivery->>push", "is", "null").select("id");
  if (!claimed?.length) return "skipped";

  const { data: prefs } = await admin.from("notification_preferences").select("channel_push")
    .eq("user_id", notification.user_id).maybeSingle();
  let outcome = "off";
  if (prefs?.channel_push) {
    const result = await pushToUser(admin, notification.user_id, {
      title: notification.title,
      body: notification.body || "",
      url: notificationUrl(notification),
      tag: notification.id,
    });
    outcome = !result.devices ? "no_devices" : result.sent ? "sent" : "failed";
  }
  await admin.from("notifications").update({ delivery: { ...notification.delivery, push: outcome } }).eq("id", notificationId);
  return outcome;
}

// Safety net for notifications whose immediate delivery call was lost.
async function retryPendingPushes(admin: any, now: number) {
  const { data: pending } = await admin.from("notifications").select("id")
    .filter("delivery->>push", "is", "null")
    .gte("created_at", new Date(now - 30 * MINUTE).toISOString()).limit(50);
  let delivered = 0;
  for (const row of pending || []) {
    if (await deliverPush(admin, row.id) === "sent") delivered++;
  }
  return delivered;
}

// ---------------------------------------------------------------------------
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
    const service = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw new Error("Supabase function configuration is incomplete");
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const body = await request.json().catch(() => ({}));
    const now = Date.now();

    const suppliedSecret = request.headers.get("x-notifications-secret");
    if (suppliedSecret) {
      const { data: expected, error } = await admin.rpc("read_notifications_cron_secret");
      if (error || !expected || suppliedSecret !== expected) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      if (body?.mode === "deliver" && body?.notification_id) {
        const push = await deliverPush(admin, String(body.notification_id));
        return Response.json({ ok: true, push }, { headers: corsHeaders });
      }
      const summary: Record<string, unknown> = {};
      for (const [name, job] of [
        ["event_reminders", runEventReminders],
        ["task_due", runTaskDueAlerts],
        ["day_plans", runDayPlans],
        ["push_retries", retryPendingPushes],
      ] as const) {
        try {
          summary[name] = await job(admin, now);
        } catch (error) {
          console.error(`notifications-dispatch: ${name} failed`, error);
          summary[name] = { error: (error as any)?.message || String(error) };
        }
      }
      return Response.json({ ok: true, ...summary }, { headers: corsHeaders });
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { data: profile } = await admin.from("profiles").select("organization_id,status,full_name")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active" || !profile.organization_id) throw new Error("Inactive profile");

    if (body?.action === "generate_day_plan") {
      const { data: stored } = await admin.from("notification_preferences").select("*").eq("user_id", user.id)
        .maybeSingle();
      const prefs = (stored as Preferences) || defaultPreferences(user.id, profile.organization_id);
      const date = localParts(now, safeTimeZone(prefs.timezone)).date;
      const plan = await generateDayPlan(admin, prefs, profile.full_name, date);
      return Response.json({ ok: true, ...plan }, { headers: corsHeaders });
    }

    if (body?.action === "push_public_key") {
      const keys = await loadVapidKeys(admin);
      return Response.json({ public_key: keys.publicKey }, { headers: corsHeaders });
    }

    if (body?.action === "push_test") {
      const result = await pushToUser(admin, user.id, {
        title: "FLUXO notifications are on",
        body: "This device will now receive reminders, new tasks and messages.",
        url: "/",
        tag: "fluxo-test",
      });
      return Response.json({ ok: true, ...result }, { headers: corsHeaders });
    }

    throw new Error("Unsupported action");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : ((error as any)?.message || "Notifications error") },
      { status: 400, headers: corsHeaders },
    );
  }
});
