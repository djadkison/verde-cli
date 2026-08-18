import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
  existsSync,
  chmodSync,
  openSync,
  closeSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { CliError } from "./errors.js";

export const DEFAULT_HOST = "https://getverde.ai";

/** OAuth tokens for one host. Access is short-lived; refresh rotates on use. */
export type OAuthState = {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch milliseconds. */
  expiresAt?: number;
  scope?: string;
};

export type Config = {
  host?: string;
  /** Personal access token — the `verde login --token` path. */
  token?: string;
  tokenLabel?: string;
  /** Set by the browser login flow. Takes precedence over `token`. */
  oauth?: OAuthState;
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
  // An empty file is "no config", not a broken one: a truncated write, a bare
  // `touch`, or VERDE_CONFIG=/dev/null should all behave like a fresh install
  // rather than failing every command until the user deletes something.
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Config;
  } catch {
    throw new CliError(`Could not read ${path} — it is not valid JSON.`, {
      hint: "Delete it and run `verde login` again.",
    });
  }
}

/**
 * Written to a sibling temp file and renamed into place, because rename is
 * atomic on POSIX. A refresh that is interrupted mid-write then leaves the
 * previous credentials intact rather than a half-written file that would lock
 * the user out of every subsequent command.
 *
 * Re-applies 0600 on an existing file too: a config created before that rule,
 * or copied in by hand, should not stay world-readable just because it exists.
 */
export function writeConfig(config: Config): void {
  const path = configPath();
  // A character device (VERDE_CONFIG=/dev/null) cannot be renamed over.
  if (existsSync(path) && !statSync(path).isFile()) return;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* the rename already consumed it */
    }
    throw err;
  }
}

export function clearConfig(): boolean {
  const path = configPath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * Serializes credential rotation across concurrent `verde` processes.
 *
 * Refresh tokens rotate on every use, so two processes refreshing at once
 * would race: whichever wrote second would persist a token the server had
 * already spent. The lock makes the read-refresh-write sequence one critical
 * section — and callers re-read inside it, so the loser of the race finds
 * fresh credentials and skips refreshing at all.
 *
 * Best-effort by design: a stale lock is broken after `staleMs`, and a
 * filesystem that cannot lock still runs the callback rather than failing.
 */
export async function withConfigLock<T>(fn: () => Promise<T>, staleMs = 30_000): Promise<T> {
  const path = configPath();
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + staleMs;
  let held = false;

  while (Date.now() < deadline) {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // wx fails if it exists — the atomic test-and-set this relies on.
      closeSync(openSync(lockPath, "wx"));
      held = true;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") break; // Unlockable filesystem — proceed unlocked.
      let age = 0;
      try {
        age = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        continue; // Vanished between the open and the stat; retry immediately.
      }
      if (age > staleMs) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          /* another process got there first */
        }
        continue;
      }
      await sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    if (held) {
      try {
        rmSync(lockPath, { force: true });
      } catch {
        /* already gone */
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Env beats file, so CI can run without ever writing a config. */
export function resolveHost(flagHost?: string): string {
  const host = flagHost || process.env.VERDE_HOST || readConfig().host || DEFAULT_HOST;
  return host.replace(/\/+$/, "");
}
