import test from "node:test";
import assert from "node:assert/strict";
import { wrap, table, memoryBlock, memoryList } from "../src/render.js";

test("wraps at the given width without splitting words", () => {
  const lines = wrap("one two three four five six seven eight", 12);
  assert.ok(lines.every((l) => l.length <= 12));
  assert.equal(lines.join(" ").replace(/…$/, "").trim(), "one two three four five six seven eight");
});

test("truncates long bodies with an ellipsis line rather than printing the whole document", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const lines = wrap(long, 40, 3);
  assert.equal(lines.length, 4);
  assert.equal(lines.at(-1), "…");
});

test("a token longer than the width is left intact instead of being chopped", () => {
  const url = "https://getverde.ai/t/team/vault/m/3f4a1b2c-1111-4222-8333-444455556666";
  assert.deepEqual(wrap(url, 20), [url]);
});

test("table pads every column but the last, so nothing trails whitespace", () => {
  const out = table([
    ["a", "long-value", "x"],
    ["bbbb", "v", "y"],
  ]);
  assert.deepEqual(out.split("\n"), ["a     long-value  x", "bbbb  v           y"]);
});

test("a document block leads with the title and ends with the copyable id", () => {
  const block = memoryBlock({
    id: "3f4a1b2c-1111-4222-8333-444455556666",
    title: "Ship the CLI",
    type: "decision",
    status: "published",
    visibility: "company",
    excerpt: "We decided to ship it.",
  });
  const lines = block.split("\n");
  assert.match(lines[0]!, /Ship the CLI/);
  assert.match(lines.at(-1)!, /3f4a1b2c/);
  // A published document does not need a status badge; the absence is the signal.
  assert.doesNotMatch(block, /published/);
});

test("a draft is badged, because that is the part you would otherwise miss", () => {
  assert.match(memoryBlock({ title: "T", status: "draft", type: "fact" }), /draft/);
});

test("an empty result set says so instead of printing nothing", () => {
  assert.match(memoryList([], "No matching documents."), /No matching documents\./);
});
