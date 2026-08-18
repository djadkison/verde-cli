import { parse, COMMON_OPTIONS, requireUuid, bool } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, bold, dim } from "../render.js";
import { documentsOf, type GetMemoryResult } from "../wire.js";
import { CliError } from "../errors.js";

export const getHelp = `Fetch documents in full.

Usage
  verde get <id> [<id>...] [options]

Up to 20 ids in one call — cheaper than repeated calls, and it is one metered
request rather than twenty.

Options
  --raw     Print only the document content, nothing else. With a single id this
            is exactly the markdown, suitable for piping into a file.
  --vault <vault>
  --json
`;

export async function get(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(argv, { ...COMMON_OPTIONS, raw: { type: "boolean" } }, "get");
  if (flags.help) return void process.stdout.write(getHelp);

  const ids = positionals.map((id) => requireUuid(id, "document id"));
  if (!ids.length) throw new CliError("Missing document id.", { hint: "verde get <id> — ids come from `verde search`." });
  if (ids.length > 20) throw new CliError(`get accepts at most 20 ids at once (got ${ids.length}).`);

  const ctx = await contextFrom(flags);
  const args = ids.length === 1 ? { id: ids[0] } : { ids };
  const result = await callTool<GetMemoryResult>("get_memory", args, ctx);

  if (wantsJson(flags)) return printJson(result);

  const docs = documentsOf(result);
  if (!docs.length) return void process.stdout.write(dim("Not found.\n"));
  // A batch silently drops ids the token cannot see; say so rather than
  // letting a short list read as "those documents do not exist".
  if (ids.length > docs.length) {
    process.stderr.write(dim(`${ids.length - docs.length} of ${ids.length} ids were not found or not visible.\n`));
  }

  if (bool(flags, "raw")) {
    process.stdout.write(`${docs.map((d) => d.content ?? "").join("\n\n---\n\n")}\n`);
    return;
  }

  process.stdout.write(
    `${docs
      .map((d) => {
        const head = [
          bold(d.title ?? "(untitled)"),
          dim([d.type, d.status, d.visibility, d.bucket_name ?? d.bucket].filter(Boolean).join(" · ")),
          d.url ? dim(d.url) : "",
        ]
          .filter(Boolean)
          .join("\n");
        return `${head}\n\n${d.content ?? ""}`;
      })
      .join("\n\n────────\n\n")}\n`,
  );
}
