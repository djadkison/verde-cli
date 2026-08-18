import { parse, COMMON_OPTIONS, str, bool, list, int, oneOf, eachOneOf } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, memoryList, dim, type WireMemory } from "../render.js";
import { MEMORY_TYPES, MEMORY_STATUSES, VISIBILITIES } from "../vocab.js";

export const searchHelp = `Search the vault.

Usage
  verde search [query] [options]

Options
  --bucket <name>          Limit to one bucket (name or id).
  --type <type>            Limit to document types. Repeatable, or comma-separated.
                           ${MEMORY_TYPES.join(", ")}
  --status <status>        Explicit status filter: ${MEMORY_STATUSES.join(", ")}
  --visibility <level>     ${VISIBILITIES.join(" | ")}
  --tag <tag>              Require any of these tags. Repeatable.
  --historical             Include superseded and archived documents.
  --updated-after <date>   ISO date.
  --updated-before <date>  ISO date.
  --limit <n>              1–50 (default 10).
  --vault <vault>
  --json                   Full structured results, including every field.

Results carry an excerpt, not the whole document — pass an id to \`verde get\`
for the full text.
`;

type SearchResult = { vault?: string; result_count?: number; results?: WireMemory[]; missed?: boolean };

export async function search(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(
    argv,
    {
      ...COMMON_OPTIONS,
      bucket: { type: "string" },
      type: { type: "string", multiple: true },
      status: { type: "string", multiple: true },
      visibility: { type: "string" },
      tag: { type: "string", multiple: true },
      historical: { type: "boolean" },
      "updated-after": { type: "string" },
      "updated-before": { type: "string" },
      limit: { type: "string" },
    },
    "search",
  );
  if (flags.help) return void process.stdout.write(searchHelp);

  const ctx = await contextFrom(flags);
  const query = positionals.join(" ").trim() || undefined;

  const result = await callTool<SearchResult>(
    "search_memories",
    {
      query,
      bucket: str(flags, "bucket"),
      types: eachOneOf(list(flags, "type"), MEMORY_TYPES, "--type"),
      statuses: eachOneOf(list(flags, "status"), MEMORY_STATUSES, "--status"),
      visibility: oneOf(str(flags, "visibility"), VISIBILITIES, "--visibility"),
      tags: list(flags, "tag"),
      include_historical: bool(flags, "historical") || undefined,
      updated_after: str(flags, "updated-after"),
      updated_before: str(flags, "updated-before"),
      limit: int(flags, "limit") ?? 10,
    },
    ctx,
  );

  if (wantsJson(flags)) return printJson(result);

  const results = result.results ?? [];
  process.stdout.write(`${memoryList(results, "No matching documents.")}\n`);
  if (results.length) {
    process.stdout.write(dim(`\n${results.length} result${results.length === 1 ? "" : "s"} in ${result.vault ?? "vault"}\n`));
  }
}
