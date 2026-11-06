import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";
import { loadProviderKey } from "../_shared/agent-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

// Groq retires models often (llama-3.1-70b-versatile, then llama-3.3-70b-
// versatile disappeared), so the model is not hard-coded: a GROQ_MODEL secret
// wins if set; otherwise the first of these that the account can use; and
// failing that, any available general chat model.
const PREFERRED_GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "moonshotai/kimi-k2-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];
let cachedGroqModel: string | null = null;

async function pickGroqModel(groqKey: string, refresh = false): Promise<string> {
  const configured = Deno.env.get("GROQ_MODEL");
  if (configured) return configured;
  if (cachedGroqModel && !refresh) return cachedGroqModel;
  const response = await fetch(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${groqKey}` } });
  if (!response.ok) throw new Error(`Groq error: ${await response.text()}`);
  const { data } = await response.json();
  const available = (data || [])
    .filter((model: any) => model.active !== false)
    .map((model: any) => String(model.id));
  const general = available.filter((id: string) => !/whisper|guard|tts|playai|distil|compound|orpheus/i.test(id));
  const choice = PREFERRED_GROQ_MODELS.find((id) => available.includes(id)) || general[0];
  if (!choice) throw new Error("No Groq chat model is available for this API key");
  cachedGroqModel = choice;
  return choice;
}

async function callGroq(messages: { role: string; content: string }[], systemPrompt: string) {
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) throw new Error("GROQ_API_KEY not configured");

  const request = async (model: string) => fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 2048,
      temperature: 0.4,
    }),
  });

  let response = await request(await pickGroqModel(groqKey));
  if (!response.ok) {
    const err = await response.text();
    // The cached model may have been retired since: choose again once.
    if (!/model_not_found|model_decommissioned|decommissioned/.test(err)) throw new Error(`Groq error: ${err}`);
    response = await request(await pickGroqModel(groqKey, true));
    if (!response.ok) throw new Error(`Groq error: ${await response.text()}`);
  }
  const data = await response.json();
  // Some reasoning models wrap their thinking in <think> tags; keep only the answer.
  return String(data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// ── Document reading (vision) ─────────────────────────────────────────
// Vision models are chosen the same way as chat models: a GROQ_VISION_MODEL
// secret wins, else the first preferred one the account has, else any model
// whose name says it reads images.
const PREFERRED_GROQ_VISION_MODELS = [
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];
let cachedGroqVisionModel: string | null = null;

async function pickGroqVisionModel(groqKey: string, refresh = false): Promise<string> {
  const configured = Deno.env.get("GROQ_VISION_MODEL");
  if (configured) return configured;
  if (cachedGroqVisionModel && !refresh) return cachedGroqVisionModel;
  const response = await fetch(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${groqKey}` } });
  if (!response.ok) throw new Error(`Groq error: ${await response.text()}`);
  const { data } = await response.json();
  const available = (data || []).filter((model: any) => model.active !== false).map((model: any) => String(model.id));
  const choice = PREFERRED_GROQ_VISION_MODELS.find((id) => available.includes(id))
    || available.find((id: string) => /vision|llama-4|-vl\b|qwen3\.[6-9]/i.test(id));
  if (!choice) throw new Error("No Groq model that reads images is available for this API key");
  cachedGroqVisionModel = choice;
  return choice;
}

// Pages arrive as JPEG/PNG data URLs prepared in the browser (photos are
// scaled down, PDFs rendered page by page), so they fit Groq's request limit.
const MAX_PAGES = 3;
const MAX_IMAGES_BYTES = 3_500_000;
function checkPageImages(images: unknown): string[] {
  if (!Array.isArray(images) || images.length === 0) throw new Error("No page images to read");
  const pages = images.slice(0, MAX_PAGES).map((image) => String(image || ""));
  if (pages.some((page) => !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(page))) {
    throw new Error("Page images must be JPEG, PNG or WebP data URLs");
  }
  if (pages.reduce((sum, page) => sum + page.length, 0) > MAX_IMAGES_BYTES) {
    throw new Error("The document images are too large to read. Try a smaller photo.");
  }
  return pages;
}

