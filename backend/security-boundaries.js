export const CHAT_INPUT_LIMITS = Object.freeze({
  maxMessages: 50,
  maxMessageChars: 12_000,
  maxTotalChars: 48_000,
});

export class RequestBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RequestBoundaryError";
    this.status = 400;
    this.code = code;
  }
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new RequestBoundaryError("CHAT_CONTENT_INVALID", "Each chat message must contain text.");
  }
  const parts = [];
  for (const block of content) {
    if (!block || block.type !== "text" || typeof block.text !== "string") {
      throw new RequestBoundaryError(
        "CHAT_CONTENT_UNSUPPORTED",
        "Only text chat content is supported.",
      );
    }
    parts.push(block.text);
  }
  return parts.join("\n");
}

export function normalizeChatMessages(messages, { clientSystem } = {}) {
  if (clientSystem != null && String(clientSystem).trim()) {
    throw new RequestBoundaryError(
      "CHAT_SYSTEM_FORBIDDEN",
      "The system prompt is administrator-managed.",
    );
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new RequestBoundaryError("CHAT_MESSAGES_REQUIRED", "Messages array is required.");
  }
  if (messages.length > CHAT_INPUT_LIMITS.maxMessages) {
    throw new RequestBoundaryError("CHAT_MESSAGES_TOO_MANY", "Too many messages.");
  }

  let totalChars = 0;
  const normalized = messages.map((message) => {
    if (!message || typeof message !== "object") {
      throw new RequestBoundaryError("CHAT_MESSAGE_INVALID", "Each chat message must be an object.");
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw new RequestBoundaryError(
        "CHAT_ROLE_FORBIDDEN",
        "Chat message roles are limited to user and assistant.",
      );
    }
    const content = messageText(message.content);
    if (content.includes("\0")) {
      throw new RequestBoundaryError("CHAT_CONTENT_INVALID", "Chat text contains an invalid character.");
    }
    if (content.length > CHAT_INPUT_LIMITS.maxMessageChars) {
      throw new RequestBoundaryError(
        "CHAT_MESSAGE_TOO_LARGE",
        `Each chat message must be ${CHAT_INPUT_LIMITS.maxMessageChars.toLocaleString("en-US")} characters or fewer.`,
      );
    }
    totalChars += content.length;
    if (totalChars > CHAT_INPUT_LIMITS.maxTotalChars) {
      throw new RequestBoundaryError(
        "CHAT_INPUT_TOO_LARGE",
        `Total chat input must be ${CHAT_INPUT_LIMITS.maxTotalChars.toLocaleString("en-US")} characters or fewer.`,
      );
    }
    return { role: message.role, content };
  });

  if (normalized.at(-1)?.role !== "user" || !normalized.at(-1)?.content.trim()) {
    throw new RequestBoundaryError(
      "CHAT_FINAL_USER_REQUIRED",
      "The final message must be non-empty user text.",
    );
  }
  return normalized;
}

export function resolveLoopbackHost(rawHost) {
  const value = String(rawHost || "127.0.0.1").trim().toLowerCase();
  if (value === "127.0.0.1" || value === "localhost") return "127.0.0.1";
  if (value === "::1" || value === "[::1]") return "::1";
  const error = new Error("HOST must bind to a loopback address (127.0.0.1 or ::1).");
  error.code = "invalid_host_binding";
  throw error;
}
