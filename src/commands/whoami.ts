import { parse, COMMON_OPTIONS } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, table, bold, dim } from "../render.js";
import { vaultRef, type VaultsResult } from "../wire.js";

export const whoamiHelp = `Show which vaults this token can reach.

Usage
  verde whoami [--json]
`;

export async function whoami(argv: string[]): Promise<void> {
  const { flags } = parse(argv, COMMON_OPTIONS, "whoami");
  if (flags.help) return void process.stdout.write(whoamiHelp);

  const ctx = contextFrom(flags);
  const result = await callTool<VaultsResult>("list_vaults", {}, ctx);
  if (wantsJson(flags)) return printJson(result);

  const who = result.acting_as?.name;
  process.stdout.write(`${who ? `${bold(who)}  ` : ""}${dim(ctx.host)}\n`);
  if (result.connection_scope) process.stdout.write(`${dim(`${result.connection_scope} connection`)}\n`);
  process.stdout.write("\n");

  for (const team of result.teams ?? []) {
    const perms = [team.your_role, team.your_permission_level].filter(Boolean).join(" · ");
    process.stdout.write(`${bold(team.team ?? "(team)")}${perms ? ` ${dim(perms)}` : ""}\n`);
    const rows = (team.vaults ?? []).map((v) => [`  ${v.name ?? "(vault)"}`, dim(vaultRef(team.team_slug, v.slug))]);
    if (rows.length) process.stdout.write(`${table(rows)}\n`);
  }
}