const DOCUMENT_TYPES = ["citizen_card", "passport", "residence_permit", "driving_licence", "id_card", "tax_card", "birth_certificate", "other"];
const EXTRACTED_FIELDS: Record<string, "text" | "date"> = {
  full_name: "text", given_names: "text", surnames: "text",
  date_of_birth: "date", place_of_birth: "text", sex: "text", nationality: "text",
  document_number: "text", nif: "text", social_security_number: "text", health_number: "text",
  issue_date: "date", expiry_date: "date", issuing_country: "text", issuing_authority: "text",
  address: "text", father_name: "text", mother_name: "text", mrz: "text",
};

function cleanExtraction(raw: any) {
  const fields: Record<string, string> = {};
  const warnings: string[] = Array.isArray(raw?.warnings)
    ? raw.warnings.map((w: unknown) => String(w).slice(0, 300)).filter(Boolean).slice(0, 10)
    : [];
  const source = raw?.fields && typeof raw.fields === "object" ? raw.fields : {};
  for (const [key, kind] of Object.entries(EXTRACTED_FIELDS)) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim().slice(0, key === "mrz" ? 300 : 200);
    if (!text || /^(null|n\/a|unknown|-)$/i.test(text)) continue;
    if (kind === "date") {
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
      if (!valid) { warnings.push(`${key.replace(/_/g, " ")} could not be read as a date: "${text}"`); continue; }
    }
    fields[key] = text;
  }
  const documentType = DOCUMENT_TYPES.includes(raw?.document_type) ? raw.document_type : "other";
  return { documentType, fields, warnings };
}

const READING_INSTRUCTIONS = [
  "You read identity and personal documents for a law firm (Portuguese Cartão de Cidadão, passports, residence permits, driving licences, ID cards, tax cards, birth certificates).",
  "The images are the pages or sides of ONE document. Read exactly what is printed; never guess or invent. If a value is not visible or not legible, use null and say so in warnings.",
  "Dates must be YYYY-MM-DD. Read printed dates carefully (Portuguese documents print DD MM YYYY). If there is an MRZ, use it to check the document number, dates and names, and mention any mismatch in warnings.",
  "Names: full_name exactly as printed (given names then surnames). nationality and issuing_country as printed (e.g. PRT, Portuguesa). sex as printed (M/F).",
  "nif is the Portuguese tax number (NIF, 9 digits); social_security_number is NISS; health_number is the SNS / utente number.",
  "Write warnings in the same language as the document's country when it is Portuguese, otherwise in English; keep each one short.",
].join(" ");

// JSON schema for Claude's structured output: every field present, null when not printed.
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    document_type: { type: "string", enum: DOCUMENT_TYPES },
    fields: {
      type: "object",
      properties: Object.fromEntries(Object.keys(EXTRACTED_FIELDS).map((key) => [key, { type: ["string", "null"] }])),
      required: Object.keys(EXTRACTED_FIELDS),
      additionalProperties: false,
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["document_type", "fields", "warnings"],
  additionalProperties: false,
};

const CLAUDE_READER_MODEL = "claude-opus-5-5";

async function readWithClaude(apiKey: string, pages: string[]) {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: CLAUDE_READER_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    system: READING_INSTRUCTIONS,
    messages: [{
      role: "user",
      content: [
        ...pages.map((url) => {
          const [, mediaType, data] = url.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/) || [];
          return { type: "image" as const, source: { type: "base64" as const, media_type: mediaType as "image/jpeg", data } };
        }),
        { type: "text" as const, text: "Read this document." },
      ],
    }],
  } as any);
  if (response.stop_reason === "refusal") throw new Error("The AI declined to read this document");
  if (response.stop_reason === "max_tokens") throw new Error("The document could not be read completely");
  const text = response.content.map((block: any) => (block.type === "text" ? block.text : "")).join("");
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error("The document could not be read. Try a sharper, well-lit photo."); }
  return { model: response.model || CLAUDE_READER_MODEL, ...cleanExtraction(parsed) };
}

// Claude reads first (the firm's own Anthropic key, else FLUXO's platform key);
// Groq is the backup when no Anthropic key is set or the Claude call fails.
async function readDocumentImages(admin: any, orgId: string, pages: string[]) {
  const anthropicKey = await loadProviderKey(admin, orgId, "anthropic");
  let claudeError: unknown = null;
  if (anthropicKey) {
    try {
      return await readWithClaude(anthropicKey, pages);
    } catch (error) {
      console.error("Claude document reading failed", error);
      claudeError = error;
    }
  }
  try {
    return await readWithGroq(pages);
  } catch (groqError) {
    throw claudeError || groqError;
  }
}

