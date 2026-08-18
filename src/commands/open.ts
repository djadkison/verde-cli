import { spawn } from "node:child_process";
import { parse, COMMON_OPTIONS, requireUuid, bool } from "../args.js";
import { contextFrom } from "../context.js";
import { callTool } from "../transport.js";
import { dim } from "../render.js";
import { documentOf, type GetMemoryResult } from "../wire.js";
import { CliError } from "../errors.js";

export const openHelp = `Open a document's page in your browser.

Usage
  verde open <id> [--print]

Options
  --print   Print the URL instead of opening it.

Public documents open for anyone; company and private ones ask for sign-in.
`;

export async function open(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(argv, { ...COMMON_OPTIONS, print: { type: "boolean" } }, "open");
  if (flags.help) return void process.stdout.write(openHelp);

  const id = requireUuid(positionals[0], "document id");
  const ctx = contextFrom(flags);
  const result = await callTool<GetMemoryResult>("get_memory", { id }, ctx);
  const url = documentOf(result)?.url;
  if (!url) throw new CliError("That document has no shareable URL.");

  if (bool(flags, "print")) return void process.stdout.write(`${url}\n`);

  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  process.stdout.write(dim(`${url}\n`));
}
