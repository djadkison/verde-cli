/**
 * The one error type the CLI prints without a stack trace. Anything else
 * escaping to the top level is a bug and gets the full trace, because a
 * stack is what makes it reportable.
 */
export class CliError extends Error {
  readonly exitCode: number;
  /** Optional second line: what the user can actually do about it. */
  readonly hint?: string;

  constructor(message: string, opts: { exitCode?: number; hint?: string } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = opts.exitCode ?? 1;
    this.hint = opts.hint;
  }
}

export function isCliError(err: unknown): err is CliError {
  return err instanceof CliError;
}
