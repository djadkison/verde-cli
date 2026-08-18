# verde-cli

Your team's shared memory, from the terminal.

```bash
npx verde-cli search "why did we drop the queue"
```

Verde keeps a team's durable knowledge — decisions, facts, procedures, lessons —
in vaults that AI assistants read and write over MCP. This is the same thing for
humans and shell scripts: search it, read it, and write to it without opening a
browser.

## Install

```bash
npm install -g verde-cli
```

Or run it without installing:

```bash
npx verde-cli whoami
```

Node 20.11 or newer. No runtime dependencies.

## Sign in

```bash
verde login
```

That opens your browser to Verde's consent screen, where you choose what this
CLI may reach — a single vault, or a whole team. Approving a team is what makes
`--vault` work.

Over SSH, or anywhere without a browser:

```bash
verde login --no-browser     # prints the URL to open elsewhere
```

Prefer a token? `verde login --token <token>` still works — create one in Verde
under your vault's **MCP** settings. A token is pinned to the vault that minted
it, so `--vault` is unavailable on that path.

Credentials are written to `~/.config/verde/config.json` with mode `0600`. For
CI, skip the file entirely and set `VERDE_TOKEN`.

<details>
<summary>How the browser flow works</summary>

Standard RFC 8252 native-app OAuth: the CLI registers itself as a public client
("Verde CLI", which is the name that then shows up in Verde's activity feed),
binds an ephemeral port on `127.0.0.1` for the redirect, and uses PKCE S256.
Verde matches loopback redirects ignoring the port, so no fixed port is
reserved. Nothing is sent anywhere but your Verde instance.

Access tokens last 8 hours and refresh automatically; refresh tokens last 60
days and rotate on every use. The rotated pair is written atomically under a
lock, so several `verde` commands running at once refresh exactly once between
them rather than racing and invalidating each other.
</details>

## Use it

```bash
# Search
verde search "deployment rollback"
verde search --type decision --bucket Architecture --limit 5
verde search "auth" --historical          # include superseded and archived

# Read
verde get 3f4a1b2c-…                       # full document
verde get 3f4a1b2c-… 8b21c4d5-…            # up to 20 ids in one metered call
verde get 3f4a1b2c-… --raw > decision.md   # just the markdown
verde open 3f4a1b2c-…                      # in the browser

# Browse
verde list --limit 20
verde buckets
verde vaults

# Write
git log -20 --oneline | verde save --bucket "Working Memory" --type working_note \
  --title "Release notes for 2.4"

verde save --bucket Decisions --type decision --file rfc.md
verde update 3f4a1b2c-… --title "Corrected title"
verde publish 3f4a1b2c-…
verde supersede 3f4a1b2c-… --file replacement.md --yes
verde archive 3f4a1b2c-… --yes
```

`verde save` takes its body from an argument, `--file`, or a pipe — one of them,
never two. If the body opens with a markdown heading, the title is taken from it.

## Commands

| | |
|---|---|
| `verde login` / `logout` / `whoami` | Manage credentials |
| `verde vaults` | Teams and vaults this connection reaches |
| `verde buckets` | Buckets in a vault |
| `verde bucket create <name>` | Create a bucket |
| `verde search [query]` | Search the vault |
| `verde get <id>...` | Fetch documents in full |
| `verde list` | Recently created or updated |
| `verde open <id>` | Open a document in the browser |
| `verde save` | Save a new document |
| `verde update <id>` | Correct a document in place |
| `verde publish <id>` | Take a draft live |
| `verde supersede <id>` | Replace a document, keeping history |
| `verde archive <id>` | Archive a document (reversible) |

Every Verde MCP tool has a command. `verde <command> --help` documents each one.

## Drafts, publishing, and the public web

Whether a new document is a draft depends on its visibility, which trips people
up often enough to spell out:

| Visibility | `verde save` leaves it |
|---|---|
| `private` | **published** — it is visible only to you either way |
| `company` | a **draft**, until `--publish` or `verde publish` |
| `public` | **always a draft**, whatever flags you pass |

`--publish` and `--draft` override the first two.

Public documents are the exception on purpose. Publishing one puts it on the open
internet immediately, so `verde publish` prints the full body and refuses to
continue without `--confirm-public`. `--yes` does not cover it: skipping a
confirmation is a convenience for scripts, and putting a page on the public web
is not something a script should be able to do by inheriting a flag meant for
something else.

## Scripting

`--json` prints the tool's structured payload verbatim — the same objects the
server validates against its own output schema, so nothing is re-parsed out of
prose.

```bash
verde search "postgres" --json | jq -r '.results[] | "\(.title)\t\(.id)"'
```

`--yes` skips the confirmation on `archive` and `supersede`. Without a terminal
and without `--yes`, those commands refuse rather than assuming yes — a prompt
that silently auto-answers in a pipeline is how a cron job archives something
nobody meant to touch.

Exit codes: `0` success, `1` a refused or invalid request, `2` a rejected token
or expired session, `3` rate limited, `130` cancelled at a prompt.

### Environment

| | |
|---|---|
| `VERDE_TOKEN` | Access token; overrides stored credentials entirely |
| `VERDE_HOST` | Verde instance (default `https://getverde.ai`) |
| `VERDE_CONFIG` | Path to the config file |
| `NO_COLOR` | Disable colour |

### Two things worth knowing before you loop over this

Every content command is **metered against your team's MCP allowance** — the CLI
spends the same quota an AI assistant does. And searches and reads **write
activity rows**, so they appear in the team's activity feed. Both are Verde
server behaviours, identical for any client; neither is something the CLI opts
out of. Batch with `verde get <id> <id> …` rather than looping, and prefer one
`--limit 50` search over five paged ones.

The MCP endpoint is also rate limited per IP (300 requests/minute).

## How it talks to Verde

There is no separate REST API and no MCP client library here. Verde's MCP
endpoint runs in stateless mode — no session id, no `initialize` handshake — so
the CLI POSTs a single JSON-RPC `tools/call` to `/api/mcp` with a bearer token
and reads the answer back. That is the whole integration; see
[`src/transport.ts`](src/transport.ts).

Because it adds no tools and changes nothing server-side, the CLI is invisible to
every other Verde client.

## Development

```bash
npm install
npm run typecheck
npm test          # unit tests, no network
npm run build
```

The end-to-end suites talk to a real Verde and are opt-in:

```bash
# read-only
VERDE_HOST=http://localhost:3000 VERDE_TOKEN=vrd_… npm run test:live

# full lifecycle — creates a scratch bucket and documents, then archives them
npm run build
VERDE_HOST=http://localhost:3000 VERDE_TOKEN=vrd_… VERDE_E2E_WRITE=1 \
  node --import tsx --test test/e2e.test.ts
```

Point those at a development vault. They spend metered calls and leave activity
rows like any other client.

## Licence

MIT
