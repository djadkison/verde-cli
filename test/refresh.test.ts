import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig, withConfigLock } from "../src/config.js";
import { resolveCredentials } from "../src/auth.js";
import { CliError } from "../src/errors.js";

const HOST = "https://verde.test";

function sandbox(): string {
  const path = join(mkdtempSync(join(tmpdir(), "verde-refresh-")), "config.json");
  process.env.VERDE_CONFIG = path;
  delete process.env.VERDE_TOKEN;
  delete process.env.VERDE_HOST;
  return path;
}

/** Serves discovery, then one rotating token response per refresh. */
function stubServer(opts: { onRefresh?: (n: number) => void } = {}) {
  let refreshes = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    if (href.includes("/.well-known/")) {
      return new Response(
        JSON.stringify({
          issuer: HOST,
          authorization_endpoint: `${HOST}/oauth/authorize`,
          token_endpoint: `${HOST}/api/oauth/token`,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (href.includes("/api/oauth/token")) {
      const form = new URLSearchParams(String(init.body));
      refreshes += 1;
      opts.onRefresh?.(refreshes);
      // Verde rotates: presenting a spent refresh token is rejected.
      if (form.get("refresh_token") !== `rt_${refreshes - 1}`) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "spent" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          access_token: `at_${refreshes}`,
          refresh_token: `rt_${refreshes}`,
          expires_in: 28800,
          scope: "memories offline_access",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as typeof fetch;
  return {
    get refreshes() {
      return refreshes;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a live access token is used without contacting the server", async () => {
  sandbox();
  const server = stubServer();
  try {
    writeConfig({
      host: HOST,
      oauth: { clientId: "c1", accessToken: "at_live", refreshToken: "rt_0", expiresAt: Date.now() + 3_600_000 },
    });
    assert.deepEqual(await resolveCredentials(HOST), { token: "at_live", kind: "oauth" });
    assert.equal(server.refreshes, 0);
  } finally {
    server.restore();
  }
});

test("an expired access token refreshes and persists the rotated pair", async () => {
  const path = sandbox();
  const server = stubServer();
  try {
    writeConfig({
      host: HOST,
      oauth: { clientId: "c1", accessToken: "at_stale", refreshToken: "rt_0", expiresAt: Date.now() - 1000 },
    });

    const creds = await resolveCredentials(HOST);
    assert.equal(creds.token, "at_1");
    assert.equal(server.refreshes, 1);

    // The rotated refresh token must be on disk: the old one is spent, so a
    // rotation that is used but never written locks the user out.
    const stored = JSON.parse(readFileSync(path, "utf8")) as { oauth: { refreshToken: string; accessToken: string } };
    assert.equal(stored.oauth.refreshToken, "rt_1");
    assert.equal(stored.oauth.accessToken, "at_1");
  } finally {
    server.restore();
  }
});

test("a token inside the renewal margin is refreshed before it can expire mid-command", async () => {
  sandbox();
  const server = stubServer();
  try {
    // Two minutes left is inside the five-minute margin.
    writeConfig({
      host: HOST,
      oauth: { clientId: "c1", accessToken: "at_soon", refreshToken: "rt_0", expiresAt: Date.now() + 120_000 },
    });
    assert.equal((await resolveCredentials(HOST)).token, "at_1");
    assert.equal(server.refreshes, 1);
  } finally {
    server.restore();
  }
});

test("concurrent commands refresh once, not once each", async () => {
  const path = sandbox();
  const server = stubServer();
  try {
    writeConfig({
      host: HOST,
      oauth: { clientId: "c1", accessToken: "at_stale", refreshToken: "rt_0", expiresAt: Date.now() - 1000 },
    });

    // Five commands starting at once against one rotating refresh token. Without
    // the lock, four of them would present a token the server had already spent.
    const results = await Promise.all(Array.from({ length: 5 }, () => resolveCredentials(HOST)));

    assert.equal(server.refreshes, 1, `refreshed ${server.refreshes} times; rotation was not serialized`);
    for (const r of results) assert.equal(r.token, "at_1");

    const stored = JSON.parse(readFileSync(path, "utf8")) as { oauth: { refreshToken: string } };
    assert.equal(stored.oauth.refreshToken, "rt_1");
  } finally {
    server.restore();
  }
});

test("the lock is released even when the guarded work throws", async () => {
  const path = sandbox();
  writeConfig({ token: "vrd_x" });
  await assert.rejects(
    withConfigLock(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(existsSync(`${path}.lock`), false, "a leaked lock would stall every later refresh");
  // And the next acquisition still works.
  assert.equal(await withConfigLock(async () => "ok"), "ok");
});

test("a revoked session asks for a fresh login instead of retrying forever", async () => {
  sandbox();
  const server = stubServer();
  try {
    writeConfig({
      host: HOST,
      // rt_bogus will not match the rotation the stub expects.
      oauth: { clientId: "c1", accessToken: "at_stale", refreshToken: "rt_bogus", expiresAt: Date.now() - 1000 },
    });
    await assert.rejects(
      () => resolveCredentials(HOST),
      (err: CliError) => err instanceof CliError && err.exitCode === 2 && /verde login/.test(err.hint ?? ""),
    );
  } finally {
    server.restore();
  }
});

test("an OAuth session with no refresh token fails cleanly once it expires", async () => {
  sandbox();
  writeConfig({
    host: HOST,
    oauth: { clientId: "c1", accessToken: "at_stale", expiresAt: Date.now() - 1000 },
  });
  await assert.rejects(
    () => resolveCredentials(HOST),
    (err: CliError) => err instanceof CliError && /session has expired/i.test(err.message),
  );
});

test("a zeroed expiry counts as expired, not as unknown", async () => {
  sandbox();
  const server = stubServer();
  try {
    // A corrupted or zeroed timestamp must trigger a refresh. Reading it as
    // "no expiry recorded" would skip refreshing forever and 401 every call.
    writeConfig({
      host: HOST,
      oauth: { clientId: "c1", accessToken: "at_stale", refreshToken: "rt_0", expiresAt: 0 },
    });
    assert.equal((await resolveCredentials(HOST)).token, "at_1");
    assert.equal(server.refreshes, 1);
  } finally {
    server.restore();
  }
});

test("a session with no recorded expiry is trusted until the server says otherwise", async () => {
  sandbox();
  const server = stubServer();
  try {
    writeConfig({ host: HOST, oauth: { clientId: "c1", accessToken: "at_unknown", refreshToken: "rt_0" } });
    assert.equal((await resolveCredentials(HOST)).token, "at_unknown");
    assert.equal(server.refreshes, 0);
  } finally {
    server.restore();
  }
});

test("VERDE_TOKEN short-circuits OAuth entirely, touching neither disk nor network", async () => {
  sandbox();
  const server = stubServer();
  try {
    writeConfig({
      host: HOST,
      oauth: { clientId: "c1", accessToken: "at_stale", refreshToken: "rt_0", expiresAt: Date.now() - 1000 },
    });
    process.env.VERDE_TOKEN = "vrd_ci";
    assert.deepEqual(await resolveCredentials(HOST), { token: "vrd_ci", kind: "env" });
    assert.equal(server.refreshes, 0);
    delete process.env.VERDE_TOKEN;
    assert.deepEqual(readConfig().oauth?.refreshToken, "rt_0", "the stored session must be left untouched");
  } finally {
    server.restore();
  }
});
