import { Router } from 'itty-router';
import type { EnvWithKV } from './types';
import { sendMessage } from './telegram';
import { saveSnapshot, latestSnapshot, allSnapshots } from './kv';
import { fetchAndExtract } from './scraper';
import { computeDiff, summarizeChange } from './diff';

let urlCache: string[] | null = null;

async function getUrlList(env: EnvWithKV): Promise<string[]> {
  if (urlCache) return urlCache;
  const raw = await env.bindings.kv.get('URLS', 'text');
  urlCache = raw ? raw.split('|').filter(Boolean) : [];
  return urlCache;
}

export const router = Router();
router.get('/', () => new Response('TBC Bot is running', { status: 200 }));

router.post('/webhook/:token', async (request, env: EnvWithKV) => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const update = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!update) return new Response('Bad Request', { status: 400 });

  const allowed = env.ALLOWED_CHAT_ID;
  const message = (update as { message?: Record<string, unknown> }).message as Record<string, unknown> | undefined;
  if (!message || !allowed) return new Response('ok');

  const chatId = String(((message?.chat as Record<string, unknown>))?.id || '');
  if (chatId !== allowed) return new Response('Forbidden', { status: 403 });

  const text = String((message as Record<string, unknown>)?.text || '').trim();

  try {
    await handleMessage(text, chatId, env);
  } catch (err) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Lỗi xử lý: ${err instanceof Error ? err.message : String(err)}`);
  }
  return new Response('ok');
});

async function handleMessage(text: string, chatId: string, env: EnvWithKV) {
  if (text.startsWith('/start')) {
    const count = await getUrlList(env).length;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `TBC Monitor bot đã sẵn sàng.\nTổng URLs: ${count}\nLệnh: /start, /all, /scan, /cron, /latest, /changes, /tree`);
    return;
  }

  if (text.startsWith('/all')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Đang quét toàn bộ trang...');
    const urls = await getUrlList(env);
    const out: string[] = [];
    for (const u of urls) {
      try {
        const snap = await fetchAndExtract(u);
        await saveSnapshot(env.bindings.kv, u, snap);
        out.push(u);
        if (out.length % 10 === 0) await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Đã quét ${out.length}/${urls.length}...`);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ Lỗi quét ${u}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Quét xong ${out.length} trang.`);
    return;
  }

  if (text.startsWith('/scan')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Đang scan toàn bộ...');
    const urls = await getUrlList(env);
    for (const u of urls) {
      try {
        const snap = await fetchAndExtract(u);
        const prev = await latestSnapshot(env.bindings.kv, u);
        if (prev && prev.content !== snap.content) {
          const diff = computeDiff(prev.content, snap.content);
          const sum = summarizeChange(diff.added, diff.removed);
          await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🔔 Thay đổi:\n${u}\n${sum}`);
        }
        await saveSnapshot(env.bindings.kv, u, snap);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ Lỗi scan ${u}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '✅ Scan xong.');
    return;
  }

  if (text.startsWith('/cron')) {
    const count = await getUrlList(env).length;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Cron: active\nSchedule: 0 */12 * * *\nURLs: ${count}\n/tree liệt kê cây web đã quét`);
    return;
  }

  if (text.startsWith('/latest')) {
    const urls = await getUrlList(env);
    let msg = '📌 Snapshot gần nhất:\n';
    for (const u of urls) {
      const snap = await latestSnapshot(env.bindings.kv, u);
      msg += `\n• ${u}\n  Title: ${snap ? snap.title : 'chưa có'}\n  At: ${snap ? snap.at.split('T')[0] : ''}`;
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    return;
  }

  if (text.startsWith('/changes')) {
    const urls = await getUrlList(env);
    let full = '📝 Thay đổi gần nhất:\n';
    for (const u of urls) {
      const snaps = await allSnapshots(env.bindings.kv, u);
      if (snaps.length < 2) {
        full += `\n• ${u}: chưa đủ dữ liệu`;
        continue;
      }
      const [oldSnap, newSnap] = [snaps[snaps.length - 2], snaps[snaps.length - 1]];
      const diff = await (await import('./diff')).computeDiff(oldSnap.content, newSnap.content);
      const sum = await (await import('./diff')).summarizeChange(diff.added, diff.removed);
      full += `\n• ${u}\n${sum}`;
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, full);
    return;
  }

  if (text.startsWith('/tree')) {
    const urls = await getUrlList(env);
    let msg = '🌳 Cây web HelpCenter TBC:\n\n';
    const sections: Record<string, string[]> = { 'root': [], 'section': [], 'faq': [] };
    for (const u of urls) {
      const trimmed = u.replace(/\/+$/, '');
      if (trimmed === 'https://freedom-tbc.helpshift.com/hc/en/4-trump-billionaire-club') {
        sections['root'].push(u);
      } else if (trimmed.includes('/section/')) {
        sections['section'].push(u);
      } else if (trimmed.includes('/faq/')) {
        sections['faq'].push(u);
      } else {
        sections['root'].push(u);
      }
    }
    const countChecked = async (list: string[]) => {
      let c = 0;
      for (const u of list) {
        const s = await latestSnapshot(env.bindings.kv, u);
        if (s) c++;
      }
      return c;
    };
    const rootChecked = await countChecked(sections['root']);
    const sectionChecked = await countChecked(sections['section']);
    const faqChecked = await countChecked(sections['faq']);
    msg += `📁 Root (${rootChecked}/${sections['root'].length})\n`;
    for (const u of sections['root']) {
      const s = await latestSnapshot(env.bindings.kv, u);
      msg += s ? '  ✅ ' : '  ⬜ ';
      msg += u.replace('https://freedom-tbc.helpshift.com/hc/en/4-trump-billionaire-club', '') || '/\n';
    }
    msg += `\n📂 Sections (${sectionChecked}/${sections['section'].length})\n`;
    for (const u of sections['section']) {
      const s = await latestSnapshot(env.bindings.kv, u);
      const slug = u.split('/section/')[1]?.replace(/\/+$/, '') || u;
      msg += s ? `  ✅ /section/${slug}\n` : `  ⬜ /section/${slug}\n`;
    }
    msg += `\n📄 FAQs (${faqChecked}/${sections['faq'].length})\n`;
    for (const u of sections['faq']) {
      const s = await latestSnapshot(env.bindings.kv, u);
      const slug = u.split('/faq/')[1]?.replace(/\/+$/, '') || u;
      msg += s ? `  ✅ /faq/${slug}\n` : `  ⬜ /faq/${slug}\n`;
    }
    msg += `\nTổng: ${urls.length} URLs | Đã quét: ${rootChecked + sectionChecked + faqChecked}`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    return;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Lệnh: /start, /all (quét toàn bộ), /scan, /cron, /latest, /changes, /tree');
}

export default {
  fetch: router.fetch,
  scheduled,
};

export async function scheduled(_event: { scheduledTime: number }, env: EnvWithKV) {
  const urls = await getUrlList(env);
  const chatId = env.ALLOWED_CHAT_ID;
  let changed = 0;

  const { fetchAndExtract } = await import('./scraper');
  const { saveSnapshot, latestSnapshot } = await import('./kv');
  const { computeDiff, summarizeChange } = await import('./diff');
  const { sendMessage } = await import('./telegram');

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⏰ Bắt đầu cron: ${urls.length} URLs`);

  try {
    for (const base of urls) {
      try {
        const snap = await fetchAndExtract(base);
        const prev = await latestSnapshot(env.bindings.kv, base);
        if (prev && prev.content !== snap.content) {
          const diff = computeDiff(prev.content, snap.content);
          const sum = summarizeChange(diff.added, diff.removed);
          await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🔔 Thay đổi:\n${base}\n${sum}`);
          changed++;
        }
        await saveSnapshot(env.bindings.kv, base, snap);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ Lỗi cron ${base}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Lỗi cron tổng: ${err instanceof Error ? err.message : String(err)}`);
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Cron xong. Thay đổi: ${changed}.`);
}
