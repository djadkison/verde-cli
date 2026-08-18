import test from "node:test";
import assert from "node:assert/strict";
import { parseRpcBody, callTool } from "../src/transport.js";
import { CliError } from "../src/errors.js";

test("parses an SSE-framed reply", () => {
  const body = 'event: message\ndata: {"result":{"structuredContent":{"ok":true}}}\n\n';
  const reply = parseRpcBody(body, "text/event-stream");
  assert.deepEqual(reply.result?.structuredContent, { ok: true });
});

test("parses a bare JSON reply, so enabling enableJsonResponse cannot break us", () => {
  const reply = parseRpcBody('{"result":{"structuredContent":{"ok":true}}}', "application/json");
  assert.deepEqual(reply.result?.structuredContent, { ok: true });
});

test("joins a payload split across several data: lines", () => {
  const body = 'event: message\ndata: {"result":\ndata: {"structuredContent":{"n":1}}}\n\n';
  const reply = parseRpcBody(body, "text/event-stream");
  assert.deepEqual(reply.result?.structuredContent, { n: 1 });
});

test("ignores SSE fields that are not data", () => {
  const body = ': keepalive\nid: 7\nretry: 3000\nevent: message\ndata: {"result":{"structuredContent":1}}\n';
  assert.equal(parseRpcBody(body, "text/event-stream").result?.structuredContent, 1);
});

test("an empty body is an error, not undefined", () => {
  assert.throws(() => parseRpcBody("", "text/event-stream"), CliError);
});

test("unparseable output reports the beginning of what came back", () => {
  assert.throws(
    () => parseRpcBody("<html>gateway timeout</html>", "text/html"),
    (err: CliError) => err instanceof CliError && (err.hint ?? "").includes("<html>"),
  );
});

/** Swaps global fetch for one canned response, restoring it afterwards. */
async function withFetch<T>(
  handler: (url: string, init: RequestInit) => Response,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) =>
    handler(String(url), init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const sse = (payload: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const CTX = { host: "https://example.test", token: "vd_test" };

test("sends a stateless tools/call with no initialize and no session id", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const out = await withFetch(
    (url, init) => {
      seen = { url, init };
      return sse({ result: { structuredContent: { vault: "KB" } } });
    },
    () => callTool("search_memories", { query: "x" }, CTX),
  );

  assert.deepEqual(out, { vault: "KB" });
  assert.equal(seen?.url, "https://example.test/api/mcp");
  const headers = seen?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer vd_test");
  // Both types, or the SDK's transport answers 406.
  assert.match(headers.accept ?? "", /application\/json/);
  assert.match(headers.accept ?? "", /text\/event-stream/);
  assert.equal(headers["mcp-session-id"], undefined);

  const body = JSON.parse(String(seen?.init.body));
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "search_memories");
  assert.deepEqual(body.params.arguments, { query: "x" });
});

test("prepends the vault when one is given", async () => {
  const body = await withFetch(
    (_url, init) => {
      const parsed = JSON.parse(String(init.body));
      return sse({ result: { structuredContent: parsed.params.arguments } });
    },
    () => callTool<Record<string, unknown>>("list_buckets", {}, { ...CTX, vault: "team/kb" }),
  );
  assert.deepEqual(body, { vault: "team/kb" });
});

test("drops undefined arguments rather than sending nulls Zod would reject", async () => {
  const sent = await withFetch(
    (_url, init) => sse({ result: { structuredContent: JSON.parse(String(init.body)).params.arguments } }),
    () => callTool<Record<string, unknown>>("search_memories", { query: "x", bucket: undefined, tags: null }, CTX),
  );
  assert.deepEqual(sent, { query: "x" });
});

test("401 is a clean message with exit code 2, not a stack trace", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () => new Response('{"error":"invalid_token"}', { status: 401 }),
        () => callTool("list_vaults", {}, CTX),
      ),
    (err: CliError) => err instanceof CliError && err.exitCode === 2 && /rejected the token/.test(err.message),
  );
});

test("429 surfaces Retry-After", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
        () => callTool("list_vaults", {}, CTX),
      ),
    (err: CliError) => err instanceof CliError && err.exitCode === 3 && (err.hint ?? "").includes("30s"),
  );
});

test("a tool-level isError becomes the user-facing message, unwrapped", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () =>
          sse({
            result: {
              isError: true,
              content: [{ type: "text", text: "Error: This connection was authorized for another vault." }],
            },
          }),
        () => callTool("get_memory", { id: "x" }, CTX),
      ),
    (err: CliError) => err instanceof CliError && err.message === "This connection was authorized for another vault.",
  );
});

test("a JSON-RPC error is unwrapped from its MCP framing", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () => sse({ error: { code: -32602, message: "MCP error -32602: Input validation error: bad bucket" } }),
        () => callTool("propose_memory", {}, CTX),
      ),
    (err: CliError) => err instanceof CliError && err.message === "Input validation error: bad bucket",
  );
});

test("falls back to the text block when a tool returns no structuredContent", async () => {
  const out = await withFetch(
    () => sse({ result: { content: [{ type: "text", text: '{"legacy":true}' }] } }),
    () => callTool("list_vaults", {}, CTX),
  );
  assert.deepEqual(out, { legacy: true });
});

test("a network failure names the host instead of leaking a fetch stack", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () => {
          throw new Error("ECONNREFUSED");
        },
        () => callTool("list_vaults", {}, CTX),
      ),
    (err: CliError) => err instanceof CliError && err.message.includes("https://example.test"),
  );
});
