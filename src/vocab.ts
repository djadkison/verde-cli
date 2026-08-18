/**
 * Mirrors src/lib/vocab.ts in the Verde server. Duplicated deliberately: the
 * CLI ships independently, so it validates against the vocabulary it was built
 * for and lets the server reject anything newer with its own message.
 */
export const MEMORY_TYPES = [
  "fact",
  "decision",
  "policy",
  "procedure",
  "preference",
  "project",
  "person_role",
  "event",
  "working_note",
  "rejected_approach",
  "lesson_learned",
] as const;

export const MEMORY_STATUSES = ["draft", "published", "superseded", "archived"] as const;

export const VISIBILITIES = ["public", "company", "private"] as const;

export const DISPLAYS = ["note", "canvas"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type Visibility = (typeof VISIBILITIES)[number];
