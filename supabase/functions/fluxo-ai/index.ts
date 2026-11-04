import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    if (profile.role === "client" && action !== "portal_ask") throw new Error("Not available in the client portal");

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
          .select("title, reference_number, legal_area, description, clients(full_name, email, phone), matter_parties(name, role, party_type)")
          .eq("id", matterId).eq("organization_id", orgId).single();
        if (matter) {
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