async function readWithGroq(pages: string[]) {
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) throw new Error("No AI key is configured for reading documents");

  const instructions = [
    "You read identity and personal documents for a law firm (Portuguese Cartão de Cidadão, passports, residence permits, driving licences, ID cards, tax cards, birth certificates).",
    "The images are the pages or sides of ONE document. Read exactly what is printed; never guess or invent. If a value is not visible or not legible, use null and say so in warnings.",
    "Dates must be YYYY-MM-DD. Read printed dates carefully (Portuguese documents print DD MM YYYY). If there is an MRZ, use it to check the document number, dates and names, and mention any mismatch in warnings.",
    "Names: full_name exactly as printed (given names then surnames). nationality and issuing_country as printed (e.g. PRT, Portuguesa). sex as printed (M/F).",
    "nif is the Portuguese tax number (NIF, 9 digits); social_security_number is NISS; health_number is the SNS / utente number.",
    `Return ONLY a JSON object: {"document_type": one of ${JSON.stringify(DOCUMENT_TYPES)}, "fields": {${Object.keys(EXTRACTED_FIELDS).map((k) => `"${k}": string|null`).join(", ")}}, "warnings": [short strings]}.`,
  ].join(" ");

  const request = (model: string, jsonMode: boolean) => fetch(GROQ_API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: instructions },
          ...pages.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      }],
      max_tokens: 1500,
      temperature: 0,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  let model = await pickGroqVisionModel(groqKey);
  let response = await request(model, true);
  if (!response.ok) {
    const err = await response.text();
    if (/model_not_found|model_decommissioned|decommissioned/.test(err)) {
      model = await pickGroqVisionModel(groqKey, true);
      response = await request(model, true);
    } else if (/response_format|json/i.test(err)) {
      response = await request(model, false);
    } else {
      throw new Error(`Groq error: ${err}`);
    }
    if (!response.ok) throw new Error(`Groq error: ${await response.text()}`);
  }
  const data = await response.json();
  const text = String(data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The document could not be read. Try a sharper, well-lit photo.");
  let parsed: any;
  try { parsed = JSON.parse(match[0]); } catch { throw new Error("The document could not be read. Try a sharper, well-lit photo."); }
  return { model, ...cleanExtraction(parsed) };
}

async function saveExtraction(admin: any, row: Record<string, unknown>) {
  const { data, error } = await admin.from("document_extractions")
    .upsert({ ...row, status: "pending_review", reviewed_by: null, reviewed_at: null }, { onConflict: "document_id" })
    .select("*").single();
  if (error) throw new Error(`Could not save the extracted data: ${error.message}`);
  return data;
}

