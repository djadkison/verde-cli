import { readFileSync } from "node:fs";
import { readStdin } from "./confirm.js";
import { str, type Flags } from "./args.js";
import { CliError } from "./errors.js";

/**
 * Content comes from exactly one of: --content, --file, or piped stdin.
 * Resolved in that order, and it is an error to give more than one — silently
 * preferring a flag over a pipe is how `cat notes.md | verde save -c ""` ends
 * up saving the wrong thing.
 */
export async function resolveContent(
  flags: Flags,
  required: boolean,
  // Injectable so the resolution rules can be tested without a real pipe.
  stdinReader: () => Promise<string | undefined> = readStdin,
): Promise<string | undefined> {
  const inline = str(flags, "content");
  const file = str(flags, "file");
  const piped = await stdinReader();

  const sources = [inline !== undefined && "--content", file !== undefined && "--file", piped !== undefined && "stdin"].filter(
    Boolean,
  ) as string[];

  if (sources.length > 1) {
    throw new CliError(`Content given twice (${sources.join(" and ")}).`, {
      hint: "Pick one source for the document body.",
    });
  }

  let content: string | undefined;
  if (inline !== undefined) content = inline;
  else if (file !== undefined) content = readFileOrDie(file);
  else content = piped;

  if (content !== undefined && !content.trim()) {
    throw new CliError("The document content is empty.");
  }
  if (required && content === undefined) {
    throw new CliError("No content given.", {
      hint: 'Pass --content "…", --file <path>, or pipe it: `cat notes.md | verde save …`',
    });
  }
  return content;
}

function readFileOrDie(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new CliError(`Could not read ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
}

/**
 * A title is the one field worth inferring: piping a markdown file whose first
 * line is `# Something` should not also require retyping that something.
 */
export function titleFromContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const firstLine = content.split(/\r?\n/).find((l) => l.trim().length);
  if (!firstLine) return undefined;
  const heading = firstLine.trim().match(/^#{1,6}\s+(.{2,200})$/);
  return heading?.[1]?.trim();
}
