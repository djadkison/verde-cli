import { resolveHost, resolveToken } from "./config.js";
import { str, bool, type Flags } from "./args.js";
import type { ToolContext } from "./transport.js";

/** Builds the per-call context from the flags every command shares. */
export function contextFrom(flags: Flags): ToolContext {
  return {
    host: resolveHost(str(flags, "host")),
    token: resolveToken(),
    vault: str(flags, "vault"),
  };
}

export function wantsJson(flags: Flags): boolean {
  return bool(flags, "json");
}
