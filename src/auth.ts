import { readConfig, writeConfig, withConfigLock, type Config, type OAuthState } from "./config.js";
import { discover, refreshTokens } from "./oauth.js";
import { CliError } from "./errors.js";

/** Refresh this far ahead of expiry so a long command cannot expire mid-run. */
const RENEW_MARGIN_MS = 5 * 60_000;

export type Credentials = { token: string; kind: "env" | "oauth" | "pat" };

/**
 * The single place a bearer token comes from.
 *
 * Order is deliberate: VERDE_TOKEN first so CI never touches disk, then an
 * OAuth session (refreshed if it is close to expiring), then a stored PAT.
 */
export async function resolveCredentials(host: string): Promise<Credentials> {
  const fromEnv = process.env.VERDE_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, kind: "env" };

  const config = readConfig();
  if (config.oauth?.accessToken) {
    return { token: await freshAccessToken(host, config.oauth), kind: "oauth" };
  }
  if (config.token) return { token: config.token, kind: "pat" };

  throw new CliError("Not signed in.", {
    hint: "Run `verde login`, or set VERDE_TOKEN.",
  });
}

function isFresh(state: OAuthState): boolean {
  // Absent means "no expiry recorded, trust it until the server objects".
  // Checked for absence rather than falsiness on purpose: a zeroed or
  // corrupted timestamp is long past, and treating it as unknown would skip
  // the refresh forever and fail every command with a 401 instead.
  if (state.expiresAt === undefined || state.expiresAt === null) return true;
  return state.expiresAt - Date.now() > RENEW_MARGIN_MS;
}

/**
 * Returns a usable access token, refreshing under the config lock when the
 * stored one is spent.
 *
 * Verde rotates the refresh token on every use, so two processes refreshing
 * concurrently would leave one holding a token the server has already retired.
 * The lock serializes that, and the re-read inside it means the process that
 * waited usually finds credentials another already refreshed and does no work.
 */
async function freshAccessToken(host: string, state: OAuthState): Promise<string> {
  if (isFresh(state)) return state.accessToken;

  if (!state.refreshToken) {
    throw new CliError("Your session has expired.", {
      exitCode: 2,
      hint: "Run `verde login` to sign in again.",
    });
  }

  return withConfigLock(async () => {
    // Someone else may have refreshed while we waited for the lock.
    const current = readConfig();
    if (current.oauth && isFresh(current.oauth)) return current.oauth.accessToken;

    const refreshToken = current.oauth?.refreshToken ?? state.refreshToken;
    if (!refreshToken) {
      throw new CliError("Your session has expired.", {
        exitCode: 2,
        hint: "Run `verde login` to sign in again.",
      });
    }

    const meta = await discover(host);
    const tokens = await refreshTokens(meta, {
      clientId: current.oauth?.clientId ?? state.clientId,
      refreshToken,
    });

    // Persist before returning: a rotated refresh token that is used but never
    // written is one the server has retired and we can no longer present.
    saveOAuth(
      {
        clientId: current.oauth?.clientId ?? state.clientId,
        accessToken: tokens.accessToken,
        // The server always returns a new one; keep the old only as a fallback.
        refreshToken: tokens.refreshToken ?? refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope ?? current.oauth?.scope,
      },
      host,
    );
    return tokens.accessToken;
  });
}

/** Writes the OAuth session, preserving unrelated config keys. */
export function saveOAuth(oauth: OAuthState, host: string): void {
  const config: Config = readConfig();
  writeConfig({ ...config, host, oauth, token: undefined, tokenLabel: undefined });
}

/** Writes a personal access token, clearing any OAuth session. */
export function savePat(token: string, host: string): void {
  const config: Config = readConfig();
  writeConfig({ ...config, host, token, oauth: undefined });
}

/** Which credential a command is about to use, for `whoami` and diagnostics. */
export function describeStoredCredential(): string {
  if (process.env.VERDE_TOKEN?.trim()) return "VERDE_TOKEN environment variable";
  const config = readConfig();
  if (config.oauth?.accessToken) {
    const expires = config.oauth.expiresAt;
    const when = expires ? ` (access token ${expires > Date.now() ? "valid" : "expired"})` : "";
    return `browser sign-in${when}`;
  }
  if (config.token) return "personal access token";
  return "not signed in";
}
