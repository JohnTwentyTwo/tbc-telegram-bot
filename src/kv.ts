export async function saveSnapshot(kv: KVNamespace, url: string, snap: { title: string; content: string }) {
  const key = `snap:${url}:${Date.now()}`;
  const payload = JSON.stringify({ url, title: snap.title, content: snap.content, at: new Date().toISOString() });
  await kv.put(key, payload, { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days
  return key;
}

export async function latestSnapshot(kv: KVNamespace, url: string): Promise<StoredSnapshot | null> {
  const prefix = `snap:${url}:`;
  const list = await kv.list({ prefix, limit: 1 });
  if (!list.keys.length) return null;
  const raw = await kv.get(list.keys[0].name, 'text');
  return raw ? (JSON.parse(raw) as StoredSnapshot) : null;
}

export async function allSnapshots(kv: KVNamespace, url: string): Promise<StoredSnapshot[]> {
  const out: StoredSnapshot[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix: `snap:${url}:`, cursor, limit: 10 });
    for (const k of page.keys) {
      const raw = await kv.get(k.name, 'text');
      if (raw) out.push(JSON.parse(raw) as StoredSnapshot);
    }
    cursor = page.cursor;
    if (!cursor || !page.keys.length) break;
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}
