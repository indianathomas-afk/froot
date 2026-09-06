# HR-32 — ADDENDUM to docs/prompts/HR-29.md — TIER 3

Gary's decisions, 2026-09-05, at the Phase 0 stop. `docs/prompts/HR-29.md` is
NOT edited — it is the record of what the session was handed, including the five
stale facts its Phase 0 caught. This file governs where the two differ.

`docs/prompts/HR-29_AUDIT.md` stands as written and is not edited either.

## 1 · The row is HR-32, not HR-29

HR-29 is taken (`ROADMAP.yaml:5565` — TrainingModule display order, shipped
2026-08-24, cited in-tree at `schema.prisma:2209`, `route.ts:65`,
`export/route.ts:37`; HR-30 and HR-31 depend on it by that id). HR-31 is the
highest plain integer, so HR-32 is next free — **confirm by reading the file.**

Gary, 2026-09-05: "It really doesn't matter, so call it HR-32 if that's easier."

**The ruling text is unaffected.** The `## 2026-09-05 — HR-29: …` heading in
HR-29.md §3 was written by planning chat, not by Gary. His ratified wording is
the block quote alone and contains no row id. Write the heading as:

`## 2026-09-05 — HR-32: linked document on a training lesson`

and reproduce the block quote **verbatim**, unchanged from §3. The
no-rewording instruction still binds. Print it back and get Gary's confirmation
before the docs commit lands.

## 2 · MANAGER sees the linked document

HR-26 moved MANAGER from preview mode to read mode on 2026-08-12, so §5c's "a
manager previewing a module" tier no longer exists. Gate on `role !== "STORE"`,
mirroring `filesServed` at `preview/page.tsx:74`. Adopt the audit's
recommendation.

## 3 · STORE suppression is scoped to browsing, not to assigned training

Ruled by Gary, 2026-09-05, confirming the audit's recommendation:

> STORE suppression applies to browsing the training library (read mode), not to
> a person's own assigned training. A trainee working through the module assigned
> to them sees the linked document regardless of their login's role.

This follows the ratified ruling's own words — "anyone assigned the module" —
and read mode is precisely the mode with no assignment. Do **not** apply a
role test on `/my/training`; that page is role-blind (`auth.ts:178`) and
suppressing there would remove the I-9 from the surface this row exists to serve.

## 4 · One approved rider: `duplicate()` error handling

`training-client.tsx:551` ignores the response from `duplicate()`. This row makes
a 400 newly reachable there (the new org/kind/isActive validation in §5b), so the
hazard is one this row creates. Gary, 2026-09-05: "Fix it now."

Fix inline, ~3 lines, in the Phase 2 commit alongside the validation that makes
it reachable. This is the **only** rider. Nothing else joins it.

## 5 · Carried unchanged from the audit's recommendations

- **JSON export** joins `title` + `externalUrl` rather than emitting a bare cuid
  (`export/route.ts:33-34` says ids never travel; mirror the resources precedent).
- **§5d is two forms, not one** — `training-form.tsx:708` and `:923` both render
  the Video URL field. Both get the select.
- **The renderer block is gated on a required prop**, matching the post-HR-25
  pattern at `:218-246`, not on a mode conditional. Stronger remedy, already in
  the file.
- **PERM-7 validation** is already closed on both write paths (`route.ts:116-126`,
  `[id]/route.ts:90-99`). Copy that precedent for the new FK check rather than
  inventing a second shape.

## 6 · Not adopted

`docs/guide/hr-documents.md:54` (Links accept file uploads — they have no file)
stays a COMMENT and gets its own roadmap row. It is a real defect in live guide
copy about the feature this row touches, but it is documentation, not code, and
folding it in would make two riders.
