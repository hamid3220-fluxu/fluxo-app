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
  day_plan_language: "pt",
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

// "today" covers what is left of the current day, "tomorrow" the next day,
// "week" the seven days starting today.
type PlanRange = "today" | "tomorrow" | "week";
// "me": the person's own tasks, events and messages. "firm": everyone's —
// an overview for admins.
type PlanScope = "me" | "firm";

function planWindow(range: PlanRange, today: string) {
  if (range === "tomorrow") return { start: addDays(today, 1), days: 1, period: "day" as const };
  if (range === "week") return { start: today, days: 7, period: "week" as const };
  return { start: today, days: 1, period: "day" as const };
}

async function gatherPlanFacts(
  admin: any, userId: string, organizationId: string, start: string, days: number, timeZone: string, now: number,
  scope: PlanScope = "me",
) {
  const firm = scope === "firm";
  // Personal plans filter to the user; firm plans cover the whole organisation.
  const own = (query: any, column: string) => firm ? query : query.eq(column, userId);
  const events = () => admin.from("calendar_events").select(
    "title,event_type,starts_at,ends_at,location,all_day_start,owner_id,clients(full_name),matters(title)",
  ).eq("organization_id", organizationId).eq("status", "scheduled");
  const end = addDays(start, days); // exclusive
  const nowLocal = localParts(now, timeZone);
  const startsToday = start === nowLocal.date;
  const rangeStart = new Date(zonedToUtc(start, "00:00", timeZone)).toISOString();
  const rangeEnd = new Date(zonedToUtc(end, "00:00", timeZone)).toISOString();
  const afterEnd = new Date(zonedToUtc(addDays(end, 7), "00:00", timeZone)).toISOString();
  // Today's plan skips events that have already finished.
  const visibleFrom = startsToday ? new Date(now).toISOString() : rangeStart;

  const [timed, allDay, laterDeadlines, tasks, messages, actions, people] = await Promise.all([
    own(events(), "owner_id").eq("all_day", false)
      .lt("starts_at", rangeEnd).gt("ends_at", visibleFrom).order("starts_at"),
    own(events(), "owner_id").eq("all_day", true)
      .lt("all_day_start", end).gte("all_day_end", start),
    own(events(), "owner_id").eq("event_type", "deadline")
      .gte("starts_at", rangeEnd).lt("starts_at", afterEnd).order("starts_at"),
    own(admin.from("tasks").select(
      "title,priority,status,due_date,due_time,clients(full_name),matters(title),assigned:profiles!tasks_assigned_to_fkey(full_name)",
    ), "assigned_to")
      .eq("organization_id", organizationId).in("status", ["todo", "in_progress"])
      .not("due_date", "is", null).lt("due_date", addDays(end, 3)).order("due_date").limit(firm ? 150 : 60),
    own(admin.from("communications").select("communication_type,subject,body,sender_name,sender_address,is_important,occurred_at"), "created_by")
      .eq("organization_id", organizationId).eq("direction", "inbound").eq("status", "unread")
      .order("is_important", { ascending: false }).order("occurred_at", { ascending: false }).limit(firm ? 25 : 15),
    own(admin.from("agent_actions").select("id", { count: "exact", head: true }), "proposed_by")
      .eq("organization_id", organizationId).eq("status", "proposed"),
    firm
      ? admin.from("profiles").select("id,full_name").eq("organization_id", organizationId)
      : Promise.resolve({ data: [] }),
  ]);
  const personName = new Map((people.data || []).map((person: any) => [person.id, person.full_name || "Unnamed"]));

  const local = (value: string) => localParts(new Date(value), timeZone);
  const taskRows = tasks.data || [];
  const describeTask = (task: any) => ({
    title: task.title,
    priority: task.priority,
    due: task.due_date + (task.due_time ? ` ${String(task.due_time).slice(0, 5)}` : ""),
    client: task.clients?.full_name || undefined,
    matter: task.matters?.title || undefined,
    assigned_to: firm ? (task.assigned?.full_name || "Unassigned") : undefined,
  });
  const eventOwner = (event: any) => firm ? personName.get(event.owner_id) || undefined : undefined;
  const eventList: { day: string; when: string; [key: string]: unknown }[] = [
    ...(allDay.data || []).map((event: any) => ({
      day: event.all_day_start < start ? start : event.all_day_start, when: "all day", title: event.title,
      type: event.event_type, location: event.location || undefined, person: eventOwner(event),
      client: event.clients?.full_name || undefined, matter: event.matters?.title || undefined,
    })),
    ...(timed.data || []).map((event: any) => ({
      day: local(event.starts_at).date, when: `${local(event.starts_at).time}–${local(event.ends_at).time}`,
      title: event.title, type: event.event_type, location: event.location || undefined, person: eventOwner(event),
      client: event.clients?.full_name || undefined, matter: event.matters?.title || undefined,
    })),
  ].sort((a, b) => `${a.day} ${a.when}`.localeCompare(`${b.day} ${b.when}`));
  return {
    period: days === 1 ? (startsToday ? "rest of today" : "one day") : `${days} days`,
    from: start,
    to: addDays(end, -1),
    scope: firm ? "whole firm" : "personal",
    now: startsToday ? nowLocal.time : undefined,
    events: eventList,
    overdue_tasks: taskRows.filter((task: any) => task.due_date < start).map(describeTask),
    tasks_due_in_period: taskRows.filter((task: any) => task.due_date >= start && task.due_date < end).map(describeTask),
    tasks_due_soon_after: taskRows.filter((task: any) => task.due_date >= end).map(describeTask),
    deadlines_after_period: (laterDeadlines.data || []).map((event: any) => ({
      title: event.title, date: local(event.starts_at).date, matter: event.matters?.title || undefined,
      person: eventOwner(event),
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

type PlanFacts = Awaited<ReturnType<typeof gatherPlanFacts>>;

function isEmptyPlan(facts: PlanFacts) {
  return !facts.events.length && !facts.overdue_tasks.length && !facts.tasks_due_in_period.length &&
    !facts.tasks_due_soon_after.length && !facts.deadlines_after_period.length && !facts.unread_messages.length &&
    !facts.ai_suggestions_waiting_for_approval;
}

// Used when no AI provider is configured or the call fails.
function templatePlan(facts: PlanFacts) {
  if (isEmptyPlan(facts)) return `Nothing is scheduled and no tasks are due (${facts.period}). A good moment to get ahead.`;
  const lines: string[] = [];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(title, ...items.map((item) => `- ${item}`), "");
  };
  section("Schedule", facts.events.map((event: any) => `${event.day} ${event.when} ${event.title}`));
  section("Overdue", facts.overdue_tasks.map((task: any) => `${task.title} (due ${task.due})`));
  section("Due in this period", facts.tasks_due_in_period.map((task: any) => `${task.title} (${task.due}, ${task.priority})`));
  section("Coming up", facts.deadlines_after_period.map((item: any) => `${item.date} ${item.title}`));
  section("Messages to answer", facts.unread_messages.map((message: any) => `${message.from}: ${message.subject}`));
  if (facts.ai_suggestions_waiting_for_approval) {
    lines.push(`${facts.ai_suggestions_waiting_for_approval} AI suggestion(s) waiting for your approval.`);
  }
  return lines.join("\n").trim();
}

function planInstructions(range: PlanRange, language: string, scope: PlanScope = "me") {
  const shape = range === "week"
    ? "This is a plan for the next seven days. Sections, skipping any that would be empty: schedule grouped by day (weekday and date as the heading); priorities for the week (numbered, most urgent first: overdue items, court or filing deadlines, urgent/high priority); messages to answer; coming up after this week. Keep it under 250 words."
    : range === "tomorrow"
    ? "This is a plan for tomorrow, read the evening before. Sections, skipping any that would be empty: tomorrow's schedule; priorities (numbered, most urgent first: overdue items, deadlines, urgent/high priority, then due tomorrow); things to prepare tonight or first thing; messages to answer; coming up later. Keep it under 170 words."
    : "This is a plan for the rest of today; 'now' is the current local time and finished events are already excluded. Sections, skipping any that would be empty: what is left today; priorities (numbered, most urgent first: overdue items, deadlines, urgent/high priority, then due today); messages to answer; coming up. If little time is left in the day, say so and suggest what to move to tomorrow. Keep it under 170 words.";
  const firmNote = scope === "firm"
    ? "This is a firm-wide overview for the managing partner, covering every team member (see 'assigned_to' and 'person'). Group priorities by person, call out unassigned tasks and anyone who looks overloaded or has overdue work, and suggest reassignments where it would help."
    : "";
  return [
    "You write plans for a lawyer using FLUXO, a law firm office assistant.",
    firmNote,
    "Use only the facts provided; never invent meetings, tasks, clients, or deadlines.",
    `Write in ${language}.`,
    "The first line is shown on its own when the plan is minimised: make it one short sentence that greets the person by first name (if given) and sums up the load, e.g. 'Good evening Ana: 2 meetings, 1 court deadline and 3 overdue tasks tomorrow.'",
    "Be brief and scannable: at most 4 bullets per section, one line each, most important first; if more items exist, end the section with one bullet like '+3 more lower-priority tasks'. Skip pleasantries and advice that is not specific to the facts.",
    shape,
    "Plain text only: section titles on their own line and '-' bullets, no markdown symbols like # or **. Use 24-hour times.",
  ].join(" ");
}

// The scheduled morning run passes scheduled = true: it records the day as
// done and sends the "Your plan" notification. On-demand plans do neither, so
// generating tomorrow's plan in the evening never blocks tomorrow's morning plan.
async function generateDayPlan(
  admin: any, prefs: Preferences, fullName: string | null, range: PlanRange, now: number, scheduled: boolean,
  scope: PlanScope = "me",
) {
  const timeZone = safeTimeZone(prefs.timezone);
  const today = localParts(now, timeZone).date;
  const window = planWindow(range, today);
  const facts = await gatherPlanFacts(
    admin, prefs.user_id, prefs.organization_id, window.start, window.days, timeZone, now, scope,
  );
  let content = templatePlan(facts);
  let provider: string | null = null;
  if (!isEmptyPlan(facts)) {
    try {
      const result = await completeText(
        admin, prefs.organization_id, planInstructions(range, LANGUAGE_NAMES[prefs.day_plan_language] || "English", scope),
        `Person: ${fullName || "unknown"}\nFacts (JSON):\n${JSON.stringify(facts)}`,
      );
      if (result?.text) {
        content = result.text.trim();
        provider = result.provider;
      }
    } catch (error) {
      console.error("notifications-dispatch: AI plan failed, using template", error);
    }
  }

  const createdAt = new Date().toISOString();
  const { error } = await admin.from("day_plans").upsert({
    organization_id: prefs.organization_id,
    user_id: prefs.user_id,
    plan_date: window.start,
    period: window.period,
    scope,
    content,
    provider,
    created_at: createdAt,
  }, { onConflict: "user_id,plan_date,period,scope" });
  if (error) throw error;

  if (scheduled && scope === "me") {
    await admin.from("notification_preferences").upsert({
      ...prefs,
      last_day_plan_date: window.start,
    }, { onConflict: "user_id" });
    await notify(
      admin, prefs.user_id, prefs.organization_id, "day_plan", `Your plan for ${window.start}`,
      content.slice(0, 300), "dashboard", null, `day_plan:${window.start}`,
    );
  }
  return { range, scope, plan_date: window.start, period: window.period, content, provider, created_at: createdAt };
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
      await generateDayPlan(admin, userPrefs, profile.full_name, "today", now, true);
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
    const { data: profile } = await admin.from("profiles").select("organization_id,status,full_name,role")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active" || !profile.organization_id) throw new Error("Inactive profile");

    if (body?.action === "generate_day_plan") {
      const { data: stored } = await admin.from("notification_preferences").select("*").eq("user_id", user.id)
        .maybeSingle();
      const prefs = (stored as Preferences) || defaultPreferences(user.id, profile.organization_id);
      const range: PlanRange = ["today", "tomorrow", "week"].includes(body?.range) ? body.range : "today";
      const scope: PlanScope = body?.scope === "firm" ? "firm" : "me";
      const isAdmin = ["admin", "administrator"].includes(String(profile.role || "").toLowerCase());
      if (scope === "firm" && !isAdmin) throw new Error("Only admins can see the firm-wide plan");
      const plan = await generateDayPlan(admin, prefs, profile.full_name, range, now, false, scope);
      return Response.json({ ok: true, ...plan }, { headers: corsHeaders });
    }

    if (body?.action === "push_public_key") {
      const keys = await loadVapidKeys(admin);
      return Response.json({ public_key: keys.publicKey }, { headers: corsHeaders });
    }

    if (body?.action === "push_test") {
      const { data: languagePrefs } = await admin.from("notification_preferences").select("language")
        .eq("user_id", user.id).maybeSingle();
      const english = languagePrefs?.language === "en";
      const result = await pushToUser(admin, user.id, {
        title: english ? "FLUXO notifications are on" : "As notificações do FLUXO estão ativas",
        body: english
          ? "This device will now receive reminders, new tasks and messages."
          : "Este dispositivo vai passar a receber lembretes, novas tarefas e mensagens.",
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
