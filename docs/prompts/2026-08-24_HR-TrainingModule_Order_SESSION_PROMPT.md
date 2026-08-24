# TrainingModule display order — and the surfaces that must honor it · Session Prompt

**Module:** HR / Training
**TIER:** 3 — schema change (new column) + an endpoint that writes rows. Do not re-declare downward.
**Branch:** `staging`
**Builds on:** HR-20/21/22 (training track, on main), HR-28 (rich-text descriptions, on staging)
**Session type:** Single Claude Code session. Phase 0 is audit-and-plan, then STOP for approval. Phases 1–3 run only after Gary approves the plan in planning chat.

AUDIT AND PLAN FIRST. STOP. Do not create or edit any source file before approval.

---

## 0 · Where you are

- Repo root is `~/Claude_Projects/Froot/froot` (lowercase). The capital-F parent is
  not the git root. Work on `staging`.
- House rules: `CLAUDE.md`, `docs/WORKFLOW.md`, `docs/MIGRATIONS.md`. Evidence absolute.
  No `&&` chains in pasteable blocks. Parenthesised subshells, `|| echo "*** NO MATCH ***"`
  on searches, `|| { echo "*** CD FAILED ***"; exit 1; }` on the opening cd.
  Additive-only schema. Preserve-and-mark on the roadmap. Two-commit pattern.
  Claude never pushes. Secrets are never printed.
- Deviation numbers are read from the highest recorded entry in `docs/ROADMAP.yaml`,
  never assigned here.

Opening command:

```bash
(cd ~/Claude_Projects/Froot/froot || { echo "*** CD FAILED ***"; exit 1; }
 echo "=== branch/head ==="; git branch --show-current; git log --oneline -1
 echo "=== level with main? ==="; git rev-list --left-right --count main...staging
 echo "=== does TrainingModule already have an order column? ==="
 sed -n '/model TrainingModule {/,/^}/p' prisma/schema.prisma
 echo "=== is a row already filed? ==="
 grep -n "TrainingModule.orderIndex\|training module order\|module order" docs/ROADMAP.yaml || echo "*** NO MATCH ***"
 echo "=== highest ROADMAP ids (for any new row) ==="
 grep -oE "id: (DEBT|BUG|HR)-[0-9]+" docs/ROADMAP.yaml | sort -t- -k2 -n | tail -5 || echo "*** NO MATCH ***"
 echo "=== existing dnd-kit usages (the pattern to copy) ==="
 grep -rln "@dnd-kit" src/ || echo "*** NO MATCH ***")
```

If `staging` is behind `main`, STOP and say so before anything else.

---

## 1 · Why this is TIER 3 and not TIER 2

It was scoped as "minor UI updates". It is not, and the reason is in `CLAUDE.md`
§ Session Tiers: `TrainingModule` has NO ordering column, so a persisted drag order
needs a new column — "a schema change is TIER 3 by definition" — and the reorder
itself writes rows, which is TIER 2's own named escalation trigger. Ambiguity
resolves upward. Do not re-declare downward.

---

## 2 · The problem, as observed

Certain modules are inherently sequential — "Day 1 (Module 1 & 2)", "MODULE 3",
"MODULE 4", "Part 1/2/3". Nothing in the product expresses that order, so every
surface invents its own. Verify each of these on staging and report `file:line`
from a fresh read, not from this table:

| Surface | Believed sort | Believed location |
|---|---|---|
| /hr/training list | createdAt asc | `api/hr/training/route.ts:65` |
| Assign dialog picker | title asc | `(app)/staff/[id]/page.tsx:496` |
| Staff-facing library | createdAt asc | `api/hr/training/library/route.ts:62` |
| Bulk assign | createdAt desc | `assignments/bulk/route.ts:225` |
| Export | createdAt asc | `api/hr/training/export/route.ts:37` |

Four different sorts across five surfaces and none is teaching order. The visible
symptom: the Assign dialog leads with "Equipment: How to assemble a Crathco
Bubbler" (alphabetical) while the list leads with the Day 1 modules.

Also sweep for a SIXTH surface the table missed. Grep every `findMany` on
`trainingModule` and every `orderBy` near it:

```bash
(cd ~/Claude_Projects/Froot/froot || { echo "*** CD FAILED ***"; exit 1; }
 grep -rn "trainingModule.findMany\|trainingModule\.findMany" src/ || echo "*** NO MATCH ***"
 echo "=== orderBy within 8 lines of each ==="
 grep -rn -A8 "trainingModule.findMany" src/ | grep -n "orderBy" || echo "*** NO MATCH ***")
```

Any surface not in the table goes in the plan with the same treatment.

---

## 3 · What to build (after approval)

An `orderIndex` on `TrainingModule`, a drag handle on /hr/training, and every
consuming surface reading that order.

- **Schema:** `orderIndex Int @default(0)` on `TrainingModule`. Additive.
  Hand-authored migration per `docs/MIGRATIONS.md` (`migrate dev` is broken, P3018).
  PROPOSE A BACKFILL: every existing row defaults to 0, so with no backfill the
  list has one tie broken arbitrarily. Say what you would seed it from
  (`createdAt asc` is the current /hr/training order and preserves what admins see
  today) and whether it belongs in the migration or a one-off script. The backfill
  SQL is shown in the plan and is not run until Gary approves it — Neon is the
  source of truth and mutation needs SQL approval.