const PORTAL_UPLOAD_CATEGORIES = ["identification", "certificate", "correspondence", "evidence", "invoice", "other"];
const PORTAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Unauthorized");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await admin.from("profiles")
      .select("organization_id, role, full_name, status")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active" || !profile.organization_id) throw new Error("Profile not found");

    const body = await request.json();
    const action = String(body?.action || "");
    const orgId = profile.organization_id;
    // Portal clients may only use the portal assistant; everything else reads
    // firm-wide data with the service role and is for firm staff only.
    if (profile.role === "client" && action !== "portal_ask" && action !== "portal_upload_document") {
      throw new Error("Not available in the client portal");
    }

    // ── 0a. READ A DOCUMENT (firm staff) ─────────────────────────────
    if (action === "extract_document") {
      const documentId = String(body?.document_id || "");
      if (!documentId) throw new Error("document_id required");
      const pages = checkPageImages(body?.images);
      const { data: doc } = await admin.from("documents")
        .select("id, client_id").eq("id", documentId).eq("organization_id", orgId).maybeSingle();
      if (!doc) throw new Error("Document not found");

      const result = await readDocumentImages(admin, orgId, pages);
      const extraction = await saveExtraction(admin, {
        organization_id: orgId,
        document_id: doc.id,
        client_id: doc.client_id,
        document_type: result.documentType,
        fields: result.fields,
        warnings: result.warnings,
        model: result.model,
        source: "firm",
        created_by: user.id,
      });
      await admin.from("documents").update({ processing_status: "completed" }).eq("id", doc.id);
      return Response.json({ extraction }, { headers: corsHeaders });
    }

    // ── 0b. CLIENT UPLOADS A DOCUMENT IN THE PORTAL ──────────────────
    // Portal clients cannot write to documents or storage directly; the file
    // is stored here, linked to their own client record, and read for the
    // lawyer to review. The client never sees the extracted data.
    if (action === "portal_upload_document") {
      if (profile.role !== "client") throw new Error("Only portal clients upload here");
      const { data: clientProfile } = await admin.from("profiles").select("linked_client_id").eq("id", user.id).single();
      const clientId = clientProfile?.linked_client_id;
      if (!clientId) throw new Error("Your portal account is not linked to a client");

      const fileName = String(body?.file_name || "").trim().slice(0, 200).replace(/[\\/]/g, "_");
      const mimeType = String(body?.mime_type || "");
      if (!fileName) throw new Error("file_name required");
      if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mimeType)) {
        throw new Error("Upload a photo (JPG, PNG, WebP, HEIC) or a PDF");
      }
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(String(body?.file_base64 || "")), (c) => c.charCodeAt(0));
      } catch { throw new Error("The file could not be read"); }
      if (!bytes.length) throw new Error("The file is empty");
      if (bytes.length > PORTAL_UPLOAD_MAX_BYTES) throw new Error("The file is larger than 10 MB");
      const category = PORTAL_UPLOAD_CATEGORIES.includes(body?.category) ? body.category : "other";
      const title = String(body?.title || "").trim().slice(0, 150) || fileName;
      // Pages are optional: a file that cannot be previewed is still stored.
      let pages: string[] | null = null;
      try { pages = checkPageImages(body?.images); } catch { pages = null; }

      const documentId = crypto.randomUUID();
      const extension = (fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || "").toLowerCase();
      const path = `${orgId}/documents/${documentId}/1/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
      const upload = await admin.storage.from("documents").upload(path, bytes, { contentType: mimeType, upsert: false });
      if (upload.error) throw new Error(`The file could not be stored: ${upload.error.message}`);

      const record = {
        organization_id: orgId, uploaded_by: user.id, title, original_filename: fileName,
        description: "Uploaded by the client in the portal", category,
        storage_bucket: "documents", storage_path: path, mime_type: mimeType,
        file_extension: extension || null, file_size: bytes.length, client_id: clientId,
        tags: ["portal"], current_version: 1,
        processing_status: pages && category === "identification" ? "processing" : "not_requested",
      };
      const inserted = await admin.from("documents").insert({ id: documentId, ...record });
      if (inserted.error) {
        await admin.storage.from("documents").remove([path]);
        throw new Error(`The document could not be saved: ${inserted.error.message}`);
      }
      await admin.from("document_versions").insert({
        document_id: documentId, organization_id: orgId, version_number: 1, storage_bucket: "documents",
        storage_path: path, original_filename: fileName, mime_type: mimeType,
        file_extension: extension || null, file_size: bytes.length, uploaded_by: user.id,
      });

      // Reading is best effort: the upload has succeeded either way.
      let read = false;
      if (pages && category === "identification") {
        try {
          const result = await readDocumentImages(admin, orgId, pages);
          await saveExtraction(admin, {
            organization_id: orgId, document_id: documentId, client_id: clientId,
            document_type: result.documentType, fields: result.fields, warnings: result.warnings,
            model: result.model, source: "portal", created_by: user.id,
          });
          await admin.from("documents").update({ processing_status: "completed" }).eq("id", documentId);
          read = true;
        } catch (error) {
          console.error("portal extraction failed", error);
          await admin.from("documents").update({ processing_status: "failed" }).eq("id", documentId);
        }
      }
      return Response.json({ document_id: documentId, read }, { headers: corsHeaders });
    }

    // ── 1. SUMMARIZE MATTER ──────────────────────────────────────────
    if (action === "summarize_matter") {
      const matterId = String(body?.matter_id || "");
      if (!matterId) throw new Error("matter_id required");

      const { data: matter } = await admin.from("matters")
        .select("title, status, legal_area, description, opened_at, matter_fees(*), matter_payments(*), matter_deadlines(*), matter_parties(*)")
        .eq("id", matterId).eq("organization_id", orgId).single();
      if (!matter) throw new Error("Matter not found");

      const fees = (matter.matter_fees || []).reduce((s: number, f: any) => s + (f.amount || 0), 0);
      const paid = (matter.matter_payments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const deadlines = (matter.matter_deadlines || []).filter((d: any) => d.status !== "completed")
        .map((d: any) => `${d.title} (${d.due_date})`).join(", ");
      const parties = (matter.matter_parties || []).map((p: any) => `${p.name} (${p.role})`).join(", ");

      const prompt = `You are a legal assistant. Summarize this matter concisely for the lawyer.
