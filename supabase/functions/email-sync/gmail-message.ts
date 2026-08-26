export type GmailHeader = { name?: string; value?: string };

export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
};

export type ParsedAddress = { name: string | null; address: string };

export type ParsedGmailMessage = {
  providerMessageId: string;
  providerThreadId: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  body: string;
  direction: "inbound" | "outbound";
  sender: ParsedAddress;
  recipient: ParsedAddress;
  cc: string[];
  bcc: string[];
  clientMatchEmail: string | null;
  clientMatchEmails: string[];
  occurredAt: string;
  status: "unread" | "read";
  isImportant: boolean;
  labels: string[];
  attachments: Array<{
    providerAttachmentId: string;
    filename: string;
    mimeType: string | null;
    size: number | null;
  }>;
  headers: Record<string, unknown>;
  automatedOrBulk: boolean;
  skip: boolean;
};

export type GmailImportDecision = {
  import: boolean;
  reason:
    | "existing_message"
    | "existing_thread"
    | "client"
    | "contact"
    | "excluded"
    | "category"
    | "bulk"
    | "unmatched";
};

const MAX_BODY_CHARACTERS = 200_000;

export function normalizeEmail(value: string | null | undefined): string {
  return String(value || "").trim().toLocaleLowerCase();
}

export function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code[0] !== "#") return named[code.toLocaleLowerCase()] ?? entity;
      const numeric = code[1].toLocaleLowerCase() === "x"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    },
  );
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[^]*?-->/g, " ")
      .replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return String(
    headers?.find((header) =>
      header.name?.toLocaleLowerCase() === name.toLocaleLowerCase()
    )?.value || "",
  ).trim();
}

function automatedOrBulkMessage(
  senderAddress: string,
  headers: GmailHeader[] | undefined,
): boolean {
  const localPart = normalizeEmail(senderAddress).split("@", 1)[0] || "";
  const automatedSender =
    /(?:^|[._+-])(?:no-?reply|do-?not-?reply|mailer-daemon|newsletter|marketing|promotions?|campaigns?|notifications?)(?:$|[._+-])/i
      .test(localPart);
  const listUnsubscribe = headerValue(headers, "List-Unsubscribe");
  const listId = headerValue(headers, "List-Id");
  const precedence = headerValue(headers, "Precedence").toLocaleLowerCase();
  const autoSubmitted = headerValue(headers, "Auto-Submitted")
    .toLocaleLowerCase();
  return automatedSender || Boolean(listUnsubscribe) || Boolean(listId) ||
    ["bulk", "list"].includes(precedence) ||
    Boolean(autoSubmitted && autoSubmitted !== "no");
}

function splitAddressHeader(value: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  let angleDepth = 0;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === "<") angleDepth++;
    if (!quoted && character === ">" && angleDepth > 0) angleDepth--;
    if (character === "," && !quoted && angleDepth === 0) {
      if (current.trim()) values.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

export function parseAddresses(
  value: string | null | undefined,
): ParsedAddress[] {
  return splitAddressHeader(String(value || "")).flatMap((entry) => {
    const angle = entry.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/);
    const plain = entry.match(
      /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    );
    const address = normalizeEmail(angle?.[2] || plain?.[1]);
    if (!address) return [];
    const rawName = angle?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
    return [{ name: rawName || null, address }];
  });
}

function collectMessageParts(
  part: GmailMessagePart | undefined,
  textParts: string[],
  htmlParts: string[],
  attachments: ParsedGmailMessage["attachments"],
): void {
  if (!part) return;
  const filename = String(part.filename || "").trim();
  const attachmentId = String(part.body?.attachmentId || "").trim();
  if (filename) {
    attachments.push({
      providerAttachmentId: attachmentId || `inline:${part.partId || filename}`,
      filename: filename.slice(0, 500),
      mimeType: part.mimeType || null,
      size: Number.isFinite(Number(part.body?.size))
        ? Number(part.body?.size)
        : null,
    });
  } else if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType?.toLocaleLowerCase() === "text/plain") {
      textParts.push(decoded);
    }
    if (part.mimeType?.toLocaleLowerCase() === "text/html") {
      htmlParts.push(decoded);
    }
  }
  for (const child of part.parts || []) {
    collectMessageParts(child, textParts, htmlParts, attachments);
  }
}

function firstExternalAddress(
  addresses: ParsedAddress[],
  connectedEmail: string,
): ParsedAddress | null {
  return addresses.find((entry) =>
    normalizeEmail(entry.address) !== normalizeEmail(connectedEmail)
  ) || addresses[0] || null;
}

function occurredAt(message: GmailMessage, dateHeader: string): string {
  const internalDate = Number(message.internalDate);
  const timestamp = Number.isFinite(internalDate) && internalDate > 0
    ? internalDate
    : Date.parse(dateHeader);
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now())
    .toISOString();
}

