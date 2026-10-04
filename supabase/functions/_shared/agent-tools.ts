// Shared tool schema + dispatcher for the FLUXO AI Agent, used by both
// agent-chat (manual mode) and agent-auto-triage (auto mode).
//
// SAFETY INVARIANT: propose_send_email/propose_send_whatsapp — offered in
// BOTH modes — do nothing but insert a row into agent_actions with
// status='proposed' and return a pending-approval acknowledgment. Neither
// ever calls email-integration or whatsapp-integration directly. The only
// way a proposed send becomes real is a human operator approving it through
// agent-execute-action, a separate, role-gated function. Do not add a tool
// that sends something directly — that would defeat the entire approval
// requirement this feature exists to satisfy.
//
// The other write tools (propose_create_task/create_calendar_event/etc. in
// manual mode; create_calendar_event/generate_document in auto mode) are
// internal record-keeping, which the user explicitly asked to run without an
// approval step — manual mode still queues them for consistency/audit in the
// chat UI, auto mode executes them immediately. toolDefinitionsFor() below
// is what actually decides which tools a given mode's model call can see.

import { buildDocumentFile } from "./generate-document.ts";

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolContext = {
  admin: any; // service-role Supabase client
  organizationId: string;
  // The human this turn is attributed to: the chatting operator in 'manual'
  // mode, or the resolved assignee (matter's responsible lawyer / channel
  // owner) in 'auto' mode — used as created_by/owner_id/uploaded_by/proposed_by.
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  // 'manual' = the chat page: every write proposes and waits for approval.
  // 'auto' = agent-auto-triage: internal record-keeping tools execute
  // immediately, but send_email/send_whatsapp still only ever propose.
  mode: "manual" | "auto";
};

const str = { type: "string" } as const;
const optStr = { type: "string" } as const;

