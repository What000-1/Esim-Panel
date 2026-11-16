export async function telegramConfig(env) {
  const token = env.TG_BOT_TOKEN || (await env.ESIM_DB?.get("TG_BOT_TOKEN"));
  const chat = env.TG_CHAT_ID || (await env.ESIM_DB?.get("TG_CHAT_ID"));
  if (!token || !chat) throw new Error("缺少 TG_BOT_TOKEN 或 TG_CHAT_ID");
  return { token, chat };
}

async function callTelegram(token, method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Telegram 网络请求失败");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    const error = new Error(`Telegram 发送失败（HTTP ${response.status}）`);
    error.retryAfter = Math.min(
      Math.max(Number(data.parameters?.retry_after) || 0, 0),
      86400,
    );
    throw error;
  }
  return data.result;
}

export async function telegramApi(env, method, payload) {
  const { token } = await telegramConfig(env);
  return callTelegram(token, method, payload);
}

export async function sendTelegram(env, text, extra = {}) {
  const { token, chat } = await telegramConfig(env);
  // Plain text avoids splitting HTML entities/tags and treats all card content as data.
  return callTelegram(token, "sendMessage", { chat_id: chat, text, ...extra });
}

// Derived from the bot token so the webhook needs no extra secret; rotating
// the token invalidates the webhook until it is enabled again.
export async function webhookSecret(env) {
  const { token } = await telegramConfig(env);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("esim-panel-telegram-webhook"),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// callback_data: r<e|t>:<YYYYMMDD expiry when sent>:<card id>, at most 64 bytes.
// The expiry makes a repeated or stale press a no-op instead of a second renewal.
export function renewButtons(cardId, expireDate) {
  const date = expireDate.replaceAll("-", "");
  const data = (mode) => `r${mode}:${date}:${cardId}`;
  if (new TextEncoder().encode(data("e")).length > 64) return null;
  return {
    inline_keyboard: [
      [
        { text: "✅ 从到期日续期", callback_data: data("e") },
        { text: "📅 从今天续期", callback_data: data("t") },
      ],
    ],
  };
}

export function parseRenewCallback(data) {
  const match = /^r([et]):(\d{4})(\d{2})(\d{2}):([A-Za-z0-9_-]{1,80})$/.exec(
    typeof data === "string" ? data : "",
  );
  if (!match) return null;
  return {
    mode: match[1] === "e" ? "fromExpiry" : "fromToday",
    expireDate: `${match[2]}-${match[3]}-${match[4]}`,
    cardId: match[5],
  };
}

export function splitMessage(text, limit = 3500) {
  const pieces = [];
  let part = "";
  for (const char of text) {
    if (part.length + char.length > limit) {
      pieces.push(part);
      part = "";
    }
    part += char;
  }
  if (part) pieces.push(part);
  return pieces;
}
