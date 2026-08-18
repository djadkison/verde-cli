import { createInterface } from "node:readline/promises";
import { parse } from "../args.js";
import { readConfig, writeConfig, configPath, resolveHost, DEFAULT_HOST } from "../config.js";
import { callTool } from "../transport.js";
import { CliError } from "../errors.js";
import { green, dim } from "../render.js";

export const loginHelp = `Sign in with a personal access token.

Usage
  verde login [--token <token>] [--host <url>]

Create a token in Verde: open your vault → MCP → "Create token". The token is
shown once. Tokens are pinned to the vault that minted them.

Options
  --token <token>   The token. Omit to be prompted (input is not echoed back).
  --host <url>      Verde instance (default ${DEFAULT_HOST}).

Environment
  VERDE_TOKEN       Overrides the stored token entirely — nothing is written to
                    disk. Use this in CI.
`;

export async function login(argv: string[]): Promise<void> {
  const { flags } = parse(argv, { token: { type: "string" }, host: { type: "string" }, help: { type: "boolean", short: "h" } }, "login");
  if (flags.help) return void process.stdout.write(loginHelp);

  const host = resolveHost(typeof flags.host === "string" ? flags.host : undefined);
  let token = typeof flags.token === "string" ? flags.token.trim() : "";

  if (!token) {
    if (!process.stdin.isTTY) {
      throw new CliError("No token given and no terminal to ask for one.", {
        hint: "Pass --token <token>, or set VERDE_TOKEN.",
      });
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      token = (await rl.question(`Token for ${host}: `)).trim();
    } finally {
      rl.close();
    }
  }

  if (!token) throw new CliError("No token entered.");

  // Prove the token before storing it — a config file holding a dead token is
  // worse than no config file, because the failure surfaces later and further
  // from the cause.
  const result = await callTool<{ teams?: Array<{ team?: string; vaults?: Array<{ name?: string }> }> }>(
    "list_vaults",
    {},
    { host, token },
  );

  const config = readConfig();
  writeConfig({ ...config, host, token });

  const team = result.teams?.[0];
  const where = team?.team ? ` — ${team.team}` : "";
  process.stdout.write(`${green("Signed in")}${where}\n`);
  process.stdout.write(dim(`Token stored in ${configPath()} (0600).\n`));
}