- **Reorder endpoint:** ADMIN-only, org-scoped, accepts the full ordered id list and
  writes indices in one transaction. Reject any id outside the org — and reject the
  whole request, not just the foreign id. Say what happens to archived/inactive
  modules: are they in the list the client sends, do they keep an index, do they
  sort to the bottom.
- **/hr/training list:** drag handle. REUSE THE EXISTING PATTERN — `@dnd-kit` is
  already a dependency and is already used for exactly this in
  `(app)/hr/training/training-form.tsx` (lesson reorder),
  `templates/template-form.tsx` and `inventory/storage-areas/by-area-view.tsx`.
  Do not introduce a second approach; read `training-form.tsx` first and follow it.
  Say whether the drag handle is hidden or disabled while a category chip filter
  is active (see the ruling below — this depends on it).
- **Every surface** in §2's table (plus any found by the sweep) reads the new order,
  with a deterministic tie-break (`orderIndex asc, createdAt asc`).

### The design question you must ANSWER IN THE PLAN, not decide silently

The list is filtered by category chips (New Hire Training, Manager Training,
Equipment & Procedures…). Is `orderIndex` GLOBAL across the org, or PER-CATEGORY?
Global is simpler and survives a module changing category; per-category matches
how the chips present the library. Give a lean and the consequence of each for a
staff member assigned modules from two categories. This is a ruling — surface it,
do not pick it in code. RULING NOW stops the session; it is ratified only once
written into `docs/DECISIONS.md` in Gary's words.

---

## 4 · Explicitly NOT this row

- **NO SEQUENCE ENFORCEMENT.** Sorting makes the order visible and consistent; it
  does not stop a trainee opening Module 5 first. "Staff must COMPLETE module N
  before N+1 unlocks" is a different feature with its own rules (what happens to
  someone mid-sequence when order changes, does a trainer override exist, does a
  locked module still appear). FILE IT AS ITS OWN ROW, scoped, and do not build it.
- No reordering of LESSONS — that already works (`TrainingLesson.orderIndex`).
- No change to who may see or assign a module.
- No change to category membership or the chip set.

---

## 5 · Phase 0 — audit and plan, then STOP

Re-verify §2 with `file:line` on staging, plus the findMany sweep. Then produce a
plan covering:

1. The migration SQL and the backfill (where it lives, what it seeds from).
2. The reorder endpoint's route, payload shape, authorization check, transaction
   shape, and archived-module handling.
3. The drag UI and which existing implementation it copies (`file:line` of the
   pattern being copied).
4. Each consuming surface and its one-line edit.
5. The global-vs-per-category ruling, with a lean and the two-category-staffer
   consequence for each.
6. The enforcement row you are filing but not building — title, scope, open
   questions — using the next free id from the opening command.

Then triage anything out of scope: FIX NOW / RULING NOW / COMMENT / ROW, row last,
with counts. RULING NOW stops the session.

Write the audit to `docs/prompts/<date>_HR-TrainingModule_Order_AUDIT.md` per
`CLAUDE.md` § Where documents live. It is a claim wholesale and is not edited after.

**STOP. Return the plan. Do not proceed without approval.**

---

## 6 · Phases 1–3 (after approval only)

- **Phase 1 — schema + backfill.** Migration file, Prisma client regenerated,
  backfill applied to `br-square-feather` only after Gary approves the SQL. Prove
  the backfill with a query whose output names the `ep-` host; `current_database()`
  does not count.
- **Phase 2 — endpoint + surfaces.** Reorder route, then every `orderBy` in §2.
  Both-reads-or-neither: no surface is left on the old sort.
- **Phase 3 — drag UI.** Copy the `training-form.tsx` pattern.

Commits: one work commit per phase is acceptable; the roadmap recorder commit is
always separate and last. Commits on `staging`, never `main`. No push.

---

## 7 · Gates

- `npm run build` green before every commit; scoped `npx eslint` over the files
  each commit touches (no bare `npm run lint` — DEBT-33).
- Staging-SHA precondition before ANY staging observation: deployed SHA equals
  local HEAD, two commands, shown. Check the `~staging` badge in the page corner
  before recording any browser evidence.
- Staging pass as ADMIN (`karson@keva.com`): reorder three modules, then confirm the
  new order on /hr/training AND in the assign dialog AND, signed in as
  `tommy@keva.com`, on the staff member's own surface — the POSITIVE check under
  each role, not just that the list looks right to an admin.
- Negative check: as MANAGER, the reorder endpoint returns 403; a request carrying
  an id from another org is rejected whole.
- Name the branch on every DB figure; the `ep-` host proves it.

---

## 8 · Report

Back to planning chat: what was built, each gate's evidence, the DECISIONS.md entry
that ratified the ruling (quoted), the enforcement row's id, the triage counts, and
the DEPLOY_LOG heredoc for Gary to run before pushing. No push command anywhere in
the report.