export function parseGmailMessage(
  message: GmailMessage,
  connectedEmail: string,
): ParsedGmailMessage {
  const providerMessageId = String(message.id || "").trim();
  if (!providerMessageId) throw new Error("Gmail message ID is missing");
  const labels = [...new Set((message.labelIds || []).map(String))];
  const headers = message.payload?.headers || [];
  const fromHeader = headerValue(headers, "From");
  const toHeader = headerValue(headers, "To");
  const ccHeader = headerValue(headers, "Cc");
  const bccHeader = headerValue(headers, "Bcc");
  const from = parseAddresses(fromHeader);
  const to = parseAddresses(toHeader);
  const cc = parseAddresses(ccHeader);
  const bcc = parseAddresses(bccHeader);
  const connected = normalizeEmail(connectedEmail);
  const outbound = labels.includes("SENT") ||
    normalizeEmail(from[0]?.address) === connected;
  const sender = from[0] || { name: null, address: outbound ? connected : "" };
  const recipient = outbound
    ? firstExternalAddress(to, connected) ||
      { name: null, address: to[0]?.address || "" }
    : firstExternalAddress(to, sender.address) ||
      { name: null, address: connected };
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: ParsedGmailMessage["attachments"] = [];
  collectMessageParts(message.payload, textParts, htmlParts, attachments);
  const plainBody = textParts.map((part) => part.trim()).filter(Boolean).join(
    "\n\n",
  );
  const htmlBody = htmlParts.map(htmlToText).filter(Boolean).join("\n\n");
  const body = (plainBody || htmlBody || String(message.snippet || "")).slice(
    0,
    MAX_BODY_CHARACTERS,
  );
  const internetMessageId = headerValue(headers, "Message-ID") ||
    headerValue(headers, "Message-Id") || null;
  const inReplyTo = headerValue(headers, "In-Reply-To") || null;
  const references = headerValue(headers, "References").split(/\s+/).filter(
    Boolean,
  );
  const clientMatchEmails =
    (outbound
      ? to.filter((entry) => entry.address !== connected).map((entry) =>
        entry.address
      )
      : [sender.address]).filter(Boolean);
  const clientMatchEmail = clientMatchEmails[0] || null;
  const listUnsubscribe = headerValue(headers, "List-Unsubscribe") || null;
  const listId = headerValue(headers, "List-Id") || null;
  const precedence = headerValue(headers, "Precedence") || null;
  const autoSubmitted = headerValue(headers, "Auto-Submitted") || null;

  return {
    providerMessageId,
    providerThreadId: message.threadId || null,
    internetMessageId,
    inReplyTo,
    references,
    subject: headerValue(headers, "Subject").slice(0, 2_000),
    body,
    direction: outbound ? "outbound" : "inbound",
    sender,
    recipient,
    cc: cc.map((entry) => entry.address),
    bcc: bcc.map((entry) => entry.address),
    clientMatchEmail,
    clientMatchEmails,
    occurredAt: occurredAt(message, headerValue(headers, "Date")),
    status: !outbound && labels.includes("UNREAD") ? "unread" : "read",
    isImportant: labels.includes("IMPORTANT"),
    labels,
    attachments,
    headers: {
      from: fromHeader || null,
      to: toHeader || null,
      cc: ccHeader || null,
      bcc: bccHeader || null,
      date: headerValue(headers, "Date") || null,
      in_reply_to: inReplyTo,
      references,
      label_ids: labels,
      list_unsubscribe: listUnsubscribe,
      list_id: listId,
      precedence,
      auto_submitted: autoSubmitted,
    },
    automatedOrBulk: automatedOrBulkMessage(sender.address, headers),
    skip: labels.some((label) => ["DRAFT", "SPAM", "TRASH"].includes(label)),
  };
}

export function decideGmailImport(
  parsed: ParsedGmailMessage,
  context: {
    clientId: string | null;
    contactId: string | null;
    existingMessage: boolean;
    existingAcceptedThread: boolean;
  },
): GmailImportDecision {
  if (parsed.skip) return { import: false, reason: "excluded" };
  if (context.existingMessage) {
    return { import: true, reason: "existing_message" };
  }
  if (context.existingAcceptedThread) {
    return { import: true, reason: "existing_thread" };
  }
  if (
    parsed.labels.some((label) =>
      ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(
        label,
      )
    )
  ) {
    return { import: false, reason: "category" };
  }
  if (context.clientId) return { import: true, reason: "client" };
  if (context.contactId) return { import: true, reason: "contact" };
  if (parsed.labels.includes("CATEGORY_UPDATES")) {
    return { import: false, reason: "category" };
  }
  if (parsed.automatedOrBulk) return { import: false, reason: "bulk" };
  return { import: false, reason: "unmatched" };
}

export function chooseUniqueClientId(
  clients: Array<{ id?: string; email?: string | null }> | null | undefined,
  targetEmail: string | null | undefined,
): string | null {
  const normalized = normalizeEmail(targetEmail);
  if (!normalized) return null;
  const matches = (clients || []).filter((client) =>
    normalizeEmail(client.email) === normalized && client.id
  );
  return matches.length === 1 ? String(matches[0].id) : null;
}

export function messageIdsFromHistory(history: unknown[]): string[] {
  const ids = new Set<string>();
  for (const record of history || []) {
    const additions =
      Array.isArray((record as { messagesAdded?: unknown[] })?.messagesAdded)
        ? (record as { messagesAdded: Array<{ message?: { id?: string } }> })
          .messagesAdded
        : [];
    for (const addition of additions) {
      const id = String(addition?.message?.id || "").trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
