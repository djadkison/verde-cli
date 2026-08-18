import { parse, COMMON_OPTIONS, str, oneOf } from "../args.js";
import { contextFrom, wantsJson } from "../context.js";
import { callTool } from "../transport.js";
import { printJson, table, dim, green } from "../render.js";
import { VISIBILITIES } from "../vocab.js";
import { CliError } from "../errors.js";

export const bucketsHelp = `List the buckets in a vault.

Usage
  verde buckets [--vault <vault>] [--json]

Buckets are the topic folders a document is filed into. \`verde save\` needs one.
`;

export const bucketCreateHelp = `Create a bucket.

Usage
  verde bucket create <name> --description <text> [options]

Options
  --description <text>          One sentence describing what belongs here. Required.
  --default-visibility <level>  public | company | private. Required — it is the
                                default every document filed here inherits.
  --vault <vault>               Vault to create it in.
  --json
`;

type BucketsResult = { buckets?: Array<{ id?: string; name?: string; description?: string; default_visibility?: string; document_count?: number }> };

export async function buckets(argv: string[]): Promise<void> {
  const { flags } = parse(argv, COMMON_OPTIONS, "buckets");
  if (flags.help) return void process.stdout.write(bucketsHelp);

  const ctx = await contextFrom(flags);
  const result = await callTool<BucketsResult>("list_buckets", {}, ctx);
  if (wantsJson(flags)) return printJson(result);

  const rows = (result.buckets ?? []).map((b) => [
    b.name ?? "",
    dim(b.default_visibility ?? ""),
    dim(typeof b.document_count === "number" ? `${b.document_count} docs` : ""),
    dim(b.description ?? ""),
  ]);
  process.stdout.write(rows.length ? `${table(rows)}\n` : dim("No buckets yet.\n"));
}

export async function bucketCreate(argv: string[]): Promise<void> {
  const { positionals, flags } = parse(
    argv,
    {
      ...COMMON_OPTIONS,
      description: { type: "string" },
      reason: { type: "string" },
      "default-visibility": { type: "string" },
    },
    "bucket create",
  );
  if (flags.help) return void process.stdout.write(bucketCreateHelp);

  const name = positionals[0];
  if (!name) throw new CliError("Missing bucket name.", { hint: "verde bucket create <name> --description <text> --default-visibility company" });

  const description = str(flags, "description");
  if (!description) throw new CliError("--description is required.", { hint: "One sentence describing what belongs in this bucket." });

  const reason = str(flags, "reason");
  if (!reason || reason.trim().length < 5) {
    throw new CliError("--reason is required (at least 5 characters).", {
      hint: "Say why a new bucket is warranted and no existing one fits — Verde uses it to avoid near-duplicate buckets.",
    });
  }

  const visibility = oneOf(str(flags, "default-visibility"), VISIBILITIES, "--default-visibility");
  if (!visibility) throw new CliError("--default-visibility is required.", { hint: `One of: ${VISIBILITIES.join(", ")}` });

  const ctx = await contextFrom(flags);
  const result = await callTool<{ result?: string; bucket?: { id?: string; name?: string } }>(
    "create_bucket",
    { name, description, reason, default_visibility: visibility },
    ctx,
  );
  if (wantsJson(flags)) return printJson(result);
  // Verde returns an existing near-match rather than duplicating, and says so
  // in `result` — echo its wording instead of always claiming a creation.
  process.stdout.write(`${green(result.result ?? "Bucket created.")}\n`);
  process.stdout.write(`${result.bucket?.name ?? name}\n`);
  if (result.bucket?.id) process.stdout.write(`${dim(result.bucket.id)}\n`);
}
