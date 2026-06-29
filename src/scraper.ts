import { parse } from 'node-html-parser';

export async function fetchAndExtract(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} cho ${url}`);
  }

  const html = await res.text();

  try {
    const root = parse(html);
    const title = root.querySelector('title')?.text?.trim() || '';

    // Try <article>
    let el = root.querySelector('article');
    // Try <main>
    if (!el) el = root.querySelector('main');
    // Try content="class"
    if (!el) {
      const candidates = root.querySelectorAll('[class*="content"], [class*="article"], [class*="help"]');
      for (const c of candidates) {
        const txt = c.text?.trim() || '';
        if (txt.length > 200) {
          el = c;
          break;
        }
      }
    }

    let content = el ? (el.text || '').trim() : html;
    content = content
      .replace(/[\r\n]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!content || content.length < 100) {
      // last resort: full text
      content = root.text.trim();
    }

    return { title: title.replace(/\s+/g, ' ').trim(), content };
  } catch (err) {
    return {
      title,
      content: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    };
  }
}
