# DEBT-TRIAGE-2 — relocate the record halves, add the cost line

> Session prompt, saved verbatim as received on 2026-08-02 before any work began.
>
> **NOTE ON COMPLETENESS:** the prompt as delivered is truncated mid-sentence in
> PART B ("Three the audit flagged as LIVE ... DEBT-13 (a manager's roster").
> Everything after that point was not received. Recorded here as-is; the missing
> tail was raised with Gary at the start of the session rather than guessed at.

---

NEW SESSION — DEBT-TRIAGE-2: relocate the record halves out of the
debt list, and give every surviving open row a COST OF DOING
NOTHING line. Docs and code comments only. No behaviour change, no
schema change, no migrations, NO DATABASE ACCESS.

Save this prompt to docs/prompts/DEBT-TRIAGE-2_relocations.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: docs/prompts/DEBT-TRIAGE_records_vs_
tasks.md — the audit this session executes, and the source of every
destination and every cost line below; rows DEBT-9, 19, 33, 35, 36,
39, 41, 44 IN FULL; CLAUDE.md; docs/MIGRATIONS.md; docs/DECISIONS.md;
src/lib/roadmap.ts; prisma/schema.prisma.

WHY THIS SESSION EXISTS, and it is not "shorten the list". I need
to tell BROKEN THINGS apart from HISTORY. Both belong in the repo;
only one determines what I work on next. Right now they are
interleaved in one list under one heading and I cannot read a
priority off it. Two changes fix that: move the records to where
they fire, and make every remaining row say what happens if it is
never touched.

────────────────────────────────────────────────────────────────
PART A — RELOCATE THE RECORDS
────────────────────────────────────────────────────────────────
Destinations are the triage audit's, not mine. Re-verify each
target file and section exists at HEAD before writing; report
drift rather than improvising a location.

CLOSES BY RELOCATION (2 rows):
- DEBT-19 → CLAUDE.md § Database Evidence, as a PRECONDITION
  alongside the branch-label rule. The row argues it is the same
  failure one layer down; splitting one idea across two sections
  is how it stops firing. The staging-org CLEANUP folds into
  DEBT-44 (same branch, same org, and 44 already carries the
  cascade analysis the cleanup needs). Row closes.
- DEBT-35 → docs/MIGRATIONS.md §2, which ALREADY carries a ⚠️
  callout of exactly this shape (re-append the partial indexes)
  and a "Hazard 1 — the baseline squash silently drops them"
  section. This is Hazard 3 in a file that already has the
  pattern. Row closes.

SHRINK TO THEIR TASK HALF (record moves, row stays open):
- DEBT-9 → MIGRATIONS.md § Protected indexes, as Hazard 3 beside
  "Hazard 2 — the schema misinforms a reader": the partial index
  guarantees AT MOST one primary, not AT LEAST one; zero primaries
  stay legal and index nothing. Row keeps the chip-click task,
  which is mine.
- DEBT-33 → a comment atop src/components/hr/pdf-viewer.tsx: the
  HR-14 reading note. A roadmap row will never be read by someone
  opening that file. The commit-gate rule is ALREADY in CLAUDE.md
  § Commit Gates — verify, do not duplicate.
- DEBT-36 → a comment at prisma/schema.prisma, on TaskLog and/or
  Task.sectionName: renames rewrite history; there is no
  as-executed record of section names anywhere. That half is a
  COMPLIANCE FACT, not a design preference. The entity work stays
  in the row, AWAITING RULING.
- DEBT-39 → docs/DECISIONS.md, appended to the PERM-7 Task 7
  section: the reopening condition fires in the CLERK DASHBOARD,
  and nobody standing there reads ROADMAP.yaml. Row keeps the
  mirror-NAME task.
- DEBT-41 → one sentence on BlockerEntry, src/lib/roadmap.ts:
  never add `resolved: false`. That is where the person about to
  add it is standing. Row stays AWAITING RULING.
- DEBT-44 → the fixture-naming convention ("name test principals
  for the phase that made them") to CLAUDE.md § Staging
  Verification; the store-delete cascade hazard to a comment at
  handleDelete in src/app/(app)/stores/page.tsx. Row keeps the
  cleanup task and absorbs DEBT-19's.

RULES FOR EVERY RELOCATION:
- The row records WHERE its record went, in one line. A reader of
  the row must be able to follow it.
- Nothing is deleted from any row. The record text stays in the
  row AND lands at the destination — the row is the history, the
  destination is where it fires. If that feels like duplication,
  it is the same duplication CLAUDE.md § Commit Gates already has
  with DEBT-33, which is working.
- Where a destination already says the thing, DO NOT DUPLICATE.
  Report it and close the row's record half on that basis.

────────────────────────────────────────────────────────────────
PART B — THE COST LINE, and this is the half I care about most
────────────────────────────────────────────────────────────────
The triage audit produced a COST OF DOING NOTHING for all 22 rows
and it lives only in that session's transcript. Per DEBT-37's own
precedent — "an observation that lives only in a transcript does
not exist" — put it in the rows.

Add to EVERY open row, as a clearly-marked line near the top of
notes so it survives skimming:

  COST OF DOING NOTHING: <one sentence> — <LIVE | LATENT | NONE>

Use the audit's assessments. Re-verify any you doubt and say so.
LIVE means a user or operator is affected today. LATENT means it
bites on a named trigger. NONE means nothing observable, and NONE
IS A LEGITIMATE AND USEFUL ANSWER — say it where it is true rather
than inflating it. The audit found NONE for several rows; that is
the finding that makes the list readable.

Three the audit flagged as LIVE, which is the correction I most
need carried: DEBT-13 (a manager's roster

[PROMPT TRUNCATED HERE AS RECEIVED]
