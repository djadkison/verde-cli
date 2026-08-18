import { parseArgs, type ParseArgsConfig } from "node:util";
import { CliError } from "./errors.js";

export type Flags = Record<string, string | boolean | string[] | undefined>;

export type Parsed = {
  positionals: string[];
  flags: Flags;
};

/**
 * Thin wrapper over node:util parseArgs so an unknown flag fails loudly with
 * the command's own name attached, rather than parseArgs' bare message.
 */
export function parse(argv: string[], options: ParseArgsConfig["options"], command: string): Parsed {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      strict: true,
    });
    return { positionals, flags: values as Flags };
  } catch (err) {
    throw new CliError(`${command}: ${(err as Error).message}`, {
      hint: `Run \`verde ${command} --help\` for the accepted options.`,
    });
  }
}

/** Options every command accepts, merged into each command's own set. */
export const COMMON_OPTIONS = {
  json: { type: "boolean" as const },
  vault: { type: "string" as const },
  host: { type: "string" as const },
  help: { type: "boolean" as const, short: "h" },
};

export function str(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function bool(flags: Flags, name: string): boolean {
  return flags[name] === true;
}

export function list(flags: Flags, name: string): string[] | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  const items = Array.isArray(v) ? v : [String(v)];
  // Accept both repeated flags and one comma-separated value.
  const flat = items.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  return flat.length ? flat : undefined;
}

export function int(flags: Flags, name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliError(`--${name} must be a positive whole number (got "${v}").`);
  }
  return n;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validated locally so a typo costs no round-trip, no rate-limit budget and —
 * because every content call is metered against the team's MCP allowance — no
 * quota either.
 */
export function requireUuid(value: string | undefined, label: string): string {
  if (!value) throw new CliError(`Missing ${label}.`);
  if (!UUID.test(value)) {
    throw new CliError(`${label} must be a document id (a UUID), got "${value}".`, {
      hint: "Ids come from `verde search` or `verde list`.",
    });
  }
  return value;
}

export function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new CliError(`${label} must be one of: ${allowed.join(", ")} (got "${value}").`);
  }
  return value as T;
}

export function eachOneOf<T extends string>(
  values: string[] | undefined,
  allowed: readonly T[],
  label: string,
): T[] | undefined {
  if (!values) return undefined;
  return values.map((v) => oneOf(v, allowed, label) as T);
}
