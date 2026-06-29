export async function fetchAndExtract(url: string): Promise<{ title: string; content: string; links: string[] }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} cho ${url}`);

  const html = await res.text();

  // Extract links (href inside <a>)
  const links: string[] = [];
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.push(m[1]);
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Extract body text: strip tags, collapse whitespace
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 100) text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return { title: title.replace(/\s+/g, ' ').trim(), content: text, links };
}