Matter: ${matter.title}
Status: ${matter.status} | Legal area: ${matter.legal_area || "N/A"}
Opened: ${matter.opened_at || "N/A"}
Description: ${matter.description || "N/A"}
Parties: ${parties || "None listed"}
Pending Deadlines: ${deadlines || "None"}
Fees billed: €${fees.toFixed(2)} | Paid: €${paid.toFixed(2)} | Balance: €${(fees - paid).toFixed(2)}

Write a concise professional summary (3-5 sentences) highlighting key facts, current status, financial overview, and any urgent deadlines.`;

      const summary = await callGroq([{ role: "user", content: prompt }], "You are a concise legal assistant.");
      return Response.json({ summary }, { headers: corsHeaders });
    }

    // ── 2. DRAFT DOCUMENT ────────────────────────────────────────────
    if (action === "draft_document") {
      const docType = String(body?.doc_type || "");
      const context = String(body?.context || "");
      const matterId = String(body?.matter_id || "");
      if (!docType) throw new Error("doc_type required");

      const language = body?.language === "English" ? "English" : "European Portuguese";

      // Real details so the draft needs as few blanks as possible.
      const { data: firm } = await admin.from("organizations")
        .select("name, address, postal_code, city, phone, email, nif, website").eq("id", orgId).maybeSingle();
      const firmAddress = [firm?.address, [firm?.postal_code, firm?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const facts: string[] = [
        `Law firm: ${firm?.name || "[Nome do escritório]"}`,
        `Firm address: ${firmAddress || "[Morada do escritório]"}`,
        `Firm phone: ${firm?.phone || "[Telefone]"}`,
        `Firm email: ${firm?.email || "[Email]"}`,
        `Firm NIF: ${firm?.nif || "[NIF do escritório]"}`,
        ...(firm?.website ? [`Firm website: ${firm.website}`] : []),
        `Responsible lawyer: ${profile.full_name || "[Nome do advogado]"}`,
        `Date: ${new Date().toLocaleDateString(language === "English" ? "en-GB" : "pt-PT", { day: "numeric", month: "long", year: "numeric" })}`,
      ];
      if (matterId) {
        const { data: matter } = await admin.from("matters")
          .select("title, reference_number, legal_area, description, clients(full_name, email, phone, nif, address, nationality, date_of_birth, id_document_type, id_document_number, id_document_expiry), matter_parties(name, role, party_type)")
          .eq("id", matterId).eq("organization_id", orgId).single();
        if (matter) {
          // Identity data confirmed from the client's documents.
          const c = (matter as any).clients || {};
          const identity = [
            c.nif && `NIF ${c.nif}`,
            c.address && `address ${c.address}`,
            c.nationality && `nationality ${c.nationality}`,
            c.date_of_birth && `born ${c.date_of_birth}`,
            c.id_document_number && `${String(c.id_document_type || "ID document").replace(/_/g, " ")} no. ${c.id_document_number}${c.id_document_expiry ? ` (valid until ${c.id_document_expiry})` : ""}`,
          ].filter(Boolean).join("; ");
          if (identity) facts.push(`Client identification: ${identity}`);
          const parties = (matter.matter_parties || []).map((p: any) => `${p.name} (${p.role})`).join(", ");
          facts.push(
            `Matter: ${matter.title}${matter.reference_number ? ` (ref. ${matter.reference_number})` : ""}`,
            `Legal area: ${matter.legal_area || "not stated"}`,
            `Client: ${(matter as any).clients?.full_name || "not stated"}${(matter as any).clients?.email ? `, ${(matter as any).clients.email}` : ""}${(matter as any).clients?.phone ? `, ${(matter as any).clients.phone}` : ""}`,
            `Parties: ${parties || "not stated"}`,
            `Case summary: ${matter.description || "not stated"}`,
          );
        }
      }

      const systemPrompt = [
        "You are an experienced Portuguese lawyer drafting a document for your own firm to send or file. It must read as written by the lawyer, not as an AI answer.",
        `Write entirely in ${language}.`,
        "Use the facts given (firm, lawyer, client, matter, date) wherever they belong. For anything not given, leave a short placeholder in square brackets, e.g. [Morada do cliente], [NIF]. Never invent names, addresses, amounts or dates.",
        "Legal references: never invent article numbers, laws or case law. Cite a provision only when you are certain it exists and says that (e.g. Código Civil, Código de Processo Civil); otherwise describe the rule and add [confirmar artigo].",
        "Formatting: return only the document, with no introduction or closing remark from you. Use simple Markdown only: '## ' for section headings, '**' for bold, '-' or '1.' for lists. No tables, no horizontal rules, no emojis.",
        "End with the lawyer's signature block. Do not mention AI anywhere in the document.",
      ].join(" ");
      const userPrompt = `Draft this document: ${docType}.\n\nFacts:\n${facts.map((fact) => `- ${fact}`).join("\n")}${context ? `\n\nInstructions from the lawyer: ${context}` : ""}`;

      const draft = await callGroq([{ role: "user", content: userPrompt }], systemPrompt);
      return Response.json({ draft }, { headers: corsHeaders });
    }

    // ── 3. SMART SEARCH ──────────────────────────────────────────────
    if (action === "smart_search") {
      const query = String(body?.query || "");
      if (!query) throw new Error("query required");

      // Search matters, clients, documents simultaneously
      const [mattersRes, clientsRes] = await Promise.all([
        admin.from("matters").select("id,title,status,legal_area,description,client_id")
          .eq("organization_id", orgId).limit(50),
        admin.from("clients").select("id,full_name,email,notes")
          .eq("organization_id", orgId).limit(50),
      ]);

      const matters = mattersRes.data || [];
      const clients = clientsRes.data || [];

      const dataContext = `
