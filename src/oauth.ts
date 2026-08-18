import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CliError } from "./errors.js";

/**
 * RFC 8252 native-app OAuth against Verde: dynamic registration, PKCE S256,
 * and an ephemeral loopback listener for the redirect.
 *
 * Verde matches loopback redirect_uris ignoring the port (RFC 8252 §7.3), so
 * the client registers `http://127.0.0.1/callback` once and may then bind
 * whatever port the OS hands it. Path and query still have to match exactly.
 */

export const CLIENT_NAME = "Verde CLI";
export const REGISTERED_REDIRECT = "http://127.0.0.1/callback";
export const CALLBACK_PATH = "/callback";
export const SCOPE = "memories offline_access";

export type Metadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch milliseconds, computed from the server's expires_in. */
  expiresAt?: number;
  scope?: string;
};

/**
 * RFC 8414 discovery, with a fallback to Verde's documented paths. A CLI that
 * hard-fails because a metadata document is missing is more brittle than one
 * that knows where the endpoints live.
 */
export async function discover(host: string): Promise<Metadata> {
  const fallback: Metadata = {
    issuer: host,
    authorization_endpoint: `${host}/oauth/authorize`,
    token_endpoint: `${host}/api/oauth/token`,
    registration_endpoint: `${host}/api/oauth/register`,
  };
  try {
    const res = await fetch(`${host}/.well-known/oauth-authorization-server`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return fallback;
    const doc = (await res.json()) as Partial<Metadata>;
    if (!doc.authorization_endpoint || !doc.token_endpoint) return fallback;
    return { ...fallback, ...doc } as Metadata;
  } catch {
    return fallback;
  }
}

/** RFC 7591 registration. Verde allows it unauthenticated for public clients. */
export async function registerClient(meta: Metadata): Promise<string> {
  const endpoint = meta.registration_endpoint;
  if (!endpoint) throw new CliError("This Verde instance does not advertise client registration.");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REGISTERED_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPE,
      client_uri: "https://github.com/djadkison/verde-cli",
    }),
  });

  const body = await res.text();
  if (!res.ok) throw oauthFailure("Could not register this CLI with Verde", res.status, body);

  const doc = parseJson<{ client_id?: string }>(body);
  if (!doc.client_id) throw new CliError("Verde's registration response contained no client_id.");
  return doc.client_id;
}

export type Pkce = { verifier: string; challenge: string };

/** 32 random bytes → a 43-char base64url verifier, the RFC 7636 minimum. */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(
  meta: Metadata,
  opts: { clientId: string; redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type Callback = { code: string; state: string; iss?: string };

export type Listener = {
  redirectUri: string;
  /** Resolves once the browser hits the callback, or rejects on timeout. */
  waitForCode: (expectedState: string) => Promise<Callback>;
  close: () => void;
};

/**
 * Binds 127.0.0.1 on an OS-assigned port and waits for exactly one callback.
 * Bound to the loopback interface explicitly — never 0.0.0.0, which would put
 * an authorization code on the local network.
 */
export async function startListener(timeoutMs = 5 * 60_000): Promise<Listener> {
  let settle: ((cb: Callback) => void) | undefined;
  let fail: ((err: Error) => void) | undefined;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }

    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";

    if (error) {
      const description = url.searchParams.get("error_description") ?? "";
      respond(res, "Authorization declined", description || error);
      fail?.(new CliError(`Verde declined the authorization: ${description || error}`));
      return;
    }
    if (!code) {
      respond(res, "Something went wrong", "No authorization code came back.");
      fail?.(new CliError("Verde's redirect carried no authorization code."));
      return;
    }

    respond(res, "You're signed in", "You can close this tab and return to your terminal.");
    settle?.({ code, state, iss: url.searchParams.get("iss") ?? undefined });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = (server.address() as AddressInfo).port;
  const close = () => server.close();

  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    close,
    waitForCode: (expectedState: string) =>
      new Promise<Callback>((resolve, reject) => {
        const timer = setTimeout(() => {
          close();
          reject(new CliError(`Timed out after ${Math.round(timeoutMs / 60_000)} minutes waiting for the browser.`));
        }, timeoutMs);

        settle = (cb) => {
          clearTimeout(timer);
          close();
          // A mismatched state means this callback did not come from the
          // request we started — the CSRF check the whole flow rests on.
          if (!safeEqual(cb.state, expectedState)) {
            reject(new CliError("The authorization response did not match this request (state mismatch)."));
            return;
          }
          resolve(cb);
        };
        fail = (err) => {
          clearTimeout(timer);
          close();
          reject(err);
        };
      }),
  };
}

export async function exchangeCode(
  meta: Metadata,
  opts: { clientId: string; code: string; redirectUri: string; verifier: string },
): Promise<TokenSet> {
  return tokenRequest(meta, {
    grant_type: "authorization_code",
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  });
}

export async function refreshTokens(
  meta: Metadata,
  opts: { clientId: string; refreshToken: string },
): Promise<TokenSet> {
  return tokenRequest(meta, {
    grant_type: "refresh_token",
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
  });
}

async function tokenRequest(meta: Metadata, form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });

  const body = await res.text();
  if (!res.ok) {
    const doc = safeParse<{ error?: string; error_description?: string }>(body);
    // invalid_grant on a refresh means the stored token is spent or revoked —
    // recoverable only by signing in again, so say that rather than the code.
    if (doc?.error === "invalid_grant" && form.grant_type === "refresh_token") {
      throw new CliError("Your session has expired.", {
        exitCode: 2,
        hint: "Run `verde login` to sign in again.",
      });
    }
    throw oauthFailure("Verde refused the token request", res.status, body);
  }

  const doc = parseJson<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(body);
  if (!doc.access_token) throw new CliError("Verde's token response contained no access_token.");

  return {
    accessToken: doc.access_token,
    refreshToken: doc.refresh_token,
    expiresAt: typeof doc.expires_in === "number" ? Date.now() + doc.expires_in * 1000 : undefined,
    scope: doc.scope,
  };
}

/** Compares the issuer Verde reported (RFC 9207) with the host we asked. */
export function issuerMatches(iss: string | undefined, host: string): boolean {
  if (!iss) return true; // Optional; absence is not evidence of a problem.
  try {
    return new URL(iss).origin === new URL(host).origin;
  } catch {
    return false;
  }
}

function respond(res: ServerResponse, title: string, detail: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>body{font:16px/1.6 system-ui,sans-serif;margin:20vh auto;max-width:32rem;padding:0 1.5rem;color:#1a1a1a}` +
      `h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#666}` +
      `@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#999}}</style>` +
      `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function parseJson<T>(body: string): T {
  const parsed = safeParse<T>(body);
  if (parsed === undefined) throw new CliError("Verde returned a response that was not JSON.");
  return parsed;
}

function safeParse<T>(body: string): T | undefined {
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
}

function oauthFailure(prefix: string, status: number, body: string): CliError {
  const doc = safeParse<{ error?: string; error_description?: string }>(body);
  const detail = doc?.error_description || doc?.error || `HTTP ${status}`;
  return new CliError(`${prefix}: ${detail}`);
}
