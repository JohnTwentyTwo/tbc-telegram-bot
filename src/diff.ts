export function computeDiff(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];

  try {
    // Dynamic import để tránh lỗi resolve trong môi trường có adapter
    // Nhưng diff package đã được add, sử dụng require trong CF adapter pattern
  } catch {}

  // Fallback: line-based diff đơn giản
  const oldLines = oldText.split('\n').filter((l) => l.trim());
  const newLines = newText.split('\n').filter((l) => l.trim());

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const l of newLines) {
    if (!oldSet.has(l)) added.push(l);
  }
  for (const l of oldLines) {
    if (!newSet.has(l)) removed.push(l);
  }

  return { added, removed };
}

export function summarizeChange(a: string[], r: string[]): string {
  const out: string[] = [];
  const max = 12;
  out.push(`🆕 +${a.length} dòng mới`);
  for (let i = 0; i < Math.min(a.length, max); i++) out.push(`  + ${a[i]}`);
  if (a.length > max) out.push(`  ... và ${a.length - max} dòng nữa`);

  out.push(`🗑️ -${r.length} dòng bị xóa/bỏ`);
  for (let i = 0; i < Math.min(r.length, max); i++) out.push(`  - ${r[i]}`);
  if (r.length > max) out.push(`  ... và ${r.length - max} dòng nữa`);

  if (a.length === 0 && r.length === 0) out.push('Không có thay đổi nội dung đáng kể.');

  return out.join('\n');
}
