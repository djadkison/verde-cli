import { parse, COMMON_OPTIONS, str, list, int, oneOf, requireUuid } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { resolveContent } from "../content.js";
import { printJson } from "../render.js";
import { writtenMemory, type MemoryResult } from "../wire.js";
import { reportSaved } from "./save.js";
import { MEMORY_TYPES, DISPLAYS } from "../vocab.js";
import { CliError } from "../errors.js";

export const updateHelp = `Correct a document in place.

Usage
  verde update <id> [options]
  cat revised.md | verde update <id>

Use this for fixing wording or filling detail. When the meaning CHANGES, use
\`verde supersede\` instead — it keeps the old document readable as history
rather than overwriting it.

Options
  --title <title>
  --content <text>          New body. Or --file, or piped stdin.
  --file <path>
  --type <type>             ${MEMORY_TYPES.join(", ")}
  --bucket <bucket>         Move to a different bucket.
  --tag <tag>               Repeatable. Replaces the existing tags.
  --source <text>
  --effective <date>
  --expires <date>
  --display <mode>          ${DISPLAYS.join(" | ")}
  --expected-version <n>    The version you last read. The update is refused if
                            the document changed since, instead of overwriting
                            whoever got there first. Always pass it if you have it.
  --vault <vault>
  --json
`;

export async function update(argv: string[]): Promise<void> {
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
      expires: { type: "string" },
      display: { type: "string" },
      "expected-version": { type: "string" },
    },
    "update",
  );
  if (flags.help) return void process.stdout.write(updateHelp);

  const id = requireUuid(positionals[0], "document id");
  const content = await resolveContent(flags, false);

  const fields = {
    title: str(flags, "title"),
    content,
    type: oneOf(str(flags, "type"), MEMORY_TYPES, "--type"),
    bucket: str(flags, "bucket"),
    tags: list(flags, "tag"),
    source_description: str(flags, "source"),
    effective_date: str(flags, "effective"),
    expires_date: str(flags, "expires"),
    display: oneOf(str(flags, "display"), DISPLAYS, "--display"),
  };

  if (Object.values(fields).every((v) => v === undefined)) {
    throw new CliError("Nothing to update.", { hint: "Pass at least one field — see `verde update --help`." });
  }

  const ctx = contextFrom(flags);
  const result = await callTool<MemoryResult>(
    "update_memory",
    { id, expected_version: int(flags, "expected-version"), ...fields },
    ctx,
  );

  if (wantsJson(flags)) return printJson(result);
  reportSaved(writtenMemory(result), result.result ?? "Updated.");
}
