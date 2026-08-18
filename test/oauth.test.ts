import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createPkce,
  authorizeUrl,
  discover,
  registerClient,
  exchangeCode,
  refreshTokens,
  issuerMatches,
  startListener,
  REGISTERED_REDIRECT,
  SCOPE,
} from "../src/oauth.js";
import { CliError } from "../src/errors.js";

const META = {
  issuer: "https://verde.test",
  authorization_endpoint: "https://verde.test/oauth/authorize",
  token_endpoint: "https://verde.test/api/oauth/token",
  registration_endpoint: "https://verde.test/api/oauth/register",
};

async function withFetch<T>(handler: (url: string, init: RequestInit) => Response, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) =>
    handler(String(url), init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the PKCE challenge is the S256 digest of the verifier", () => {
  const { verifier, challenge } = createPkce();
  // RFC 7636 requires 43–128 characters.
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `verifier was ${verifier.length} chars`);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.doesNotMatch(challenge, /[+/=]/, "must be base64url, not base64");
});

test("two PKCE pairs are never the same", () => {
  assert.notEqual(createPkce().verifier, createPkce().verifier);
});

test("the authorize URL carries everything Verde's consent screen requires", () => {
  const url = new URL(
    authorizeUrl(META, {
      clientId: "client-123",
      redirectUri: "http://127.0.0.1:51234/callback",
      state: "state-abc",
      challenge: "challenge-xyz",
    }),
  );
  assert.equal(url.origin + url.pathname, "https://verde.test/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:51234/callback");
  assert.equal(url.searchParams.get("state"), "state-abc");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-xyz");
  // Verde rejects the request outright without S256.
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  // offline_access is what earns a refresh token.
  assert.equal(url.searchParams.get("scope"), SCOPE);
  assert.match(url.searchParams.get("scope") ?? "", /offline_access/);
});

test("discovery falls back to Verde's known endpoints when metadata is missing", async () => {
  const meta = await withFetch(
    () => new Response("nope", { status: 404 }),
    () => discover("https://verde.test"),
  );
  assert.equal(meta.token_endpoint, "https://verde.test/api/oauth/token");
  assert.equal(meta.authorization_endpoint, "https://verde.test/oauth/authorize");
});

test("discovery prefers the served document when there is one", async () => {
  const meta = await withFetch(
    () => json({ ...META, token_endpoint: "https://verde.test/custom/token" }),
    () => discover("https://verde.test"),
  );
  assert.equal(meta.token_endpoint, "https://verde.test/custom/token");
});

test("registration announces itself as Verde CLI with a port-agnostic loopback redirect", async () => {
  let sent: Record<string, unknown> = {};
  const clientId = await withFetch(
    (_url, init) => {
      sent = JSON.parse(String(init.body));
      return json({ client_id: "generated-id" }, 201);
    },
    () => registerClient(META),
  );
  assert.equal(clientId, "generated-id");
  assert.equal(sent.client_name, "Verde CLI", "attribution shows this name in Verde's activity feed");
  // Registered without a port; Verde matches loopback ignoring it (RFC 8252 §7.3).
  assert.deepEqual(sent.redirect_uris, [REGISTERED_REDIRECT]);
  assert.equal(sent.token_endpoint_auth_method, "none");
});

test("the code exchange posts form-encoded PKCE parameters", async () => {
  let body = "";
  let contentType = "";
  const tokens = await withFetch(
    (_url, init) => {
      body = String(init.body);
      contentType = (init.headers as Record<string, string>)["content-type"] ?? "";
      return json({ access_token: "at_1", refresh_token: "rt_1", expires_in: 28800, scope: SCOPE });
    },
    () =>
      exchangeCode(META, {
        clientId: "c1",
        code: "auth-code",
        redirectUri: "http://127.0.0.1:9999/callback",
        verifier: "the-verifier",
      }),
  );

  assert.match(contentType, /application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "auth-code");
  assert.equal(form.get("code_verifier"), "the-verifier");
  assert.equal(form.get("redirect_uri"), "http://127.0.0.1:9999/callback");

  assert.equal(tokens.accessToken, "at_1");
  assert.equal(tokens.refreshToken, "rt_1");
  // expires_in is relative; the store needs an absolute deadline.
  assert.ok(tokens.expiresAt! > Date.now() + 8 * 3600_000 - 5000);
});

test("a spent refresh token reads as an expired session, not a protocol error", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () => json({ error: "invalid_grant", error_description: "Refresh token not found." }, 400),
        () => refreshTokens(META, { clientId: "c1", refreshToken: "rt_old" }),
      ),
    (err: CliError) =>
      err instanceof CliError && err.exitCode === 2 && /session has expired/i.test(err.message),
  );
});

test("other token errors surface Verde's own description", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () => json({ error: "invalid_client", error_description: "Unknown client." }, 401),
        () => refreshTokens(META, { clientId: "c1", refreshToken: "rt" }),
      ),
    (err: CliError) => err instanceof CliError && /Unknown client/.test(err.message),
  );
});

test("the issuer check accepts the expected host and rejects a substitute", () => {
  assert.equal(issuerMatches("https://verde.test", "https://verde.test"), true);
  assert.equal(issuerMatches("https://verde.test/", "https://verde.test"), true);
  assert.equal(issuerMatches("https://evil.test", "https://verde.test"), false);
  // Absent is allowed: iss is optional, and absence is not evidence of a problem.
  assert.equal(issuerMatches(undefined, "https://verde.test"), true);
});

test("the loopback listener binds 127.0.0.1 and completes on a matching state", async () => {
  const listener = await startListener(10_000);
  try {
    const url = new URL(listener.redirectUri);
    assert.equal(url.hostname, "127.0.0.1", "must never bind a routable interface");
    assert.equal(url.pathname, "/callback");
    assert.ok(Number(url.port) > 0);

    const waiting = listener.waitForCode("st_expected");
    await fetch(`${listener.redirectUri}?code=the-code&state=st_expected&iss=https%3A%2F%2Fverde.test`);
    const cb = await waiting;
    assert.equal(cb.code, "the-code");
    assert.equal(cb.iss, "https://verde.test");
  } finally {
    listener.close();
  }
});

test("a mismatched state is rejected — the CSRF check the flow rests on", async () => {
  const listener = await startListener(10_000);
  try {
    // Subscribe before triggering: the rejection lands as soon as the server
    // responds, and an unsubscribed rejected promise is an unhandled rejection.
    const waiting = assert.rejects(
      listener.waitForCode("st_expected"),
      (err: CliError) => err instanceof CliError && /state mismatch/.test(err.message),
    );
    await fetch(`${listener.redirectUri}?code=c&state=st_forged`);
    await waiting;
  } finally {
    listener.close();
  }
});

test("a declined authorization surfaces Verde's reason", async () => {
  const listener = await startListener(10_000);
  try {
    const waiting = assert.rejects(
      listener.waitForCode("st"),
      (err: CliError) => err instanceof CliError && /You declined/.test(err.message),
    );
    await fetch(`${listener.redirectUri}?error=access_denied&error_description=You%20declined`);
    await waiting;
  } finally {
    listener.close();
  }
});

test("paths other than the callback are ignored", async () => {
  const listener = await startListener(10_000);
  try {
    const base = new URL(listener.redirectUri).origin;
    const res = await fetch(`${base}/favicon.ico`);
    assert.equal(res.status, 404);
  } finally {
    listener.close();
  }
});
