import { CliError } from "./errors.js";

/**
 * Verde's MCP endpoint, driven as plain HTTP.
 *
 * The server runs `mcp-handler` with no `sessionIdGenerator`, which puts the
 * MCP SDK's Streamable HTTP transport in stateless mode: session validation is
 * skipped entirely and a fresh server is constructed per POST. There is no
 * handshake to perform and no session id to carry — one request, one answer.
 *
 * Two details of that transport leak into the wire format and are handled here:
 *   1. It 406s unless Accept lists BOTH application/json and text/event-stream.
 *   2. With `enableJsonResponse` off (the default, and Verde's setting) the
 *      reply is a one-event SSE stream rather than a JSON body.
 * We parse both framings so that flipping (2) server-side never breaks the CLI.
 */

const JSONRPC_ID = 1;

export type ToolContext = {
  host: string;
  token: string;
  /** Per-call vault override; ignored by the server on vault-pinned tokens. */
  vault?: string;
  timeoutMs?: number;
};

type JsonRpcReply = {
  result?: {
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

/**
 * Pulls the JSON-RPC payload out of either an SSE stream or a bare JSON body.
 * SSE data may be split across several `data:` lines in one event; the spec
 * says to join them with newlines before parsing.
 */
export function parseRpcBody(body: string, contentType: string | null): JsonRpcReply {
  const isSse = (contentType ?? "").includes("text/event-stream");
  const raw = isSse ? joinSseData(body) : body.trim();
  if (!raw) {
    throw new CliError("Verde returned an empty response.", {
      hint: "This is usually transient — try again.",
    });
  }
  try {
    return JSON.parse(raw) as JsonRpcReply;
  } catch {
    throw new CliError("Could not parse Verde's response.", {
      hint: raw.slice(0, 200),
    });
  }
}

function joinSseData(body: string): string {
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    // Only `data:` carries payload; `event:`/`id:`/`retry:`/comments do not.
    if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
  }
  return lines.join("\n").trim();
}

async function rpc(method: string, params: unknown, ctx: ToolContext): Promise<JsonRpcReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? 60_000);

  let res: Response;
  try {
    res = await fetch(`${ctx.host}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: JSONRPC_ID, method, params }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new CliError(`Timed out after ${(ctx.timeoutMs ?? 60_000) / 1000}s talking to ${ctx.host}.`);
    }
    throw new CliError(`Could not reach ${ctx.host}: ${(err as Error).message}`, {
      hint: "Check your connection, or --host if you are pointing at a self-hosted Verde.",
    });
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();

  if (res.status === 401) {
    throw new CliError("Verde rejected the token.", {
      exitCode: 2,
      hint: "It may have been revoked. Run `verde login` with a fresh token.",
    });
  }
  if (res.status === 429) {
    const retry = res.headers.get("retry-after");
    throw new CliError("Rate limited by Verde.", {
      exitCode: 3,
      hint: retry ? `Try again in ${retry}s.` : "Try again shortly.",
    });
  }
  if (!res.ok && res.status !== 400) {
    throw new CliError(`Verde returned HTTP ${res.status}.`, { hint: body.slice(0, 200) });
  }

  return parseRpcBody(body, res.headers.get("content-type"));
}

/**
 * Calls one tool and returns its `structuredContent` — every Verde tool
 * declares an outputSchema, so the structured object is always present and
 * always matches the human-readable text block. No re-parsing of prose.
 */
export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<T> {
  const withVault = ctx.vault ? { vault: ctx.vault, ...args } : args;
  const reply = await rpc("tools/call", { name, arguments: prune(withVault) }, ctx);

  if (reply.error) throw new CliError(cleanMessage(reply.error.message));

  const result = reply.result;
  if (!result) throw new CliError("Verde returned a response with no result.");

  // A tool-level failure (authorization, validation, quota) comes back as a
  // successful JSON-RPC reply carrying isError — the message is written for a
  // human, so it is surfaced verbatim.
  if (result.isError) {
    throw new CliError(cleanMessage(textOf(result.content) || "The request was refused."));
  }

  if (result.structuredContent === undefined) {
    const text = textOf(result.content);
    if (text) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new CliError(text);
      }
    }
    throw new CliError("Verde returned an empty result.");
  }
  return result.structuredContent as T;
}

type ContentBlock = { type: string; text?: string };

function textOf(content: ContentBlock[] | undefined): string {
  if (!content) return "";
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
}

/** Strips the SDK's framing off messages so users see the sentence, not the wrapper. */
function cleanMessage(message: string): string {
  return message
    .replace(/^MCP error -?\d+:\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
}

/** undefined keys would serialize as absent anyway; null would fail Zod. */
function prune(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null));
}
