/** Shapes returned by Verde's tools — only the fields the CLI renders. */
export type WireMemory = {
  id?: string;
  title?: string;
  type?: string;
  status?: string;
  visibility?: string;
  bucket?: string;
  bucket_name?: string;
  excerpt?: string;
  content?: string;
  url?: string;
  version?: number;
  updated_at?: string;
  created_by_name?: string;
  tags?: string[];
  pinned?: boolean;
  is_current?: boolean;
};

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);

export { dim, bold, green, yellow };

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * One document, one block. Id last and dimmed: it is the thing you copy into
 * the next command, so it wants to be findable but not to dominate the line.
 */
export function memoryBlock(m: WireMemory): string {
  const lines: string[] = [];
  const badges = [m.type, m.status && m.status !== "published" ? m.status : undefined, m.visibility]
    .filter(Boolean)
    .join(" · ");
  lines.push(`${m.pinned ? "📌 " : ""}${bold(m.title ?? "(untitled)")}`);
  const meta = [badges, m.bucket_name ?? m.bucket, m.created_by_name].filter(Boolean).join("  ");
  if (meta) lines.push(dim(`   ${meta}`));
  const body = m.excerpt ?? m.content;
  if (body) {
    for (const line of wrap(body.trim(), 76)) lines.push(`   ${line}`);
  }
  if (m.id) lines.push(dim(`   ${m.id}`));
  return lines.join("\n");
}

export function memoryList(items: WireMemory[], empty: string): string {
  if (!items.length) return dim(empty);
  return items.map(memoryBlock).join("\n\n");
}

/** Naive greedy wrap; long unbroken tokens (urls, ids) are left intact. */
export function wrap(text: string, width: number, maxLines = 4): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!line.length) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      if (out.length >= maxLines) return [...out.slice(0, maxLines), "…"];
    }
    if (line) out.push(line);
    if (out.length >= maxLines) return [...out.slice(0, maxLines), "…"];
  }
  return out;
}

/** Left-aligned columns, sized to content. Used for vaults and buckets. */
export function table(rows: string[][]): string {
  if (!rows.length) return "";
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join("  "))
    .join("\n");
}
