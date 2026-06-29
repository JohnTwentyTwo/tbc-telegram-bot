export async function runScheduledScan(env: { kv: KVNamespace; TELEGRAM_BOT_TOKEN: string; ALLOWED_CHAT_ID: string; URLS: string }) {
  // Reuse scraper handler; tránh lỗi circular, gọi trực tiếp module scraper tại runtime
  const { fetchAndExtract } = await import('./scraper');
  const { saveSnapshot, latestSnapshot } = await import('./kv');
  const { computeDiff, summarizeChange } = await import('./diff');
  const { sendMessage } = await import('./telegram');

  const urls = (env.URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  const chatId = env.ALLOWED_CHAT_ID;
  let changed = 0;

  for (const u of urls) {
    try {
      const snap = await fetchAndExtract(u);
      const prev = await latestSnapshot(env.kv, u);
      if (prev && prev.content !== snap.content) {
        const diff = computeDiff(prev.content, snap.content);
        const sum = summarizeChange(diff.added, diff.removed);
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🔔 Thay đổi:\n${u}\nThời gian: ${snap.title}\n${sum}`);
        changed++;
      }
      await saveSnapshot(env.kv, u, snap);
    } catch (err) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `⚠️ Lỗi scrape ${u}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Scan xong ${urls.length} URLs. Thay đổi: ${changed}.`);
}
