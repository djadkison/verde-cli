import type { WireMemory } from "./render.js";

/**
 * Verde's tool payloads are shaped for a reading model, not for a client with
 * one code path — get_memory returns a bare document for a single id but
 * `{ documents: [...] }` for a batch, and supersede answers with `new_memory`
 * rather than `memory`. Normalizing here keeps that variation in one file
 * instead of spread across every command.
 */

export type GetMemoryResult = WireMemory & {
  documents?: WireMemory[];
  requested?: number;
  returned?: number;
};

/** Every document in a get_memory response, whichever form it came back in. */
export function documentsOf(result: GetMemoryResult): WireMemory[] {
  if (Array.isArray(result.documents)) return result.documents;
  return result.id ? [result] : [];
}

/** The single document a pre-read asked for, or undefined if it is gone. */
export function documentOf(result: GetMemoryResult): WireMemory | undefined {
  return documentsOf(result)[0];
}

export type MemoryResult = { result?: string; memory?: WireMemory };
export type SupersedeResult = { result?: string; new_memory?: WireMemory; old_memory?: WireMemory };

/** propose/update/publish/archive say `memory`; supersede says `new_memory`. */
export function writtenMemory(result: MemoryResult & SupersedeResult): WireMemory | undefined {
  return result.memory ?? result.new_memory;
}

export type VaultsResult = {
  connection_scope?: string;
  acting_as?: { name?: string; permission_level?: string };
  teams?: Array<{
    team?: string;
    team_slug?: string;
    personal?: boolean;
    your_role?: string;
    your_permission_level?: string;
    vaults?: Array<{ id?: string; name?: string; slug?: string }>;
  }>;
};

/**
 * A vault's `slug` already arrives fully qualified as "team/vault" — but only
 * because the server builds it that way today. Prefixing conditionally means a
 * change there degrades to a correct-but-unqualified name, not "team/team/vault".
 */
export function vaultRef(teamSlug: string | undefined, slug: string | undefined): string {
  if (!slug) return teamSlug ?? "";
  return slug.includes("/") || !teamSlug ? slug : `${teamSlug}/${slug}`;
}
