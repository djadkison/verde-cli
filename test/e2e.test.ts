import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Drives the built binary against a real Verde. Opt-in and WRITING: it creates
 * a scratch bucket and documents, then archives what it made.
 *
 *   npm run build
 *   VERDE_HOST=http://localhost:3000 VERDE_TOKEN=vd_… VERDE_E2E_WRITE=1 \
 *     node --import tsx --test test/e2e.test.ts
 *
 * Point it at a development vault. It spends metered MCP calls and leaves
 * activity rows, exactly as any other client would.
 */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

const reason = !process.env.VERDE_TOKEN
  ? "set VERDE_TOKEN to run the end-to-end suite"
  : !existsSync(CLI)
    ? "run `npm run build` first"
    : !process.env.VERDE_E2E_WRITE
      ? "set VERDE_E2E_WRITE=1 to allow the writing tests"
      : false;

type Run = { code: number; out: string; err: string };

function verde(args: string[], input?: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, NO_COLOR: "1", VERDE_CONFIG: "/dev/null" },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    if (input !== undefined) {
      child.stdin!.write(input);
      child.stdin!.end();
    }
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

const json = <T>(run: Run): T => JSON.parse(run.out) as T;

test("end to end", { skip: reason, concurrency: false }, async (t) => {
  const bucket = `CLI e2e ${Date.now().toString(36)}`;
  const created: string[] = [];
  let draftId = "";

  await t.test("reads", async () => {
    const vaults = await verde(["vaults", "--json"]);
    assert.equal(vaults.code, 0, vaults.err);
    assert.ok(Array.isArray(json<{ teams: unknown[] }>(vaults).teams));

    const search = await verde(["search", "--limit", "2", "--json"]);
    assert.equal(search.code, 0, search.err);
    assert.ok(Array.isArray(json<{ results: unknown[] }>(search).results));

    const recent = await verde(["list", "--limit", "2", "--json"]);
    assert.equal(recent.code, 0, recent.err);
  });

  await t.test("rejects bad input before spending a request", async () => {
    const badId = await verde(["get", "not-a-uuid"]);
    assert.equal(badId.code, 1);
    assert.match(badId.err, /UUID/);

    const badType = await verde(["save", "--bucket", "x", "--type", "nope", "--title", "t", "body"]);
    assert.equal(badType.code, 1);
    assert.match(badType.err, /lesson_learned/);
  });

  await t.test("creates a bucket", async () => {
    const run = await verde([
      "bucket", "create", bucket,
      "--description", "Scratch bucket for the CLI end-to-end suite",
      "--reason", "Keeps end-to-end documents out of real buckets",
      "--default-visibility", "private",
    ]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, new RegExp(bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  await t.test("saves from a pipe, inferring the title from the heading", async () => {
    const run = await verde(
      ["save", "--bucket", bucket, "--type", "working_note", "--draft", "--json"],
      "# Piped document\n\nBody written by the end-to-end suite.\n",
    );
    assert.equal(run.code, 0, run.err);
    const memory = json<{ memory: { id: string; title: string; status: string } }>(run).memory;
    assert.equal(memory.title, "Piped document");
    assert.equal(memory.status, "draft", "--draft must beat the private auto-publish default");
    draftId = memory.id;
    created.push(memory.id);
  });

  await t.test("fetches one document flat and several under documents", async () => {
    const one = await verde(["get", draftId, "--json"]);
    assert.equal(json<{ id: string }>(one).id, draftId);

    const many = await verde(["get", draftId, draftId, "--json"]);
    assert.ok(Array.isArray(json<{ documents: unknown[] }>(many).documents));

    const raw = await verde(["get", draftId, "--raw"]);
    assert.match(raw.out, /Body written by the end-to-end suite/);
  });

  await t.test("publishes, then updates", async () => {
    const published = await verde(["publish", draftId, "--json"]);
    assert.equal(published.code, 0, published.err);
    assert.equal(json<{ memory: { status: string } }>(published).memory.status, "published");

    const updated = await verde(["update", draftId, "--title", "Piped document (updated)", "--json"]);
    assert.equal(updated.code, 0, updated.err);
    assert.equal(json<{ memory: { title: string } }>(updated).memory.title, "Piped document (updated)");
  });

  await t.test("will not archive or supersede unattended without --yes", async () => {
    const archive = await verde(["archive", draftId]);
    assert.equal(archive.code, 1);
    assert.match(archive.err, /--yes/);

    const supersede = await verde(["supersede", draftId, "--title", "R", "--content", "body"]);
    assert.equal(supersede.code, 1);
    assert.match(supersede.err, /--yes/);
  });

  await t.test("supersedes with --yes, keeping the old document as history", async () => {
    const run = await verde([
      "supersede", draftId, "--yes",
      "--title", "Replacement document",
      "--content", "The replacement body.",
      "--json",
    ]);
    assert.equal(run.code, 0, run.err);
    const result = json<{ new_memory: { id: string }; old_memory: { status: string } }>(run);
    assert.ok(result.new_memory.id);
    created.push(result.new_memory.id);

    const historical = await verde(["search", "Piped document", "--historical", "--json"]);
    assert.equal(historical.code, 0, historical.err);
  });

  await t.test("archives what it made", async () => {
    for (const id of created) {
      const run = await verde(["archive", id, "--yes"]);
      assert.ok(run.code === 0 || /already archived/i.test(run.err), run.err || run.out);
    }
  });
});
