import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-70b-versatile";

async function callGroq(messages: { role: string; content: string }[], systemPrompt: string) {
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) throw new Error("GROQ_API_KEY not configured");

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 2048,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error: ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
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
      .select("organization_id, role, full_name")
      .eq("id", user.id).single();
    if (!profile) throw new Error("Profile not found");

    const body = await request.json();
    const action = String(body?.action || "");
    const orgId = profile.organization_id;

    // ── 1. SUMMARIZE MATTER ──────────────────────────────────────────
    if (action === "summarize_matter") {
      const matterId = String(body?.matter_id || "");
      if (!matterId) throw new Error("matter_id required");

      const { data: matter } = await admin.from("matters")
        .select("title, status, practice_area, description, opened_date, matter_fees(*), matter_payments(*), matter_deadlines(*), matter_parties(*)")
        .eq("id", matterId).eq("organization_id", orgId).single();
      if (!matter) throw new Error("Matter not found");

      const fees = (matter.matter_fees || []).reduce((s: number, f: any) => s + (f.amount || 0), 0);
      const paid = (matter.matter_payments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const deadlines = (matter.matter_deadlines || []).filter((d: any) => d.status !== "completed")
        .map((d: any) => `${d.description} (${d.deadline_date})`).join(", ");
      const parties = (matter.matter_parties || []).map((p: any) => `${p.name} (${p.role})`).join(", ");

      const prompt = `You are a legal assistant. Summarize this matter concisely for the lawyer.
Matter: ${matter.title}
Status: ${matter.status} | Practice Area: ${matter.practice_area || "N/A"}
Opened: ${matter.opened_date || "N/A"}
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

      let matterContext = "";
      if (matterId) {
        const { data: matter } = await admin.from("matters")
          .select("title, practice_area, description, matter_parties(*)")
          .eq("id", matterId).eq("organization_id", orgId).single();
        if (matter) {
          const parties = (matter.matter_parties || []).map((p: any) => `${p.name} (${p.role})`).join(", ");
          matterContext = `\nMatter: ${matter.title}\nPractice Area: ${matter.practice_area || "N/A"}\nParties: ${parties || "N/A"}\nDetails: ${matter.description || "N/A"}`;
        }
      }

      const systemPrompt = `You are an expert legal document drafter. Write professional, clear legal documents. Use formal legal language appropriate for Portuguese/EU law context. Return only the document text, no explanations.`;
      const userPrompt = `Draft a ${docType} document.${matterContext}${context ? "\nAdditional instructions: " + context : ""}\n\nWrite a complete, professional draft.`;

      const draft = await callGroq([{ role: "user", content: userPrompt }], systemPrompt);
      return Response.json({ draft }, { headers: corsHeaders });
    }

    // ── 3. SMART SEARCH ──────────────────────────────────────────────
    if (action === "smart_search") {
      const query = String(body?.query || "");
      if (!query) throw new Error("query required");

      // Search matters, clients, documents simultaneously
      const [mattersRes, clientsRes] = await Promise.all([
        admin.from("matters").select("id,title,status,practice_area,description,client_id")
          .eq("organization_id", orgId).limit(50),
        admin.from("clients").select("id,full_name,email,notes")
          .eq("organization_id", orgId).limit(50),
      ]);

      const matters = mattersRes.data || [];
      const clients = clientsRes.data || [];

      const dataContext = `
MATTERS:
${matters.map((m: any) => `[${m.id}] ${m.title} | ${m.status} | ${m.practice_area || ""} | ${m.description?.slice(0, 100) || ""}`).join("\n")}

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
        .select("title, status, practice_area, description, opened_date")
        .eq("client_id", clientId).limit(10);

      const mattersContext = (matters || []).map((m: any) =>
        `- ${m.title} (${m.status}, ${m.practice_area || "general"}): ${m.description?.slice(0, 150) || "No description"}`
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
