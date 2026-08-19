export type WhatsAppMessage = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  context?: { id?: string };
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: {
    id?: string;
    caption?: string;
    filename?: string;
    mime_type?: string;
  };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  video?: { id?: string; caption?: string; mime_type?: string };
  sticker?: { id?: string; mime_type?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  contacts?: unknown[];
  order?: unknown;
  reaction?: { message_id?: string; emoji?: string };
};

export type WhatsAppWebhookValue = {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WhatsAppMessage[];
  message_echoes?: WhatsAppMessage[];
  statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    conversation?: { id?: string; origin?: { type?: string } };
    errors?: Array<
      {
        code?: string | number;
        title?: string;
        message?: string;
        error_data?: unknown;
      }
    >;
  }>;
};

export type ParsedWhatsAppMessage = {
  providerMessageId: string;
  senderPhone: string;
  recipientPhone: string;
  senderName: string | null;
  messageType: string;
  body: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

const MAX_BODY_CHARACTERS = 200_000;

export function normalizeWhatsAppPhone(
  value: string | null | undefined,
): string {
  return String(value || "").replace(/[^0-9]/g, "");
}

function mediaBody(label: string, caption?: string): string {
  const cleanCaption = String(caption || "").trim();
  return cleanCaption ? `${label}: ${cleanCaption}` : label;
}

export function whatsappMessageBody(message: WhatsAppMessage): string {
  switch (message.type) {
    case "text":
      return String(message.text?.body || "").trim();
    case "image":
      return mediaBody("[Image]", message.image?.caption);
    case "document":
      return mediaBody(
        message.document?.filename
          ? `[Document: ${message.document.filename}]`
          : "[Document]",
        message.document?.caption,
      );
    case "audio":
      return message.audio?.voice ? "[Voice message]" : "[Audio]";
    case "video":
      return mediaBody("[Video]", message.video?.caption);
    case "sticker":
      return "[Sticker]";
    case "button":
      return String(
        message.button?.text || message.button?.payload || "[Button reply]",
      ).trim();
    case "interactive":
      return String(
        message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          "[Interactive reply]",
      ).trim();
    case "location": {
      const location = message.location;
      const label = [location?.name, location?.address].filter(Boolean).join(
        " · ",
      );
      const coordinates = Number.isFinite(location?.latitude) &&
          Number.isFinite(location?.longitude)
        ? `${location?.latitude}, ${location?.longitude}`
        : "";
      return `[Location${
        label ? `: ${label}` : coordinates ? `: ${coordinates}` : ""
      }]`;
    }
    case "contacts":
      return `[Contact card${(message.contacts?.length || 0) > 1 ? "s" : ""}]`;
    case "order":
      return "[Order]";
    case "reaction":
      return message.reaction?.emoji
        ? `[Reaction: ${message.reaction.emoji}]`
        : "[Reaction removed]";
    default:
      return "[Unsupported WhatsApp message]";
  }
}

function mediaMetadata(message: WhatsAppMessage): Record<string, unknown> {
  const source = message.image || message.document || message.audio ||
    message.video || message.sticker;
  if (!source) return {};
  return {
    media_id: source.id || null,
    mime_type: source.mime_type || null,
  };
}

export function parseWhatsAppMessage(
  value: WhatsAppWebhookValue,
  message: WhatsAppMessage,
): ParsedWhatsAppMessage {
  const providerMessageId = String(message.id || "").trim();
  const senderPhone = normalizeWhatsAppPhone(message.from);
  const recipientPhone = normalizeWhatsAppPhone(
    value.metadata?.display_phone_number,
  );
  if (!providerMessageId) throw new Error("WhatsApp message ID is missing");
  if (!senderPhone) throw new Error("WhatsApp sender is missing");
  if (!value.metadata?.phone_number_id) {
    throw new Error("WhatsApp phone number ID is missing");
  }

  const profile = value.contacts?.find((contact) =>
    normalizeWhatsAppPhone(contact.wa_id) === senderPhone
  )?.profile;
  const timestamp = Number(message.timestamp);
  const occurredAt = new Date(
    Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now(),
  ).toISOString();
  const body = whatsappMessageBody(message).slice(0, MAX_BODY_CHARACTERS);

  return {
    providerMessageId,
    senderPhone,
    recipientPhone,
    senderName: String(profile?.name || "").trim() || null,
    messageType: String(message.type || "unknown"),
    body: body || "[Empty WhatsApp message]",
    occurredAt,
    metadata: {
      reply_to_provider_message_id: message.context?.id || null,
      ...mediaMetadata(message),
    },
  };
}

export function parseWhatsAppEchoMessage(
  value: WhatsAppWebhookValue,
  message: WhatsAppMessage,
): ParsedWhatsAppMessage {
  const providerMessageId = String(message.id || "").trim();
  const senderPhone = normalizeWhatsAppPhone(
    message.from || value.metadata?.display_phone_number,
  );
  const recipientPhone = normalizeWhatsAppPhone(message.to);
  if (!providerMessageId) {
    throw new Error("WhatsApp echo message ID is missing");
  }
  if (!senderPhone) throw new Error("WhatsApp business sender is missing");
  if (!recipientPhone) throw new Error("WhatsApp echo recipient is missing");
  if (!value.metadata?.phone_number_id) {
    throw new Error("WhatsApp phone number ID is missing");
  }

  const timestamp = Number(message.timestamp);
  const body = whatsappMessageBody(message).slice(0, MAX_BODY_CHARACTERS);
  return {
    providerMessageId,
    senderPhone,
    recipientPhone,
    senderName: null,
    messageType: String(message.type || "unknown"),
    body: body || "[Empty WhatsApp message]",
    occurredAt: new Date(
      Number.isFinite(timestamp) && timestamp > 0
        ? timestamp * 1000
        : Date.now(),
    ).toISOString(),
    metadata: {
      source: "whatsapp_business_app",
      reply_to_provider_message_id: message.context?.id || null,
      ...mediaMetadata(message),
    },
  };
}

export function safeWhatsAppStatus(value: string | null | undefined):
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | null {
  return ["sent", "delivered", "read", "failed"].includes(String(value || ""))
    ? value as "sent" | "delivered" | "read" | "failed"
    : null;
}
