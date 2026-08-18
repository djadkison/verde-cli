import { clearConfig, configPath } from "../config.js";
import { dim } from "../render.js";

export const logoutHelp = `Remove the stored token.

Usage
  verde logout

Deletes the stored credentials — the browser session and any personal access
token. It does not revoke them server-side: to do that, remove the connection
in Verde under your vault's MCP settings.
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
