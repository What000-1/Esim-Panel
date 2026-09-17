export async function telegramConfig(env) {
  const token = env.TG_BOT_TOKEN || (await env.ESIM_DB?.get("TG_BOT_TOKEN"));
  const chat = env.TG_CHAT_ID || (await env.ESIM_DB?.get("TG_CHAT_ID"));
  if (!token || !chat) throw new Error("缺少 TG_BOT_TOKEN 或 TG_CHAT_ID");
  return { token, chat };
}

export async function sendTelegram(env, text) {
  const { token, chat } = await telegramConfig(env);
  // Plain text avoids splitting HTML entities/tags and treats all card content as data.
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
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
