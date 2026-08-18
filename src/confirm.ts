import { createInterface } from "node:readline/promises";
import { CliError } from "./errors.js";

/**
 * Yes/no gate on the operations that change what other people see.
 *
 * `--yes` skips it, which is the whole point of having the flag: these
 * commands belong in scripts. Refusing to run non-interactively WITHOUT
 * --yes is deliberate — a prompt that silently auto-answers in a pipeline is
 * how a cron job archives a document nobody meant to touch.
 */
export async function confirm(question: string, opts: { yes: boolean }): Promise<void> {
  if (opts.yes) return;

  if (!process.stdin.isTTY) {
    throw new CliError(`${question}\nRefusing to continue without a terminal to ask.`, {
      hint: "Pass --yes to confirm non-interactively.",
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") throw new CliError("Cancelled.", { exitCode: 130 });
  } finally {
    rl.close();
  }
}

/** Reads piped stdin, or returns undefined when stdin is a terminal. */
export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim().length ? text : undefined;
}
