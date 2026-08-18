import { resolveHost } from "./config.js";
import { resolveCredentials } from "./auth.js";
import { str, bool, type Flags } from "./args.js";
import type { ToolContext } from "./transport.js";

/**
 * Builds the per-call context from the flags every command shares. Async
 * because an OAuth session may need refreshing before the first request.
 */
export async function contextFrom(flags: Flags): Promise<ToolContext> {
  const host = resolveHost(str(flags, "host"));
  const { token } = await resolveCredentials(host);
  return { host, token, vault: str(flags, "vault") };
}

export function wantsJson(flags: Flags): boolean {
  return bool(flags, "json");
}
