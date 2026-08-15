import {
  chooseUniqueClientId,
  decodeBase64Url,
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
