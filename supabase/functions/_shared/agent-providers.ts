// Provider-agnostic chat + tool-use loop for the FLUXO AI Agent.
// Claude (Anthropic) is always tried first; OpenAI is only called if the
// Claude call throws (network error, 4xx/5xx, missing/invalid key). Which
// provider actually answered a given turn is returned so the caller can
// record it on agent_messages.provider for auditability.
import { runTool, toOpenAiTools, type ToolContext, type ToolDef } from "./agent-tools.ts";

const ANTHROPIC_MODEL = "claude-opus-5";
const OPENAI_MODEL = "gpt-5.6";
const MAX_TOOL_ITERATIONS = 8;

// Platform-wide default keys, set once as Edge Function secrets
// (ANTHROPIC_API_KEY / OPENAI_API_KEY). Every organization uses them unless
// it has saved its own key in Settings → AI Agent.
export function platformProviderKey(provider: "anthropic" | "openai"): string | null {
  const value = Deno.env.get(provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY");
  return value?.trim() || null;
}

// Shared by agent-chat and agent-auto-triage: looks up the org's stored
// Claude/OpenAI key (if configured) via the Vault-backed read RPC, falling
// back to the platform-wide key.
export async function loadProviderKey(
  admin: any,
  organizationId: string,
  provider: "anthropic" | "openai",
): Promise<string | null> {
  const { data: credential } = await admin.from("agent_provider_credentials")
    .select("id,status").eq("organization_id", organizationId).eq("provider", provider)
    .maybeSingle();
  if (!credential || credential.status !== "configured") return platformProviderKey(provider);
  const { data: secret, error } = await admin.rpc("read_agent_provider_key", {
    target_credential: credential.id,
  });
  if (error || !secret?.api_key) return platformProviderKey(provider);
  return String(secret.api_key);
}

export type NormalizedMessage = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  // Present on assistant messages that invoked tools, and on tool-result
  // messages (one entry, echoing the call it answers).
  toolCalls?: { id: string; name: string; input?: unknown }[];
};

class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true; // network/parse errors: worth trying the other provider
  if (!error.status) return true;
  return error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
function toAnthropicMessages(messages: NormalizedMessage[]) {
  const out: { role: "user" | "assistant"; content: unknown[] }[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: message.content || "" }] });
      continue;
    }
    if (message.role === "assistant") {
      const blocks: unknown[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls || []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input || {} });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    // role === 'tool' — Anthropic represents tool results as a user turn.
    // Merge consecutive tool rows into a single user message with multiple
    // tool_result blocks, since they answer one assistant turn's tool_use set.
    const call = message.toolCalls?.[0];
    const block = { type: "tool_result", tool_use_id: call?.id, content: message.content || "" };
    const last = out[out.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content) &&
        (last.content[0] as any)?.type === "tool_result") {
      last.content.push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

async function callAnthropic(
  apiKey: string,
  messages: NormalizedMessage[],
  tools: ToolDef[],
  systemPrompt: string,
) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: systemPrompt,
      ...(tools.length ? {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        })),
      } : {}),
      messages: toAnthropicMessages(messages),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ProviderError(
      result?.error?.message || `Anthropic request failed (${response.status})`,
      response.status,
    );
  }
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  const toolCalls = content.filter((b: any) => b.type === "tool_use").map((b: any) => ({
    id: b.id,
    name: b.name,
    input: b.input,
  }));
  return { text: text || null, toolCalls };
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
function toOpenAiMessages(messages: NormalizedMessage[]) {
  const out: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content || "" });
    } else if (message.role === "assistant") {
      const entry: Record<string, unknown> = { role: "assistant", content: message.content || null };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
        }));
      }
      out.push(entry);
    } else {
      const call = message.toolCalls?.[0];
      out.push({ role: "tool", tool_call_id: call?.id, content: message.content || "" });
    }
  }
  return out;
}

async function callOpenAi(
  apiKey: string,
  messages: NormalizedMessage[],
  tools: ToolDef[],
  systemPrompt: string,
) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      // gpt-5.6+ rejects function tools on Chat Completions unless reasoning
      // is turned off for the call.
      reasoning_effort: "none",
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAiMessages(messages)],
      ...(tools.length ? { tools: toOpenAiTools(tools) } : {}),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ProviderError(
      result?.error?.message || `OpenAI request failed (${response.status})`,
      response.status,
    );
  }
  const message = result?.choices?.[0]?.message;
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls.map((call: any) => ({
      id: call.id,
      name: call.function?.name,
      input: safeJsonParse(call.function?.arguments),
    }))
    : [];
  return { text: message?.content || null, toolCalls };
}

