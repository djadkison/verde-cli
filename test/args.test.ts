import test from "node:test";
import assert from "node:assert/strict";
import { parse, list, int, oneOf, eachOneOf, requireUuid, COMMON_OPTIONS } from "../src/args.js";
import { CliError } from "../src/errors.js";
import { MEMORY_TYPES, VISIBILITIES } from "../src/vocab.js";
import { titleFromContent } from "../src/content.js";

const UUID = "3f4a1b2c-1111-4222-8333-444455556666";

test("an unknown flag names the command and points at its help", () => {
  assert.throws(
    () => parse(["--nope"], COMMON_OPTIONS, "search"),
    (err: CliError) => err instanceof CliError && err.message.startsWith("search:") && (err.hint ?? "").includes("verde search --help"),
  );
});

test("repeated flags and comma-separated values both make a list", () => {
  const repeated = parse(["--tag", "a", "--tag", "b"], { tag: { type: "string", multiple: true } }, "x");
  assert.deepEqual(list(repeated.flags, "tag"), ["a", "b"]);

  const commas = parse(["--tag", "a, b ,c"], { tag: { type: "string", multiple: true } }, "x");
  assert.deepEqual(list(commas.flags, "tag"), ["a", "b", "c"]);
});

test("an absent list stays undefined so it is pruned, not sent as []", () => {
  const { flags } = parse([], { tag: { type: "string", multiple: true } }, "x");
  assert.equal(list(flags, "tag"), undefined);
});

test("--limit rejects anything that is not a positive whole number", () => {
  const bad = (v: string) => parse(["--limit", v], { limit: { type: "string" } }, "x").flags;
  assert.equal(int(bad("10"), "limit"), 10);
  for (const v of ["0", "-3", "2.5", "ten", ""]) {
    assert.throws(() => int(bad(v), "limit"), CliError, `expected "${v}" to be rejected`);
  }
});

test("enum flags list the valid values in the error", () => {
  assert.equal(oneOf("company", VISIBILITIES, "--visibility"), "company");
  assert.throws(
    () => oneOf("interal", VISIBILITIES, "--visibility"),
    (err: CliError) => err instanceof CliError && err.message.includes("public, company, private"),
  );
  assert.equal(oneOf(undefined, VISIBILITIES, "--visibility"), undefined);
});

test("every item of a list is validated, not just the first", () => {
  assert.deepEqual(eachOneOf(["fact", "decision"], MEMORY_TYPES, "--type"), ["fact", "decision"]);
  assert.throws(() => eachOneOf(["fact", "nonsense"], MEMORY_TYPES, "--type"), CliError);
});

test("ids are validated locally, so a typo costs no request and no metered call", () => {
  assert.equal(requireUuid(UUID, "document id"), UUID);
  assert.throws(() => requireUuid("not-an-id", "document id"), CliError);
  assert.throws(() => requireUuid(undefined, "document id"), CliError);
});

test("a title is inferred from a leading markdown heading", () => {
  assert.equal(titleFromContent("# Ship the CLI\n\nbody"), "Ship the CLI");
  assert.equal(titleFromContent("\n\n### Nested heading\ntext"), "Nested heading");
  assert.equal(titleFromContent("no heading here"), undefined);
  assert.equal(titleFromContent("#toohashed"), undefined);
  assert.equal(titleFromContent(undefined), undefined);
});
