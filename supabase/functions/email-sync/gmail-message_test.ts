import {
  chooseUniqueClientId,
  decideGmailImport,
  decodeBase64Url,
  type GmailMessage,
  htmlToText,
  messageIdsFromHistory,
  parseGmailMessage,
} from "./gmail-message.ts";

function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "Values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function encoded(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function filterMessage(options: {
  id?: string;
  threadId?: string;
  labels?: string[];
  from?: string;
  to?: string;
  extraHeaders?: Array<{ name: string; value: string }>;
} = {}) {
  const message: GmailMessage = {
    id: options.id || "filter-message",
    threadId: options.threadId || "filter-thread",
    labelIds: options.labels || ["INBOX"],
    payload: {
      mimeType: "text/plain",
      headers: [
        {
          name: "From",
          value: options.from || "Unknown <unknown@example.com>",
        },
        {
          name: "To",
          value: options.to || "Lawyer <lawyer@example.com>",
        },
        ...(options.extraHeaders || []),
      ],
      body: { data: encoded("Message body") },
    },
  };
  return parseGmailMessage(message, "lawyer@example.com");
}

function filterDecision(
  message: ReturnType<typeof filterMessage>,
  context: Partial<{
    clientId: string | null;
    existingMessage: boolean;
    existingAcceptedThread: boolean;
  }> = {},
) {
  return decideGmailImport(message, {
    clientId: context.clientId || null,
    existingMessage: context.existingMessage || false,
    existingAcceptedThread: context.existingAcceptedThread || false,
  });
}

Deno.test("parses an inbound unread multipart message and attachment metadata", () => {
  const parsed = parseGmailMessage({
    id: "gmail-inbound-1",
    threadId: "thread-1",
    labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
    internalDate: "1786813200000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Alice Client <alice@example.com>" },
        { name: "To", value: "Lawyer <lawyer@example.com>" },
        { name: "Subject", value: "Matter update" },
        { name: "Message-ID", value: "<incoming-1@example.com>" },
        { name: "In-Reply-To", value: "<earlier@example.com>" },
        {
          name: "References",
          value: "<root@example.com> <earlier@example.com>",
        },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: encoded("Plain message body") },
            },
            {
              mimeType: "text/html",
              body: { data: encoded("<p>HTML message body</p>") },
            },
          ],
        },
        {
          partId: "2",
          mimeType: "application/pdf",
          filename: "evidence.pdf",
          body: { attachmentId: "attachment-1", size: 1234 },
        },
      ],
    },
  }, "lawyer@example.com");

  assertEquals(parsed.direction, "inbound");
  assertEquals(parsed.sender, {
    name: "Alice Client",
    address: "alice@example.com",
  });
  assertEquals(parsed.recipient.address, "lawyer@example.com");
  assertEquals(parsed.clientMatchEmail, "alice@example.com");
  assertEquals(parsed.clientMatchEmails, ["alice@example.com"]);
  assertEquals(parsed.body, "Plain message body");
  assertEquals(parsed.status, "unread");
  assertEquals(parsed.isImportant, true);
  assertEquals(parsed.providerThreadId, "thread-1");
  assertEquals(parsed.internetMessageId, "<incoming-1@example.com>");
  assertEquals(parsed.inReplyTo, "<earlier@example.com>");
  assertEquals(parsed.references, [
    "<root@example.com>",
    "<earlier@example.com>",
  ]);
  assertEquals(parsed.attachments, [{
    providerAttachmentId: "attachment-1",
    filename: "evidence.pdf",
    mimeType: "application/pdf",
    size: 1234,
  }]);
});

Deno.test("parses an externally sent Gmail message as outbound", () => {
  const parsed = parseGmailMessage({
    id: "gmail-sent-1",
    threadId: "thread-sent",
    labelIds: ["SENT"],
    payload: {
      mimeType: "text/html",
      headers: [
        { name: "From", value: "Lawyer <lawyer@example.com>" },
        { name: "To", value: "Client <client@example.com>" },
        { name: "Cc", value: "Colleague <colleague@example.com>" },
        { name: "Subject", value: "Sent in Gmail" },
      ],
      body: {
        data: encoded(
          "<p>Hello <strong>client</strong>.</p><script>ignored()</script>",
        ),
      },
    },
  }, "lawyer@example.com");

  assertEquals(parsed.direction, "outbound");
  assertEquals(parsed.recipient, {
    name: "Client",
    address: "client@example.com",
  });
  assertEquals(parsed.clientMatchEmail, "client@example.com");
  assertEquals(parsed.clientMatchEmails, ["client@example.com"]);
  assertEquals(parsed.body, "Hello client .");
  assertEquals(parsed.cc, ["colleague@example.com"]);
  assertEquals(parsed.status, "read");
});

Deno.test("uses readable HTML and snippet fallbacks without throwing on malformed data", () => {
  assertEquals(
    htmlToText("<div>Hello&nbsp;world<br>Line 2</div>"),
    "Hello world\nLine 2",
  );
  assertEquals(decodeBase64Url("not valid base64!"), "");
  const parsed = parseGmailMessage({
    id: "malformed",
    snippet: "Safe snippet",
    payload: {},
  }, "lawyer@example.com");
  assertEquals(parsed.body, "Safe snippet");
  assertEquals(parsed.skip, false);
});

