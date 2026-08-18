import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/transport.js";

/**
 * Opt-in round trip against a real Verde. Skipped unless VERDE_TOKEN is set,
 * because it spends the team's metered MCP allowance and writes activity rows.
 *
 *   VERDE_HOST=http://localhost:3000 VERDE_TOKEN=vd_… npm run test:live
 *
 * Read-only by design: creating documents in someone's vault is not something
 * a test suite should do on its own initiative.
 */
const token = process.env.VERDE_TOKEN;
const host = (process.env.VERDE_HOST ?? "https://getverde.ai").replace(/\/+$/, "");
const ctx = { host, token: token ?? "" };
const skip = token ? false : "set VERDE_TOKEN to run the live round trip";

test("a bare tools/call reaches a real server with no handshake", { skip }, async () => {
  const result = await callTool<{ teams?: unknown[] }>("list_vaults", {}, ctx);
  assert.ok(Array.isArray(result.teams), "list_vaults should return a teams array");
});

test("search returns structured results", { skip }, async () => {
  const result = await callTool<{ vault?: string; results?: unknown[] }>(
    "search_memories",
    { limit: 3 },
    ctx,
  );
  assert.equal(typeof result.vault, "string");
  assert.ok(Array.isArray(result.results));
});

test("buckets and recent documents both answer", { skip }, async () => {
  const buckets = await callTool<{ buckets?: unknown[] }>("list_buckets", {}, ctx);
  assert.ok(Array.isArray(buckets.buckets));
  const recent = await callTool<{ results?: unknown[] }>("list_recent_memories", { limit: 3 }, ctx);
  assert.ok(Array.isArray(recent.results));
});

test("a bad token is rejected cleanly", { skip }, async () => {
  await assert.rejects(
    () => callTool("list_vaults", {}, { host, token: "vd_definitely_not_a_real_token" }),
    /rejected the token/,
  );
});