function safeJsonParse(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Shared loop
// ---------------------------------------------------------------------------
export const AGENT_SYSTEM_PROMPT = [
  "You are FLUXO's in-app office assistant for a law firm.",
  "You can freely read data through the list_/get_ tools.",
  "You can NEVER send an email or WhatsApp message, or create/update a task, calendar event, contact, or matter directly.",
  "For any of those actions, you must call the matching propose_* tool, which only queues the action for a human operator to review and approve — it never performs the action itself.",
  "If asked to draft or prepare a document (a contract, power of attorney, form, etc.), call generate_document and write the full document text yourself in 'content' — this saves it in Documents immediately for human review, since generating a draft never sends anything to anyone.",
  "Always tell the user when you've queued something for approval, and never claim an action has been completed unless a tool result confirms it already existed (e.g. a read tool).",
].join(" ");

// Used by agent-auto-triage: internal record-keeping (tasks, calendar,
// contacts, documents) already happened or is available via create_* tools
// that act immediately — only outbound sends still require approval.
export const AGENT_AUTO_SYSTEM_PROMPT = [
  "You are FLUXO's automatic triage assistant for a law firm, reacting to one new inbound email or WhatsApp message.",
  "A contact and a follow-up task have already been created for this message — you do not need to create those.",
  "You can freely read data through the list_/get_ tools.",
  "If the message content shows a hearing, deadline, or meeting date, call create_calendar_event — this executes immediately, it is not a proposal.",
  "If the message clearly needs a prepared document (e.g. a power of attorney or a standard form), call generate_document with the full document text you write yourself — this also executes immediately.",
  "If a reply to the sender is warranted, call propose_send_email or propose_send_whatsapp — these only queue a draft for a human operator to approve, they never send anything themselves.",
  "You can NEVER send an email or WhatsApp message directly — only propose_send_email/propose_send_whatsapp exist for that, and both only queue a draft.",
  "Do not create tasks, contacts, matters, or clients — those are handled outside your tools in this mode.",
  "If nothing further is warranted, just say so briefly — you do not have to use every tool.",
].join(" ");

// One-shot text generation with no tools (used for the daily plan). Claude
// first, OpenAI as the fallback, same as the chat agent. Returns null when no
// provider key is available at all.
export async function completeText(
  admin: any,
  organizationId: string,
  systemPrompt: string,
  prompt: string,
): Promise<{ text: string; provider: "anthropic" | "openai" } | null> {
  const anthropicKey = await loadProviderKey(admin, organizationId, "anthropic");
  const openaiKey = await loadProviderKey(admin, organizationId, "openai");
  const messages: NormalizedMessage[] = [{ role: "user", content: prompt }];
  if (anthropicKey) {
    try {
      const result = await callAnthropic(anthropicKey, messages, [], systemPrompt);
      return { text: result.text || "", provider: "anthropic" };
    } catch (error) {
      if (!openaiKey || !isRetryableProviderError(error)) throw error;
    }
  }
  if (!openaiKey) return null;
  const result = await callOpenAi(openaiKey, messages, [], systemPrompt);
  return { text: result.text || "", provider: "openai" };
}

export async function runProviderLoop(
  provider: "anthropic" | "openai",
  apiKey: string,
  history: NormalizedMessage[],
  tools: ToolDef[],
  ctx: ToolContext,
  systemPrompt: string = AGENT_SYSTEM_PROMPT,
) {
  const call = provider === "anthropic" ? callAnthropic : callOpenAi;
  const produced: NormalizedMessage[] = [];
  let transcript = [...history];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await call(apiKey, transcript, tools, systemPrompt);
    const assistantMessage: NormalizedMessage = {
      role: "assistant",
      content: result.text,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
    };
    produced.push(assistantMessage);
    transcript = [...transcript, assistantMessage];

    if (!result.toolCalls.length) {
      return { finalText: result.text || "", produced, provider };
    }

    for (const call_ of result.toolCalls) {
      let output: unknown;
      try {
        output = await runTool(call_.name, call_.input, ctx);
      } catch (error) {
        output = { error: error instanceof Error ? error.message : ((error as any)?.message || "Tool execution failed") };
      }
      const toolMessage: NormalizedMessage = {
        role: "tool",
        content: JSON.stringify(output),
        toolCalls: [{ id: call_.id, name: call_.name }],
      };
      produced.push(toolMessage);
      transcript = [...transcript, toolMessage];
    }
  }

  return {
    finalText: "I reached the limit of steps I can take in one turn — please ask me to continue.",
    produced,
    provider,
  };
}
