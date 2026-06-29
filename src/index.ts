import { Router } from 'itty-router';
import { fetchAndExtract } from './scraper';
import { computeDiff, summarizeChange } from './diff';
import { sendMessage } from './telegram';
import { saveSnapshot, latestSnapshot, allSnapshots } from './kv';
import { runScheduledScan } from './cron';
import type { EnvWithKV } from './types';

export { Router };

export const router = Router();
router.get('/', () => new Response('TBC Bot is running', { status: 200 }));

// Telegram webhook entry
router.post('/webhook/:token', async (request, env: EnvWithKV) => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const update = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!update) return new Response('Bad Request', { status: 400 });

  const allowed = env.ALLOWED_CHAT_ID;
  const message = (update as { message?: Record<string, unknown> }).message as
    | Record<string, unknown>
    | undefined;

  if (!message || !allowed) return new Response('ok');

  const chatId = String((message.chat as Record<string, unknown>)?.id || '');
  if (chatId !== allowed) return new Response('Forbidden', { status: 403 });

  const text = String((message as Record<string, unknown>)?.text || '').trim();
  const fromId = String(((message as Record<string, unknown>).from as Record<string, unknown>)?.id || '');

  try {
    await handleMessage(text, chatId, fromId, env);
  } catch (err) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `❌ Lỗi xử lý: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return new Response('ok');
});

// Manual trigger for 12h scan
router.get('/cron/scan', async (_, env: EnvWithKV) => {
  const auth = new URL(_.url).searchParams.get('auth');
  if (!auth || auth !== env.CRON_SECRET) return new Response('Forbidden', { status: 403 });
  await runScanCycle(env);
  return new Response('Scanned', { status: 200 });
});

// Query endpoint: /query?q=...
router.get('/query', async (req, env) => {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  if (!q) return new Response('Missing q', { status: 400 });

  const chatId = url.searchParams.get('chatId') || '';
  if (chatId !== env.ALLOWED_CHAT_ID) return new Response('Forbidden', { status: 403 });

  const urls = (env.URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  const lines: string[] = [`🔎 Tra cứu: ${q}`];

  for (const u of urls) {
    const snap = await latestSnapshot(env.kv, u);
    if (!snap) {
      lines.push(`\nURL: ${u}\nChưa có snapshot.`);
      continue;
    }
    const hay = (snap.title + '\n' + snap.content).toLowerCase();
    const ql = q.toLowerCase();
    const matched = hay.includes(ql);
    const ctx = matched ? extractContext(snap.content, ql) : '(không có đoạn trùng khớp)';
    lines.push(`\nURL: ${u}\nTiêu đề: ${snap.title}\nTại: ${snap.at.split('T')[0]}\nĐoạn trùng khớp:\n${ctx}`);
  }

  if (chatId) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
    return new Response('ok');
  }
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain;charset=utf-8' } });
});

async function handleMessage(text: string, chatId: string, _fromId: string, env: EnvWithKV) {
  if (text.startsWith('/start')) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      'TBC Monitor bot đã sẵn sàng.\nLệnh:\n/scan - chạy scan tất cả URLs\n/latest - báo snapshot gần nhất\n/changes - báo thay đổi gần nhất\n/chatids - chat id hiện tại',
    );
    return;
  }

  if (text.startsWith('/chatids')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `ChatId: ${chatId}`);
    return;
  }

  if (text.startsWith('/scan')) {
    await runScanCycle(env);
    return;
  }

  if (text.startsWith('/latest')) {
    const urls = (env.URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
    let msg = '📌 Snapshot gần nhất:\n';
    for (const u of urls) {
      const snap = await latestSnapshot(env.kv, u);
      msg += `\n${snap ? `• ${u}\n  Title: ${snap.title}\n  At: ${snap.at.split('T')[0]}` : `• ${u}: chưa có`}`;
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    return;
  }

  if (text.startsWith('/changes')) {
    const urls = (env.URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
    let full = '📝 Thay đổi gần nhất:\n';
    for (const u of urls) {
      const snaps = await allSnapshots(env.kv, u);
      if (snaps.length < 2) {
        full += `\n• ${u}: chưa đủ dữ liệu để so sánh`;
        continue;
      }
      const [oldSnap, newSnap] = [snaps[snaps.length - 2], snaps[snaps.length - 1]];
      const diff = computeDiff(oldSnap.content, newSnap.content);
      const sum = summarizeChange(diff.added, diff.removed);
      full += `\n• ${u}\n${sum}`;
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, full);
    return;
  }

  // Free text search on latest snapshots
  if (text.startsWith('/')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Lệnh không hợp lệ. Dùng /scan, /latest, /changes.');
    return;
  }

  const urls = (env.URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  const lines: string[] = [`🔎 "${text}"`];
  for (const u of urls) {
    const snap = await latestSnapshot(env.kv, u);
    if (!snap) { lines.push(`\n• ${u}: chưa có snapshot`); continue; }
    const combined = (snap.title + '\n' + snap.content).toLowerCase();
    const ql = text.toLowerCase();
    const found = combined.includes(ql);
    lines.push(
      `\n• ${u}${found ? ' ✅' : ' ❌'}`,
      `Title: ${snap.title}`,
      `At: ${snap.at.split('T')[0]}`,
      found ? `Đoạn trùng: ${extractContext(snap.content, ql)}` : '',
    );
  }
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
}

async function runScanCycle(env: EnvWithKV) {
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
        await sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          `🔔 Thay đổi tại\n${u}\nThời gian: ${snap.title}\n${sum}`,
        );
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

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ Scan xong ${urls.length} URLs. Thay đổi: ${changed}.`,
  );
}

function extractContext(text: string, q: string, window = 160): string {
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return '(không xác định)';
  const start = Math.max(0, idx - window);
  const end = Math.min(text.length, idx + q.length + window);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

export default router;

export async function scheduled(event: ScheduledEvent, env: EnvWithKV) {
  await runScheduledScan(env);
}
