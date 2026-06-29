export async function tgRequest(token: string, method: string, payload: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json<{ ok: boolean; description?: string }>();
  if (!data.ok) {
    throw new Error(data.description || `TG ${method} failed`);
  }
  return data;
}

export async function sendMessage(token: string, chatId: string, text: string, parseMode?: string) {
  return tgRequest(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
}
