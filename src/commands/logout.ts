import { clearConfig, configPath } from "../config.js";
import { dim } from "../render.js";

export const logoutHelp = `Remove the stored token.

Usage
  verde logout

Deletes the stored config — it does not revoke the token. If the token may have
leaked, revoke it in Verde under your vault's MCP settings.
`;

export async function logout(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) return void process.stdout.write(logoutHelp);
  const removed = clearConfig();
  process.stdout.write(
    removed ? `Signed out. Removed ${configPath()}.\n` : dim("Nothing to remove — no stored token.\n"),
  );
  if (process.env.VERDE_TOKEN) {
    process.stdout.write(dim("VERDE_TOKEN is still set in this environment and will keep being used.\n"));
  }
}
