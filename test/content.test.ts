import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContent } from "../src/content.js";
import { CliError } from "../src/errors.js";
import type { Flags } from "../src/args.js";

const noStdin = async () => undefined;
const piped = (text: string) => async () => text;

test("takes content from --content", async () => {
  assert.equal(await resolveContent({ content: "hello" } as Flags, true, noStdin), "hello");
});

test("takes content from --file", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "verde-content-")), "note.md");
  writeFileSync(path, "# From a file\n\nbody");
  assert.equal(await resolveContent({ file: path } as Flags, true, noStdin), "# From a file\n\nbody");
});

test("takes content from a pipe", async () => {
  assert.equal(await resolveContent({} as Flags, true, piped("piped body")), "piped body");
});

test("refuses two sources instead of silently picking one", async () => {
  await assert.rejects(
    () => resolveContent({ content: "a" } as Flags, true, piped("b")),
    (err: CliError) => err instanceof CliError && err.message.includes("--content and stdin"),
  );
  await assert.rejects(
    () => resolveContent({ content: "a", file: "/tmp/x" } as Flags, true, noStdin),
    (err: CliError) => err instanceof CliError && err.message.includes("--content and --file"),
  );
});

test("an unreadable file names the file and the reason", async () => {
  await assert.rejects(
    () => resolveContent({ file: "/nope/missing.md" } as Flags, true, noStdin),
    (err: CliError) => err instanceof CliError && err.message.includes("/nope/missing.md") && err.message.includes("ENOENT"),
  );
});

test("whitespace-only content is rejected, not saved as an empty document", async () => {
  await assert.rejects(() => resolveContent({ content: "   \n\t " } as Flags, true, noStdin), CliError);
});

test("required vs optional: update may pass no content, save may not", async () => {
  assert.equal(await resolveContent({} as Flags, false, noStdin), undefined);
  await assert.rejects(() => resolveContent({} as Flags, true, noStdin), CliError);
});
