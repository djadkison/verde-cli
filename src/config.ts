import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { CliError } from "./errors.js";

export const DEFAULT_HOST = "https://getverde.ai";

export type Config = {
  host?: string;
  token?: string;
  /** Set at login so `verde whoami` can name the token without a round-trip. */
  tokenLabel?: string;
};

/**
 * XDG-style location, with the usual override. Deliberately a plain file and
 * not an OS keychain: keychain integration is the single biggest source of
 * cross-platform breakage in small CLIs, and 0600 in the user's own home
 * directory is the same bar `gh` and `npm` hold their credentials to.
 */
export function configPath(): string {
  if (process.env.VERDE_CONFIG) return process.env.VERDE_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "verde", "config.json");
}

export function readConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Config;
  } catch {
    throw new CliError(`Could not read ${path} — it is not valid JSON.`, {
      hint: "Delete it and run `verde login` again.",
    });
  }
}

/**
 * Writes 0600 and, on an existing file, re-applies the mode — a config that
 * was created before this rule, or copied in by hand, should not stay
 * world-readable just because it already exists.
 */
export function writeConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearConfig(): boolean {
  const path = configPath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** Env beats file, so CI can run without ever writing a config. */
export function resolveHost(flagHost?: string): string {
  const host = flagHost || process.env.VERDE_HOST || readConfig().host || DEFAULT_HOST;
  return host.replace(/\/+$/, "");
}

export function resolveToken(): string {
  const token = process.env.VERDE_TOKEN || readConfig().token;
  if (!token) {
    throw new CliError("Not signed in.", {
      hint: "Run `verde login` with a token from your vault's MCP settings, or set VERDE_TOKEN.",
    });
  }
  return token;
}
