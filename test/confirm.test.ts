import test from "node:test";
import assert from "node:assert/strict";
import { confirm } from "../src/confirm.js";
import { CliError } from "../src/errors.js";

/** node --test runs with a non-TTY stdin, which is exactly the scripted case. */
test("--yes runs straight through without asking", async () => {
  await confirm("Archive it?", { yes: true });
});

test("without a terminal and without --yes it refuses rather than assuming yes", async () => {
  await assert.rejects(
    () => confirm("Archive it?", { yes: false }),
    (err: CliError) =>
      err instanceof CliError &&
      err.message.includes("Archive it?") &&
      (err.hint ?? "").includes("--yes"),
  );
});
