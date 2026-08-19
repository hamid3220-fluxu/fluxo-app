import {
  normalizeWhatsAppPhone,
  parseWhatsAppEchoMessage,
  parseWhatsAppMessage,
  safeWhatsAppStatus,
  whatsappMessageBody,
} from "./whatsapp-message.ts";
import { validMetaSignature } from "./webhook-security.ts";

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

Deno.test("normalizes WhatsApp phone numbers", () => {
  assertEquals(normalizeWhatsAppPhone("+351 912-345-678"), "351912345678");
});

Deno.test("parses an inbound text message", () => {
  const parsed = parseWhatsAppMessage({
    metadata: {
      display_phone_number: "+351 210 000 000",
      phone_number_id: "phone-id",
    },
    contacts: [{ wa_id: "351912345678", profile: { name: "Ana Silva" } }],
  }, {
    id: "wamid.message-1",
    from: "351912345678",
    timestamp: "1787083200",
    type: "text",
    text: { body: "Hello FLUXO" },
  });

  assertEquals(parsed, {
    providerMessageId: "wamid.message-1",
    senderPhone: "351912345678",
    recipientPhone: "351210000000",
    senderName: "Ana Silva",
    messageType: "text",
    body: "Hello FLUXO",
    occurredAt: "2026-08-18T20:00:00.000Z",
    metadata: { reply_to_provider_message_id: null },
  });
});

Deno.test("creates safe summaries for non-text messages", () => {
  assertEquals(
    whatsappMessageBody({ type: "image", image: { caption: "Receipt" } }),
    "[Image]: Receipt",
  );
  assertEquals(
    whatsappMessageBody({ type: "audio", audio: { voice: true } }),
    "[Voice message]",
  );
  assertEquals(
    whatsappMessageBody({
      type: "interactive",
      interactive: { button_reply: { id: "yes", title: "Yes" } },
    }),
    "Yes",
  );
});

Deno.test("parses a message sent from the WhatsApp Business app", () => {
  const parsed = parseWhatsAppEchoMessage({
    metadata: {
      display_phone_number: "+351 210 000 000",
      phone_number_id: "phone-id",
    },
  }, {
    id: "wamid.echo-1",
    from: "351210000000",
    to: "351912345678",
    timestamp: "1787083200",
    type: "text",
    text: { body: "Sent from the phone" },
  });

  assertEquals(parsed.senderPhone, "351210000000");
  assertEquals(parsed.recipientPhone, "351912345678");
  assertEquals(parsed.metadata.source, "whatsapp_business_app");
});

Deno.test("accepts only supported delivery statuses", () => {
  assertEquals(safeWhatsAppStatus("delivered"), "delivered");
  assertEquals(safeWhatsAppStatus("deleted"), null);
});

Deno.test("verifies Meta webhook signatures", async () => {
  const body = '{"object":"whatsapp_business_account"}';
  const valid =
    "sha256=60b2e09855b25cf88d59953a4025f83bc48cd03865abe988e974b754c7a285e8";
  assertEquals(await validMetaSignature(body, valid, "test-secret"), true);
  assertEquals(
    await validMetaSignature(body, `${valid.slice(0, -1)}0`, "test-secret"),
    false,
  );
  assertEquals(await validMetaSignature(body, null, "test-secret"), false);
});
