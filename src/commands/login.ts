import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { parse } from "../args.js";
import { readConfig, resolveHost, configPath, DEFAULT_HOST } from "../config.js";
import { saveOAuth, savePat } from "../auth.js";
import { callTool } from "../transport.js";
import { openBrowser } from "../browser.js";
import { CliError } from "../errors.js";
import { green, dim, bold } from "../render.js";
import {
  authorizeUrl,
  createPkce,
  discover,
  exchangeCode,
  issuerMatches,
  registerClient,
  startListener,
  type Metadata,
} from "../oauth.js";
import type { VaultsResult } from "../wire.js";

export const loginHelp = `Sign in to Verde.

Usage
  verde login                    Sign in through your browser (recommended)
  verde login --token <token>    Sign in with a personal access token

The browser flow opens Verde's consent screen, where you choose which vaults
this CLI may reach. Approving a whole team is what makes --vault work; a
personal access token is pinned to the single vault that minted it.

Options
  --token <token>   Use a personal access token instead of the browser flow.
                    Omit the value to be prompted for it.
  --no-browser      Print the URL instead of opening a browser. Use this over
                    SSH, then open the URL on the machine with the browser.
  --host <url>      Verde instance (default ${DEFAULT_HOST}).

Environment
  VERDE_TOKEN       Overrides everything stored on disk. Use this in CI.
`;

export async function login(argv: string[]): Promise<void> {
  const { flags } = parse(
    argv,
    {
      token: { type: "string" },
      "no-browser": { type: "boolean" },
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    "login",
  );
  if (flags.help) return void process.stdout.write(loginHelp);

  const host = resolveHost(typeof flags.host === "string" ? flags.host : undefined);

  // `--token` with no value still parses as a present flag, which is the
  // "prompt me" shape; only the browser flow is skipped by naming it at all.
  if ("token" in flags) return loginWithToken(host, typeof flags.token === "string" ? flags.token : "");
  return loginWithBrowser(host, flags["no-browser"] === true);
}

async function loginWithBrowser(host: string, noBrowser: boolean): Promise<void> {
  const meta = await discover(host);

  // Reuse a client_id we already registered with this host; registration is
  // rate limited, and a fresh row per login would litter the clients table.
  const existing = readConfig();
  const reusable = existing.host === host ? existing.oauth?.clientId : undefined;
  const clientId = reusable ?? (await registerClient(meta));

  const listener = await startListener();
  const pkce = createPkce();
  const state = randomBytes(16).toString("base64url");

  try {
    const url = authorizeUrl(meta, {
      clientId,
      redirectUri: listener.redirectUri,
      state,
      challenge: pkce.challenge,
    });

    const opened = noBrowser ? false : openBrowser(url);
    process.stderr.write(
      opened
        ? `${dim("Opening your browser to approve this connection…")}\n${dim("If it did not open:")} ${url}\n`
        : `${bold("Open this URL to approve the connection:")}\n${url}\n`,
    );
    process.stderr.write(dim("Waiting for you to finish in the browser… (Ctrl-C to cancel)\n"));

    const callback = await listener.waitForCode(state);

    // RFC 9207: the response names its issuer, so a callback from a different
    // authorization server than the one we asked is rejected.
    if (!issuerMatches(callback.iss, host)) {
      throw new CliError(`The authorization came from an unexpected issuer (${callback.iss}).`);
    }

    const tokens = await exchangeCode(meta, {
      clientId,
      code: callback.code,
      redirectUri: listener.redirectUri,
      verifier: pkce.verifier,
    });

    saveOAuth(
      {
        clientId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
      host,
    );

    await report(host, tokens.accessToken, meta);
  } finally {
    listener.close();
  }
}

async function loginWithToken(host: string, given: string): Promise<void> {
  let token = given.trim();

  if (!token) {
    if (!process.stdin.isTTY) {
      throw new CliError("No token given and no terminal to ask for one.", {
        hint: "Pass --token <token>, or set VERDE_TOKEN.",
      });
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      token = (await rl.question(`Token for ${host}: `)).trim();
    } finally {
      rl.close();
    }
  }
  if (!token) throw new CliError("No token entered.");

  // Prove the token before storing it — a config file holding a dead token is
  // worse than no config file, because the failure surfaces later and further
  // from the cause.
  const result = await callTool<VaultsResult>("list_vaults", {}, { host, token });
  savePat(token, host);
  await announce(host, result);
}

async function report(host: string, token: string, _meta: Metadata): Promise<void> {
  const result = await callTool<VaultsResult>("list_vaults", {}, { host, token });
  await announce(host, result);
}

function announce(host: string, result: VaultsResult): void {
  const vaultCount = (result.teams ?? []).reduce((n, t) => n + (t.vaults?.length ?? 0), 0);
  const team = result.teams?.[0]?.team;
  process.stdout.write(`${green("Signed in")}${team ? ` — ${team}` : ""}\n`);
  process.stdout.write(
    dim(`${vaultCount} vault${vaultCount === 1 ? "" : "s"} reachable · ${host}\n`),
  );
  if (result.connection_scope === "single-vault") {
    process.stdout.write(
      dim("This connection is pinned to one vault, so --vault is not available.\n"),
    );
  }
  process.stdout.write(dim(`Credentials stored in ${configPath()} (0600).\n`));
}
