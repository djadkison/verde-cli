import { parse, COMMON_OPTIONS, bool, requireUuid } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, bold, dim, yellow } from "../render.js";
import { documentOf, writtenMemory, type GetMemoryResult, type MemoryResult } from "../wire.js";
import { reportSaved } from "./save.js";
import { confirm } from "../confirm.js";
import { CliError } from "../errors.js";

export const publishHelp = `Take a draft live.

Usage
  verde publish <id> [--confirm-public]

Company and private drafts publish with write permission and no prompt. Only
drafts can be published — a private document usually published itself on save,
so this is mostly for company drafts and for public documents.

A PUBLIC document goes onto the open internet the moment it publishes, so it
needs --confirm-public, and the CLI shows you the full body first. --yes does
NOT cover this: skipping a confirmation in a script is a convenience, and
putting a page on the public web is not the kind of thing a script should be
able to do by inheriting a flag meant for something else.

Options
  --confirm-public   Required to publish a public document.
  --vault <vault>
  --json
`;

export async function publish(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(
    argv,
    { ...COMMON_OPTIONS, "confirm-public": { type: "boolean" }, yes: { type: "boolean", short: "y" } },
    "publish",
  );
  if (flags.help) return void process.stdout.write(publishHelp);

  const id = requireUuid(positionals[0], "document id");
  const ctx = await contextFrom(flags);

  // Read before write: the visibility decides whether this is a routine
  // publish or an irreversible push to the open web, and the user deserves to
  // see which one they asked for.
  const current = await callTool<GetMemoryResult>("get_memory", { id }, ctx);
  const doc = documentOf(current);
  if (!doc) throw new CliError("No such document.");

  const isPublic = doc.visibility === "public";
  if (isPublic) {
    if (!bool(flags, "confirm-public")) {
      process.stderr.write(
        `${yellow("This document is PUBLIC.")} Publishing puts it on the open internet, readable by anyone, immediately.\n\n` +
          `${bold(doc.title ?? "(untitled)")}\n${doc.content ?? ""}\n\n`,
      );
      throw new CliError("Refusing to publish a public document without --confirm-public.", {
        hint: "Re-read the body above, then re-run with --confirm-public.",
      });
    }
    await confirm(`Publish "${doc.title ?? id}" to the open internet?`, { yes: bool(flags, "yes") });
  }

  const result = await callTool<MemoryResult>(
    "publish_memory",
    { id, confirm_public: isPublic ? true : undefined },
    ctx,
  );

  if (wantsJson(flags)) return printJson(result);
  const published = writtenMemory(result);
  reportSaved(published, result.result ?? "Published.");
  if (isPublic && published?.url) process.stdout.write(dim("This page is now public.\n"));
}