const readToolDefinitions: ToolDef[] = [
  // ---- read tools -----------------------------------------------------
  {
    name: "list_contacts",
    description: "List the firm's contacts, optionally filtered by a search term matching name/email/phone/company.",
    input_schema: {
      type: "object",
      properties: { search: optStr, limit: { type: "integer" } },
    },
  },
  {
    name: "list_clients",
    description: "List the firm's clients, optionally filtered by a search term matching name/email.",
    input_schema: {
      type: "object",
      properties: { search: optStr, limit: { type: "integer" } },
    },
  },
  {
    name: "list_matters",
    description: "List legal matters, optionally filtered by status (open, in_progress, on_hold, closed), client, or search term.",
    input_schema: {
      type: "object",
      properties: {
        status: optStr,
        client_id: optStr,
        search: optStr,
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "list_tasks",
    description: "List tasks, optionally filtered by status (todo, in_progress, completed, cancelled), assignee, or a due-before date (YYYY-MM-DD).",
    input_schema: {
      type: "object",
      properties: {
        status: optStr,
        assigned_to: optStr,
        due_before: optStr,
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "list_calendar_events",
    description: "List calendar events between two ISO timestamps.",
    input_schema: {
      type: "object",
      properties: { from: optStr, to: optStr, limit: { type: "integer" } },
    },
  },
  {
    name: "list_communications",
    description: "List past communications (email, whatsapp, phone_call, meeting, internal_note), optionally filtered by type, client, matter, or contact.",
    input_schema: {
      type: "object",
      properties: {
        communication_type: optStr,
        client_id: optStr,
        matter_id: optStr,
        contact_id: optStr,
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "list_documents",
    description: "List documents (metadata only, not file contents), optionally filtered by client or matter.",
    input_schema: {
      type: "object",
      properties: { client_id: optStr, matter_id: optStr, limit: { type: "integer" } },
    },
  },
];

// Tools that only ever send something to someone outside the firm — these
// stay gated behind approval in every mode, manual or auto.
const sendToolDefinitions: ToolDef[] = [
  {
    name: "propose_send_email",
    description: "Draft an email to send. This does NOT send anything — it creates a pending action an operator must approve before it is sent.",
    input_schema: {
      type: "object",
      properties: {
        to: str,
        cc: optStr,
        bcc: optStr,
        subject: str,
        body: str,
        client_id: optStr,
        matter_id: optStr,
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "propose_send_whatsapp",
    description: "Draft a WhatsApp message to send. This does NOT send anything — it creates a pending action an operator must approve before it is sent.",
    input_schema: {
      type: "object",
      properties: {
        to_phone: str,
        body: str,
        client_id: optStr,
        contact_id: optStr,
      },
      required: ["to_phone", "body"],
    },
  },
];

// Internal-record propose tools — only offered in 'manual' chat mode. In
// 'auto' triage mode these actions either already happened (contact/task) or
// have a direct-execute equivalent below (create_calendar_event).
const manualWriteToolDefinitions: ToolDef[] = [
  {
    name: "propose_create_task",
    description: "Propose creating a new task. This does NOT create the task — it creates a pending action an operator must approve.",
    input_schema: {
      type: "object",
      properties: {
        title: str,
        description: optStr,
        client_id: optStr,
        matter_id: optStr,
        due_date: optStr,
        priority: optStr,
        assigned_to: optStr,
      },
      required: ["title"],
    },
  },
  {
    name: "propose_create_calendar_event",
    description: "Propose creating a new calendar event. This does NOT create the event — it creates a pending action an operator must approve.",
    input_schema: {
      type: "object",
      properties: {
        title: str,
        description: optStr,
        starts_at: str,
        ends_at: str,
        timezone: str,
        location: optStr,
        client_id: optStr,
        matter_id: optStr,
      },
      required: ["title", "starts_at", "ends_at", "timezone"],
    },
  },
  {
    name: "propose_create_contact",
    description: "Propose creating a new contact. This does NOT create the contact — it creates a pending action an operator must approve.",
    input_schema: {
      type: "object",
      properties: {
        full_name: str,
        email: optStr,
        phone: optStr,
        company: optStr,
      },
      required: ["full_name"],
    },
  },
  {
    name: "propose_update_contact",
    description: "Propose updating an existing contact. This does NOT update the contact — it creates a pending action an operator must approve.",
    input_schema: {
      type: "object",
      properties: {
        contact_id: str,
        full_name: optStr,
        email: optStr,
        phone: optStr,
        company: optStr,
      },
      required: ["contact_id"],
    },
  },
  {
    name: "propose_create_matter",
    description: "Propose opening a new legal matter for a client. This does NOT create the matter — it creates a pending action an operator must approve.",
    input_schema: {
      type: "object",
      properties: {
        title: str,
        client_id: str,
        legal_area: optStr,
        description: optStr,
      },
      required: ["title", "client_id"],
    },
  },
  {
    name: "propose_update_matter",
    description: "Propose updating an existing matter (e.g. status or description). This does NOT update the matter — it creates a pending action an operator must approve.",
    input_schema: {
      type: "object",
      properties: {
        matter_id: str,
        title: optStr,
        status: optStr,
        description: optStr,
      },
      required: ["matter_id"],
    },
  },
];

// Auto-triage-only: executes immediately (no approval queue), per the user's
// decision that internal record-keeping is fully automatic. Not offered in
// manual chat mode — a chat request to create a calendar entry goes through
// propose_create_calendar_event instead, so an operator reviews it first.
const autoWriteToolDefinitions: ToolDef[] = [
  {
    name: "create_calendar_event",
    description: "Create a calendar event now — this executes immediately, it is not a proposal. Only call this if the message clearly shows a hearing, deadline, or meeting date/time.",
    input_schema: {
      type: "object",
      properties: {
        title: str,
        description: optStr,
        starts_at: str,
        ends_at: str,
        timezone: str,
        location: optStr,
        client_id: optStr,
        matter_id: optStr,
      },
      required: ["title", "starts_at", "ends_at", "timezone"],
    },
  },
];

// Offered in BOTH modes: generating a document never sends anything to
// anyone — it only saves a file in Documents for a human to review before
// it's ever used — so there's no reason to gate it behind approval even
// when a human explicitly asked for it in chat.
const documentToolDefinitions: ToolDef[] = [
  {
    name: "generate_document",
    description: "Write and save a document (e.g. a power of attorney or a standard form) from scratch and save it now — this executes immediately, it is not a proposal. Write the complete document text yourself in 'content'. The document is saved for review; it is never sent anywhere.",
    input_schema: {
      type: "object",
      properties: {
        title: str,
        category: {
          type: "string",
          enum: [
            "contract", "court_document", "identification", "correspondence",
            "invoice", "evidence", "power_of_attorney", "legal_opinion",
            "application", "certificate", "internal", "other",
          ],
        },
        content: str,
        client_id: optStr,
        matter_id: optStr,
      },
      required: ["title", "category", "content"],
    },
  },
];

export function toolDefinitionsFor(mode: "manual" | "auto"): ToolDef[] {
  if (mode === "auto") {
    return [...readToolDefinitions, ...autoWriteToolDefinitions, ...documentToolDefinitions, ...sendToolDefinitions];
  }
  return [...readToolDefinitions, ...sendToolDefinitions, ...manualWriteToolDefinitions, ...documentToolDefinitions];
}

export function toOpenAiTools(tools: ToolDef[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

const clamp = (n: unknown, fallback: number, max: number) => {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
};

async function proposeAction(
  ctx: ToolContext,
  actionType: string,
  payload: Record<string, unknown>,
  summary: string,
) {
  const { data, error } = await ctx.admin.from("agent_actions").insert({
    organization_id: ctx.organizationId,
    conversation_id: ctx.conversationId,
    message_id: ctx.messageId,
    action_type: actionType,
    payload,
    summary,
    status: "proposed",
    proposed_by: ctx.userId,
  }).select("id").single();
  if (error) throw error;
  return { status: "pending_approval", action_id: data.id, summary };
}

export async function runTool(name: string, input: any, ctx: ToolContext) {
  const admin = ctx.admin;
  const org = ctx.organizationId;
  input = input && typeof input === "object" ? input : {};

  switch (name) {
    case "list_contacts": {
      let query = admin.from("contacts").select(
        "id,full_name,email,phone,company",
      ).eq("organization_id", org).is("deleted_at", null).order(
        "full_name",
      ).limit(clamp(input.limit, 20, 100));
      if (input.search) {
        const term = `%${String(input.search).slice(0, 100)}%`;
        query = query.or(
          `full_name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
    case "list_clients": {
      let query = admin.from("clients").select("id,full_name,email,phone,status")
        .eq("organization_id", org).order("full_name").limit(
          clamp(input.limit, 20, 100),
        );
      if (input.search) {
        const term = `%${String(input.search).slice(0, 100)}%`;
        query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
    case "list_matters": {
      let query = admin.from("matters").select(
        "id,title,reference_number,status,priority,client_id,opened_at",
      ).eq("organization_id", org).order("opened_at", { ascending: false })
        .limit(clamp(input.limit, 20, 100));
      if (input.status) query = query.eq("status", input.status);
      if (input.client_id) query = query.eq("client_id", input.client_id);
      if (input.search) query = query.ilike("title", `%${String(input.search).slice(0, 100)}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
    case "list_tasks": {
      let query = admin.from("tasks").select(
        "id,title,status,priority,due_date,client_id,matter_id,assigned_to",
      ).eq("organization_id", org).order("due_date", { ascending: true })
        .limit(clamp(input.limit, 20, 100));
      if (input.status) query = query.eq("status", input.status);
      if (input.assigned_to) query = query.eq("assigned_to", input.assigned_to);
      if (input.due_before) query = query.lte("due_date", input.due_before);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
    case "list_calendar_events": {
      let query = admin.from("calendar_events").select(
        "id,title,event_type,starts_at,ends_at,all_day,all_day_start,all_day_end,location,client_id,matter_id,status",
      ).eq("organization_id", org).order("starts_at", { ascending: true })
        .limit(clamp(input.limit, 20, 100));
      if (input.from) query = query.gte("starts_at", input.from);
      if (input.to) query = query.lte("starts_at", input.to);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
    case "list_communications": {
      let query = admin.from("communications").select(
        "id,communication_type,direction,subject,status,occurred_at,client_id,matter_id",
      ).eq("organization_id", org).order("occurred_at", { ascending: false })
        .limit(clamp(input.limit, 20, 100));
      if (input.communication_type) query = query.eq("communication_type", input.communication_type);
      if (input.client_id) query = query.eq("client_id", input.client_id);
      if (input.matter_id) query = query.eq("matter_id", input.matter_id);
      if (input.contact_id) query = query.eq("contact_id", input.contact_id);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
    case "list_documents": {
      let query = admin.from("documents").select(
        "id,title,category,client_id,matter_id,created_at",
      ).eq("organization_id", org).order("created_at", { ascending: false })
        .limit(clamp(input.limit, 20, 100));
      if (input.client_id) query = query.eq("client_id", input.client_id);
      if (input.matter_id) query = query.eq("matter_id", input.matter_id);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    case "propose_send_email": {
      const to = String(input.to || "").trim();
      const subject = String(input.subject || "").trim();
      if (!to || !subject) throw new Error("to and subject are required");
      return proposeAction(ctx, "send_email", {
        to,
        cc: input.cc || null,
        bcc: input.bcc || null,
        subject,
        body: String(input.body || ""),
        client_id: input.client_id || null,
        matter_id: input.matter_id || null,
      }, `Send email to ${to}: "${subject}"`);
    }
    case "propose_send_whatsapp": {
      const toPhone = String(input.to_phone || "").trim();
      if (!toPhone) throw new Error("to_phone is required");
      return proposeAction(ctx, "send_whatsapp", {
        to_phone: toPhone,
        body: String(input.body || ""),
        client_id: input.client_id || null,
        contact_id: input.contact_id || null,
      }, `Send WhatsApp message to ${toPhone}`);
    }
    case "propose_create_task": {
      const title = String(input.title || "").trim();
      if (!title) throw new Error("title is required");
      return proposeAction(ctx, "create_task", {
        title,
        description: input.description || null,
        client_id: input.client_id || null,
        matter_id: input.matter_id || null,
        due_date: input.due_date || null,
        priority: input.priority || "medium",
        assigned_to: input.assigned_to || null,
      }, `Create task: "${title}"`);
    }
    case "propose_create_calendar_event": {
      const title = String(input.title || "").trim();
      if (!title || !input.starts_at || !input.ends_at || !input.timezone) {
        throw new Error("title, starts_at, ends_at and timezone are required");
      }
      return proposeAction(ctx, "create_calendar_event", {
        title,
        description: input.description || null,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        timezone: input.timezone,
        location: input.location || null,
        client_id: input.client_id || null,
        matter_id: input.matter_id || null,
      }, `Create calendar event: "${title}"`);
    }
    case "propose_create_contact": {
      const fullName = String(input.full_name || "").trim();
      if (!fullName) throw new Error("full_name is required");
      return proposeAction(ctx, "create_contact", {
        full_name: fullName,
        email: input.email || null,
        phone: input.phone || null,
        company: input.company || null,
      }, `Create contact: "${fullName}"`);
    }
    case "propose_update_contact": {
      const contactId = String(input.contact_id || "").trim();
      if (!contactId) throw new Error("contact_id is required");
      return proposeAction(ctx, "update_contact", {
        contact_id: contactId,
        full_name: input.full_name || null,
        email: input.email || null,
        phone: input.phone || null,
        company: input.company || null,
      }, `Update contact ${contactId}`);
    }
    case "propose_create_matter": {
      const title = String(input.title || "").trim();
      const clientId = String(input.client_id || "").trim();
      if (!title || !clientId) throw new Error("title and client_id are required");
      return proposeAction(ctx, "create_matter", {
        title,
        client_id: clientId,
        legal_area: input.legal_area || null,
        description: input.description || null,
      }, `Open matter: "${title}"`);
    }
    case "propose_update_matter": {
      const matterId = String(input.matter_id || "").trim();
      if (!matterId) throw new Error("matter_id is required");
      return proposeAction(ctx, "update_matter", {
        matter_id: matterId,
        title: input.title || null,
        status: input.status || null,
        description: input.description || null,
      }, `Update matter ${matterId}`);
    }
    case "create_calendar_event": {
      if (ctx.mode !== "auto") throw new Error("create_calendar_event is only available in auto-triage mode");
      const title = String(input.title || "").trim();
      if (!title || !input.starts_at || !input.ends_at || !input.timezone) {
        throw new Error("title, starts_at, ends_at and timezone are required");
      }
      const { data, error } = await admin.from("calendar_events").insert({
        organization_id: org,
        owner_id: ctx.userId,
        title,
        description: input.description || null,
        event_type: "deadline",
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        all_day: false,
        timezone: input.timezone,
        location: input.location || null,
        client_id: input.client_id || null,
        matter_id: input.matter_id || null,
      }).select("id").single();
      if (error) throw error;
      return { status: "created", calendar_event_id: data.id };
    }
    case "generate_document": {
      const title = String(input.title || "").trim();
      const content = String(input.content || "").trim();
      if (!title || !content) throw new Error("title and content are required");
      const file = await buildDocumentFile(content, title);
      // Same layout as uploads from the Documents page; the documents table
      // trigger rejects any other path: <org>/documents/<document id>/<version>/<file>.
      const documentId = crypto.randomUUID();
      const storagePath = `${org}/documents/${documentId}/1/${crypto.randomUUID()}.${file.extension}`;
      const originalFilename = `${title}.${file.extension}`;
      const { error: uploadError } = await admin.storage.from("documents").upload(
        storagePath,
        file.bytes,
        { contentType: file.mimeType, upsert: false },
      );
      if (uploadError) throw uploadError;
      const { error } = await admin.from("documents").insert({
        id: documentId,
        organization_id: org,
        uploaded_by: ctx.userId,
        title,
        original_filename: originalFilename,
        category: input.category || "other",
        storage_bucket: "documents",
        storage_path: storagePath,
        mime_type: file.mimeType,
        file_extension: file.extension,
        file_size: file.bytes.byteLength,
        current_version: 1,
        client_id: input.client_id || null,
        matter_id: input.matter_id || null,
        processing_status: "completed",
      });
      if (error) {
        await admin.storage.from("documents").remove([storagePath]);
        throw error;
      }
      const { error: versionError } = await admin.from("document_versions").insert({
        document_id: documentId,
        organization_id: org,
        version_number: 1,
        storage_bucket: "documents",
        storage_path: storagePath,
        original_filename: originalFilename,
        mime_type: file.mimeType,
        file_extension: file.extension,
        file_size: file.bytes.byteLength,
        uploaded_by: ctx.userId,
      });
      if (versionError) console.error("generate_document: version row failed", versionError.message);
      return { status: "created", document_id: documentId, title };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
