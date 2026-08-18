import { parse, COMMON_OPTIONS, str, bool, list, oneOf, requireUuid } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { resolveContent, titleFromContent } from "../content.js";
import { printJson, bold, dim } from "../render.js";
import { documentOf, writtenMemory, type GetMemoryResult, type SupersedeResult } from "../wire.js";
import { reportSaved } from "./save.js";
import { confirm } from "../confirm.js";
import { MEMORY_TYPES } from "../vocab.js";
import { CliError } from "../errors.js";

export const supersedeHelp = `Replace a document with a new version.

Usage
  verde supersede <old-id> --title <title> [content]
  cat revised.md | verde supersede <old-id>

The old document stays readable as history and is marked superseded. Use this
when the meaning changed; use \`verde update\` for corrections in place.

Options
  --title <title>     Title of the replacement. Inferred from a leading heading.
  --content <text>    Body of the replacement. Or --file, or piped stdin.
  --file <path>
  --type <type>       Defaults to the old document's type.
  --bucket <bucket>   Bucket for the replacement.
  --tag <tag>         Repeatable.
  --source <text>
  --effective <date>
  --yes, -y           Skip the confirmation.
  --vault <vault>
  --json
`;

export async function supersede(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(
    argv,
    {
      ...COMMON_OPTIONS,
      title: { type: "string" },
      content: { type: "string" },
      file: { type: "string" },
      type: { type: "string" },
      bucket: { type: "string" },
      tag: { type: "string", multiple: true },
      source: { type: "string" },
      effective: { type: "string" },
      yes: { type: "boolean", short: "y" },
    },
    "supersede",
  );
  if (flags.help) return void process.stdout.write(supersedeHelp);

  const oldId = requireUuid(positionals[0], "the id of the document being replaced");
  const positional = positionals.slice(1).join(" ").trim();
  const content = positional || (await resolveContent(flags, false));
  if (!content) {
    throw new CliError("No replacement content given.", {
      hint: 'Pass it as an argument, --file <path>, or pipe it.',
    });
  }

  const title = str(flags, "title") ?? titleFromContent(content);
  if (!title) {
    throw new CliError("No title given for the replacement.", {
      hint: 'Pass --title "…", or start the body with a markdown heading.',
    });
  }

  const ctx = await contextFrom(flags);

  // Name what is being replaced. "Supersede 8f3a…?" is not a question anyone
  // can answer correctly.
  const current = await callTool<GetMemoryResult>("get_memory", { id: oldId }, ctx);
  const doc = documentOf(current);
  if (!doc) throw new CliError("No such document.");

  process.stderr.write(`Replacing ${bold(doc.title ?? oldId)} ${dim(`(${doc.type ?? "?"} · ${doc.visibility ?? "?"})`)}\n`);
  process.stderr.write(`with       ${bold(title)}\n`);
  await confirm("Supersede it?", { yes: bool(flags, "yes") });

  const result = await callTool<SupersedeResult>(
    "supersede_memory",
    {
      old_memory_id: oldId,
      title,
      content,
      type: oneOf(str(flags, "type"), MEMORY_TYPES, "--type"),
      bucket: str(flags, "bucket"),
      tags: list(flags, "tag"),
      source_description: str(flags, "source"),
      effective_date: str(flags, "effective"),
    },
    ctx,
  );

  if (wantsJson(flags)) return printJson(result);
  reportSaved(writtenMemory(result), result.result ?? "Superseded.");
}