Deno.test("skips drafts, spam, and trash", () => {
  for (const label of ["DRAFT", "SPAM", "TRASH"]) {
    const parsed = parseGmailMessage({
      id: `skip-${label}`,
      labelIds: [label],
      payload: {},
    }, "lawyer@example.com");
    assertEquals(parsed.skip, true);
  }
});

Deno.test("matches a client only for one case-insensitive exact address", () => {
  assertEquals(
    chooseUniqueClientId([
      { id: "client-1", email: "Client@Example.com" },
      { id: "client-2", email: "other@example.com" },
    ], "client@example.com"),
    "client-1",
  );
  assertEquals(
    chooseUniqueClientId([
      { id: "client-1", email: "client@example.com" },
      { id: "client-2", email: "CLIENT@example.com" },
    ], "client@example.com"),
    null,
  );
  assertEquals(chooseUniqueClientId([], "missing@example.com"), null);
});

Deno.test("deduplicates Gmail message IDs returned by history pages", () => {
  assertEquals(
    messageIdsFromHistory([
      {
        messagesAdded: [{ message: { id: "one" } }, { message: { id: "two" } }],
      },
      { messagesAdded: [{ message: { id: "one" } }, { message: {} }] },
    ]),
    ["one", "two"],
  );
});

Deno.test("imports inbound mail from an exact organization client", () => {
  assertEquals(filterDecision(filterMessage(), { clientId: "client-1" }), {
    import: true,
    reason: "client",
  });
});

Deno.test("skips unmatched inbound mail", () => {
  assertEquals(filterDecision(filterMessage()), {
    import: false,
    reason: "unmatched",
  });
});

Deno.test("skips unknown Promotions, Social, Forums, and Updates category mail", () => {
  for (
    const label of [
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CATEGORY_FORUMS",
      "CATEGORY_UPDATES",
    ]
  ) {
    assertEquals(filterDecision(filterMessage({ labels: [label] })), {
      import: false,
      reason: "category",
    });
  }
});

Deno.test("imports Updates category mail from a known client", () => {
  assertEquals(
    filterDecision(filterMessage({ labels: ["CATEGORY_UPDATES"] }), {
      clientId: "client-1",
    }),
    { import: true, reason: "client" },
  );
});

Deno.test("skips automated senders without client or thread relevance", () => {
  const parsed = filterMessage({ from: "Notices <no-reply@example.com>" });
  assertEquals(parsed.automatedOrBulk, true);
  assertEquals(filterDecision(parsed), { import: false, reason: "bulk" });
});

Deno.test("skips List-Unsubscribe newsletters without client or thread relevance", () => {
  const parsed = filterMessage({
    extraHeaders: [{
      name: "List-Unsubscribe",
      value: "<mailto:unsubscribe@example.com>",
    }],
  });
  assertEquals(parsed.automatedOrBulk, true);
  assertEquals(filterDecision(parsed), { import: false, reason: "bulk" });
});

Deno.test("client relevance overrides automated and bulk indicators", () => {
  const parsed = filterMessage({
    from: "Client Alerts <noreply@client.example>",
    extraHeaders: [{ name: "Precedence", value: "bulk" }],
  });
  assertEquals(filterDecision(parsed, { clientId: "client-1" }), {
    import: true,
    reason: "client",
  });
});

Deno.test("continues an existing accepted Gmail thread", () => {
  assertEquals(
    filterDecision(
      filterMessage({
        labels: ["CATEGORY_UPDATES"],
        from: "Notices <no-reply@example.com>",
      }),
      { existingAcceptedThread: true },
    ),
    { import: true, reason: "existing_thread" },
  );
});

Deno.test("imports direct Gmail outbound mail to any known primary recipient", () => {
  const parsed = filterMessage({
    labels: ["SENT"],
    from: "Lawyer <lawyer@example.com>",
    to: "Unknown <unknown@example.com>, Client <client@example.com>",
  });
  assertEquals(parsed.clientMatchEmails, [
    "unknown@example.com",
    "client@example.com",
  ]);
  assertEquals(filterDecision(parsed, { clientId: "client-1" }), {
    import: true,
    reason: "client",
  });
});

Deno.test("skips direct Gmail outbound mail to unknown recipients", () => {
  const parsed = filterMessage({
    labels: ["SENT"],
    from: "Lawyer <lawyer@example.com>",
    to: "Unknown <unknown@example.com>",
  });
  assertEquals(filterDecision(parsed), {
    import: false,
    reason: "unmatched",
  });
});

Deno.test("keeps an existing FLUXO-sent provider message on its dedup path", () => {
  const parsed = filterMessage({
    id: "already-linked-provider-message",
    labels: ["SENT"],
    from: "Lawyer <lawyer@example.com>",
    to: "Unknown <unknown@example.com>",
  });
  assertEquals(filterDecision(parsed, { existingMessage: true }), {
    import: true,
    reason: "existing_message",
  });
});
