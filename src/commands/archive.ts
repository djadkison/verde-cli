import { parse, COMMON_OPTIONS, bool, requireUuid } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, bold, dim, yellow, green } from "../render.js";
import { documentOf, type GetMemoryResult, type MemoryResult } from "../wire.js";
import { confirm } from "../confirm.js";
import { CliError } from "../errors.js";

export const archiveHelp = `Archive a document.

Usage
  verde archive <id> [--yes]

Archiving is reversible retention, not deletion — the document is kept for
history and excluded from normal retrieval. Archiving a PUBLIC document also
pulls it off the public web immediately.

Options
  --yes, -y   Skip the confirmation.
  --vault <vault>
  --json
`;

export async function archive(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(argv, { ...COMMON_OPTIONS, yes: { type: "boolean", short: "y" } }, "archive");
  if (flags.help) return void process.stdout.write(archiveHelp);

  const id = requireUuid(positionals[0], "document id");
  const ctx = contextFrom(flags);

  const current = await callTool<GetMemoryResult>("get_memory", { id }, ctx);
  const doc = documentOf(current);
  if (!doc) throw new CliError("No such document.");

  process.stderr.write(`${bold(doc.title ?? id)} ${dim(`(${doc.type ?? "?"} · ${doc.visibility ?? "?"})`)}\n`);
  if (doc.visibility === "public" && doc.status === "published") {
    process.stderr.write(`${yellow("This page is live on the public web.")} Archiving removes it immediately.\n`);
  }
  await confirm("Archive it?", { yes: bool(flags, "yes") });

  const result = await callTool<MemoryResult>("archive_memory", { id }, ctx);
  if (wantsJson(flags)) return printJson(result);
  process.stdout.write(`${green(result.result ?? "Archived.")}\n`);
  process.stdout.write(dim("Nothing was deleted — `verde search --historical` still finds it.\n"));
}
