import { parse, COMMON_OPTIONS } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, table, dim } from "../render.js";
import { vaultRef, type VaultsResult } from "../wire.js";

export const vaultsHelp = `List every team and vault this connection can reach.

Usage
  verde vaults [--json]

A token minted in a vault reaches only that vault. Team-wide OAuth connections
(v1.1) will list every vault in their team.
`;

export async function vaults(argv: string[]): Promise<void> {
  const { flags } = parse(argv, COMMON_OPTIONS, "vaults");
  if (flags.help) return void process.stdout.write(vaultsHelp);

  const ctx = contextFrom(flags);
  const result = await callTool<VaultsResult>("list_vaults", {}, ctx);
  if (wantsJson(flags)) return printJson(result);

  const rows: string[][] = [];
  for (const team of result.teams ?? []) {
    for (const v of team.vaults ?? []) {
      rows.push([vaultRef(team.team_slug, v.slug), v.name ?? "", dim(v.id ?? "")]);
    }
  }
  process.stdout.write(rows.length ? `${table(rows)}\n` : dim("No vaults reachable with this token.\n"));
}
