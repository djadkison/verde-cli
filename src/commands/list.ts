import { parse, COMMON_OPTIONS, int } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, memoryList, type WireMemory } from "../render.js";

export const listHelp = `Recently created or updated documents.

Usage
  verde list [--limit <n>] [--vault <vault>] [--json]

Options
  --limit <n>   1–50 (default 15).
`;

type RecentResult = { vault?: string; results?: WireMemory[] };

export async function list(argv: string[]): Promise<void> {
  const { flags } = parse(argv, { ...COMMON_OPTIONS, limit: { type: "string" } }, "list");
  if (flags.help) return void process.stdout.write(listHelp);

  const ctx = await contextFrom(flags);
  const result = await callTool<RecentResult>("list_recent_memories", { limit: int(flags, "limit") }, ctx);
  if (wantsJson(flags)) return printJson(result);
  process.stdout.write(`${memoryList(result.results ?? [], "Nothing here yet.")}\n`);
}
