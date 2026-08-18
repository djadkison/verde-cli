import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig, clearConfig, configPath, resolveHost, resolveToken, DEFAULT_HOST } from "../src/config.js";
import { CliError } from "../src/errors.js";

/** Each test gets its own config path, so none of them touch the real one. */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "verde-cli-test-"));
  const path = join(dir, "nested", "config.json");
  process.env.VERDE_CONFIG = path;
  delete process.env.VERDE_TOKEN;
  delete process.env.VERDE_HOST;
  return path;
}

test("writes the config 0600, creating parent directories", () => {
  const path = sandbox();
  writeConfig({ host: "https://getverde.ai", token: "vd_secret" });
  assert.equal(configPath(), path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readConfig(), { host: "https://getverde.ai", token: "vd_secret" });
});

test("re-tightens the mode of a file that was already too open", () => {
  const path = sandbox();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, '{"token":"vd_old"}', { mode: 0o644 });
  writeConfig({ token: "vd_new" });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a missing config reads as empty rather than throwing", () => {
  sandbox();
  assert.deepEqual(readConfig(), {});
});

test("an empty config file reads as no config, not as corruption", () => {
  // A truncated write, a bare `touch`, or VERDE_CONFIG=/dev/null must behave
  // like a fresh install rather than failing every command.
  const path = sandbox();
  mkdirSync(join(path, ".."), { recursive: true });
  for (const contents of ["", "   ", "\n\n"]) {
    writeFileSync(path, contents);
    assert.deepEqual(readConfig(), {}, `expected ${JSON.stringify(contents)} to read as {}`);
  }
});

test("/dev/null works as a config path, which is how scripts opt out", () => {
  process.env.VERDE_CONFIG = "/dev/null";
  delete process.env.VERDE_TOKEN;
  delete process.env.VERDE_HOST;
  assert.deepEqual(readConfig(), {});
  assert.equal(resolveHost(), DEFAULT_HOST);
});

test("a corrupt config says which file to delete", () => {
  const path = sandbox();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "{not json");
  assert.throws(() => readConfig(), (err: CliError) => err instanceof CliError && err.message.includes(path));
});

test("logout removes the file and reports whether there was one", () => {
  sandbox();
  assert.equal(clearConfig(), false);
  writeConfig({ token: "vd_x" });
  assert.equal(clearConfig(), true);
  assert.equal(existsSync(configPath()), false);
});

test("host precedence: flag, then env, then file, then the default", () => {
  sandbox();
  assert.equal(resolveHost(), DEFAULT_HOST);
  writeConfig({ host: "https://file.test" });
  assert.equal(resolveHost(), "https://file.test");
  process.env.VERDE_HOST = "https://env.test";
  assert.equal(resolveHost(), "https://env.test");
  assert.equal(resolveHost("https://flag.test"), "https://flag.test");
  delete process.env.VERDE_HOST;
});

test("a trailing slash on the host never doubles up in the request path", () => {
  sandbox();
  assert.equal(resolveHost("https://getverde.ai/"), "https://getverde.ai");
  assert.equal(resolveHost("https://getverde.ai///"), "https://getverde.ai");
});

test("VERDE_TOKEN wins over the stored token, so CI never needs a config file", () => {
  sandbox();
  writeConfig({ token: "vd_stored" });
  assert.equal(resolveToken(), "vd_stored");
  process.env.VERDE_TOKEN = "vd_env";
  assert.equal(resolveToken(), "vd_env");
  delete process.env.VERDE_TOKEN;
});

test("no token at all points the user at login", () => {
  sandbox();
  assert.throws(
    () => resolveToken(),
    (err: CliError) => err instanceof CliError && (err.hint ?? "").includes("verde login"),
  );
});
