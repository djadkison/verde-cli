import { isCliError } from "./errors.js";
import { login, loginHelp } from "./commands/login.js";
import { logout, logoutHelp } from "./commands/logout.js";
import { whoami, whoamiHelp } from "./commands/whoami.js";
import { vaults, vaultsHelp } from "./commands/vaults.js";
import { buckets, bucketCreate, bucketsHelp, bucketCreateHelp } from "./commands/buckets.js";
import { search, searchHelp } from "./commands/search.js";
import { get, getHelp } from "./commands/get.js";
import { list, listHelp } from "./commands/list.js";
import { open, openHelp } from "./commands/open.js";
import { save, saveHelp } from "./commands/save.js";
import { update, updateHelp } from "./commands/update.js";
import { publish, publishHelp } from "./commands/publish.js";
import { supersede, supersedeHelp } from "./commands/supersede.js";
import { archive, archiveHelp } from "./commands/archive.js";

const VERSION = "0.1.0";

type Command = {
  run: (argv: string[]) => Promise<void>;
  help: string;
  summary: string;
};

const COMMANDS: Record<string, Command> = {
  login: { run: login, help: loginHelp, summary: "Sign in with a personal access token" },
  logout: { run: logout, help: logoutHelp, summary: "Remove the stored token" },
  whoami: { run: whoami, help: whoamiHelp, summary: "Show which vaults this token reaches" },
  vaults: { run: vaults, help: vaultsHelp, summary: "List teams and vaults" },
  buckets: { run: buckets, help: bucketsHelp, summary: "List buckets in a vault" },
  bucket: { run: bucketSubcommand, help: bucketCreateHelp, summary: "Create a bucket (`bucket create`)" },
  search: { run: search, help: searchHelp, summary: "Search the vault" },
  get: { run: get, help: getHelp, summary: "Fetch documents in full" },
  list: { run: list, help: listHelp, summary: "Recently created or updated documents" },
  open: { run: open, help: openHelp, summary: "Open a document in the browser" },
  save: { run: save, help: saveHelp, summary: "Save a new document" },
  update: { run: update, help: updateHelp, summary: "Correct a document in place" },
  publish: { run: publish, help: publishHelp, summary: "Take a draft live" },
  supersede: { run: supersede, help: supersedeHelp, summary: "Replace a document, keeping history" },
  archive: { run: archive, help: archiveHelp, summary: "Archive a document (reversible)" },
};

async function bucketSubcommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "create") return bucketCreate(rest);
  process.stderr.write(`Unknown subcommand \`bucket ${sub ?? ""}\`.\n\n${bucketCreateHelp}`);
  process.exitCode = 1;
}

function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`);
  return `Verde — your team's shared memory, from the terminal.

Usage
  verde <command> [options]

Commands
${lines.join("\n")}

Common options
  --vault <vault>   Act in a specific vault (team-wide connections only).
  --host <url>      Point at a different Verde instance.
  --json            Machine-readable output.
  -h, --help        Help for any command.

Environment
  VERDE_TOKEN       Access token; overrides the stored one.
  VERDE_HOST        Default instance.
  VERDE_CONFIG      Path to the config file.
  NO_COLOR          Disable colour.

Getting started
  verde login
  verde search "deployment"
  cat notes.md | verde save --bucket Decisions --type decision
`;
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);

  if (!name || name === "help") {
    const topic = rest[0];
    const cmd = topic ? COMMANDS[topic] : undefined;
    process.stdout.write(cmd ? cmd.help : usage());
    return;
  }
  if (name === "--version" || name === "-v" || name === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (name === "--help" || name === "-h") {
    process.stdout.write(usage());
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`Unknown command \`${name}\`.\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }

  await command.run(rest);
}

main().catch((err: unknown) => {
  if (isCliError(err)) {
    process.stderr.write(`${err.message}\n`);
    if (err.hint) process.stderr.write(`${err.hint}\n`);
    process.exitCode = err.exitCode;
    return;
  }
  // Not ours — the stack is what makes it reportable.
  console.error(err);
  process.exitCode = 1;
});