MATTERS:
${matters.map((m: any) => `[${m.id}] ${m.title} | ${m.status} | ${m.legal_area || ""} | ${m.description?.slice(0, 100) || ""}`).join("\n")}

CLIENTS:
${clients.map((c: any) => `[${c.id}] ${c.full_name} | ${c.email || ""} | ${c.notes?.slice(0, 80) || ""}`).join("\n")}`;

      const systemPrompt = "You are a legal search assistant. Find the most relevant results for the query. Return a JSON array of matches with fields: type (matter|client), id, name, reason (one short sentence why it matches). Return ONLY valid JSON array, no other text.";
      const userPrompt = `Query: "${query}"\n\nData:\n${dataContext}\n\nReturn top 5 most relevant results as JSON array.`;

      const raw = await callGroq([{ role: "user", content: userPrompt }], systemPrompt);

      let results = [];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch {
        results = [];
      }
      return Response.json({ results }, { headers: corsHeaders });
    }

    // ── 4. PORTAL ASSISTANT (client-facing) ──────────────────────────
    if (action === "portal_ask") {
      const question = String(body?.question || "");
      const clientId = String(body?.client_id || "");
      if (!question || !clientId) throw new Error("question and client_id required");

      // Verify this user is linked to this client
      if (profile.role !== "client") throw new Error("Only clients can use portal assistant");
      const { data: clientProfile } = await admin.from("profiles")
        .select("linked_client_id").eq("id", user.id).single();
      if (clientProfile?.linked_client_id !== clientId) throw new Error("Unauthorized");

      // Load client's matters for context
      const { data: matters } = await admin.from("matters")
        .select("title, status, legal_area, description, opened_at")
        .eq("organization_id", orgId).eq("client_id", clientId).limit(10);

      const mattersContext = (matters || []).map((m: any) =>
        `- ${m.title} (${m.status}, ${m.legal_area || "general"}): ${m.description?.slice(0, 150) || "No description"}`
      ).join("\n");

      const systemPrompt = `You are a helpful legal assistant for a law firm's client portal. Be friendly, clear and professional. You help clients understand their cases but always recommend consulting their lawyer for legal advice. Never give specific legal advice. The client's matters are:\n${mattersContext || "No matters on file yet."}`;

      const answer = await callGroq([{ role: "user", content: question }], systemPrompt);
      return Response.json({ answer }, { headers: corsHeaders });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI error" },
      { status: 400, headers: corsHeaders },
    );
  }
});
