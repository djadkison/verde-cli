import test from "node:test";
import assert from "node:assert/strict";
import { documentsOf, documentOf, writtenMemory, vaultRef } from "../src/wire.js";

const ID = "3f4a1b2c-1111-4222-8333-444455556666";

test("a single-id get comes back flat, not wrapped", () => {
  // This is the shape that broke every pre-read command before it was pinned
  // down: get_memory returns the document itself for one id.
  const doc = documentOf({ id: ID, title: "One" });
  assert.equal(doc?.title, "One");
});

test("a batch get comes back under `documents`", () => {
  const docs = documentsOf({ requested: 2, returned: 2, documents: [{ id: ID }, { id: ID }] });
  assert.equal(docs.length, 2);
});

test("a missing document yields nothing rather than an empty object", () => {
  assert.deepEqual(documentsOf({}), []);
  assert.equal(documentOf({}), undefined);
});

test("a batch that returned fewer than requested is still readable", () => {
  const result = { requested: 3, returned: 1, documents: [{ id: ID }] };
  assert.equal(documentsOf(result).length, 1);
  assert.equal(result.requested - result.returned, 2);
});

test("supersede answers with new_memory where the others answer with memory", () => {
  assert.equal(writtenMemory({ result: "ok", memory: { title: "Updated" } })?.title, "Updated");
  assert.equal(
    writtenMemory({ result: "ok", new_memory: { title: "Replacement" }, old_memory: { title: "Old" } })?.title,
    "Replacement",
  );
  assert.equal(writtenMemory({}), undefined);
});

test("vault refs are qualified once, never twice", () => {
  // The server already sends "team/vault"; prefixing unconditionally would
  // produce "team/team/vault".
  assert.equal(vaultRef("acme", "acme/kb"), "acme/kb");
  assert.equal(vaultRef("acme", "kb"), "acme/kb");
  assert.equal(vaultRef(undefined, "kb"), "kb");
  assert.equal(vaultRef("acme", undefined), "acme");
});
