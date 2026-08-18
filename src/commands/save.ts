import { parse, COMMON_OPTIONS, str, bool, list, oneOf } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { resolveContent, titleFromContent } from "../content.js";
import { printJson, green, dim, type WireMemory } from "../render.js";
import { writtenMemory, type MemoryResult } from "../wire.js";
import { MEMORY_TYPES, VISIBILITIES, DISPLAYS } from "../vocab.js";
import { CliError } from "../errors.js";

export const saveHelp = `Save a new document.

Usage
  verde save --bucket <bucket> --type <type> [--title <title>] [content]
  cat notes.md | verde save --bucket Decisions --type decision

Content comes from a positional argument, --file, or piped stdin — one of them.
If the body starts with a markdown heading, --title is inferred from it.

Options
  --bucket <bucket>       Bucket name or id. Required.
  --type <type>           Required. ${MEMORY_TYPES.join(", ")}
  --title <title>         2–200 chars. Inferred from a leading "# heading" if omitted.
  --file <path>           Read the body from a file.
  --content <text>        The body inline.
  --visibility <level>    ${VISIBILITIES.join(" | ")} (defaults to the bucket's).
  --tag <tag>             Repeatable, up to 20.
  --source <text>         Where this came from.
  --effective <date>      ISO date this becomes effective.
  --expires <date>        ISO date this stops being valid.
  --display <mode>        ${DISPLAYS.join(" | ")} — 'canvas' is the full reader layout.
  --publish               Publish immediately rather than leaving a draft.
  --draft                 Force a draft even where one would publish by default.

Drafts vs published, which is not uniform and is worth knowing:
  private   publishes on save by default (it is visible only to you regardless)
  company   saves as a draft unless --publish
  public    ALWAYS saves as a draft — taking it live is a separate, confirmed
            \`verde publish --confirm-public\`, because that puts it on the open web
Either default can be overridden with --publish or --draft.
  --vault <vault>
  --json
`;

export async function save(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(
    argv,
    {
      ...COMMON_OPTIONS,
      bucket: { type: "string" },
      type: { type: "string" },
      title: { type: "string" },
      file: { type: "string" },
      content: { type: "string" },
      visibility: { type: "string" },
      tag: { type: "string", multiple: true },
      source: { type: "string" },
      effective: { type: "string" },
      expires: { type: "string" },
      display: { type: "string" },
      publish: { type: "boolean" },
      draft: { type: "boolean" },
    },
    "save",
  );
  if (flags.help) return void process.stdout.write(saveHelp);

  const positional = positionals.join(" ").trim();
  const content = positional || (await resolveContent(flags, false));
  if (!content) {
    throw new CliError("No content given.", {
      hint: 'Pass it as an argument, --file <path>, or pipe it: `cat notes.md | verde save …`',
    });
  }

  const bucket = str(flags, "bucket");
  if (!bucket) throw new CliError("--bucket is required.", { hint: "See `verde buckets` for the ones in this vault." });

  const type = oneOf(str(flags, "type"), MEMORY_TYPES, "--type");
  if (!type) throw new CliError("--type is required.", { hint: `One of: ${MEMORY_TYPES.join(", ")}` });

  const title = str(flags, "title") ?? titleFromContent(content);
  if (!title) {
    throw new CliError("No title given and none could be inferred.", {
      hint: 'Pass --title "…", or start the body with a markdown heading.',
    });
  }

  if (bool(flags, "publish") && bool(flags, "draft")) {
    throw new CliError("--publish and --draft contradict each other.");
  }
  // Sent only when asked for: the server's default differs per visibility, and
  // hardcoding either value here would flatten that.
  const publish = bool(flags, "publish") ? true : bool(flags, "draft") ? false : undefined;

  const ctx = await contextFrom(flags);
  const result = await callTool<MemoryResult>(
    "propose_memory",
    {
      bucket,
      title,
      content,
      type,
      visibility: oneOf(str(flags, "visibility"), VISIBILITIES, "--visibility"),
      tags: list(flags, "tag"),
      source_description: str(flags, "source"),
      effective_date: str(flags, "effective"),
      expires_date: str(flags, "expires"),
      display: oneOf(str(flags, "display"), DISPLAYS, "--display"),
      publish,
    },
    ctx,
  );

  if (wantsJson(flags)) return printJson(result);
  reportSaved(writtenMemory(result), result.result ?? "Saved.");
}

export function reportSaved(memory: WireMemory | undefined, fallback: string): void {
  process.stdout.write(`${green(fallback)}\n`);
  if (memory?.title) process.stdout.write(`${memory.title}${memory.status ? dim(` (${memory.status})`) : ""}\n`);
  if (memory?.id) process.stdout.write(`${dim(memory.id)}\n`);
  if (memory?.url) process.stdout.write(`${dim(memory.url)}\n`);
}
