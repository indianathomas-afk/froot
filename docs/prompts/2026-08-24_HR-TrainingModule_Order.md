# TrainingModule display order · Session Prompt (audit → STOP → execute)

**TIER:** 3 — new schema column + an endpoint that writes rows. Do not re-declare downward.
**Branch:** `staging`
**Shape:** Phase 0 audits and plans, then STOPS. Gary approves and rules in chat. The SAME
session then runs Phases 1–3. One file, one session.

---

## 0 · House rules

Repo root `~/Claude_Projects/Froot/froot` (lowercase). `CLAUDE.md`, `docs/WORKFLOW.md`,
`docs/MIGRATIONS.md` apply. No `&&` chains. Parenthesised subshells.
`|| echo "*** NO MATCH ***"` on searches. Additive-only schema. Preserve-and-mark roadmap.
Two-commit pattern. `npm run build` green before every commit; scoped `npx eslint` on
touched files (no bare `npm run lint` — DEBT-33). Every DB figure names its branch via the
`ep-` host. Secrets never printed. Deviation/row numbers are read from the highest existing
id in `docs/ROADMAP.yaml`, never assigned. **Claude never pushes.**

Opening command:

```bash
(cd ~/Claude_Projects/Froot/froot || { echo "*** CD FAILED ***"; exit 1; }
 echo "=== branch/head ==="; git branch --show-current; git log --oneline -1
 echo "=== level with main? ==="; git rev-list --left-right --count main...staging
 echo "=== clean? ==="; git status --short
 echo "=== TrainingModule today ==="; sed -n '/model TrainingModule {/,/^}/p' prisma/schema.prisma
 echo "=== row already filed? ==="; grep -n -i "module order\|orderIndex" docs/ROADMAP.yaml || echo "*** NO MATCH ***"
 echo "=== highest ids ==="; grep -oE "id: (DEBT|BUG|HR)-[0-9]+" docs/ROADMAP.yaml | sort -t- -k2 -n | tail -5
 echo "=== every module read + its orderBy ==="
 grep -rn -A8 "trainingModule.findMany" src/ | grep -n "findMany\|orderBy" || echo "*** NO MATCH ***"
 echo "=== dnd pattern to copy ==="
 grep -n "DndContext\|SortableContext\|useSortable\|arrayMove" "src/app/(app)/hr/training/training-form.tsx" || echo "*** NO MATCH ***")
```

STOP if not on `staging`, if `staging` is behind `main`, if the tree is dirty, or if
`orderIndex` already exists on `TrainingModule`.

---

## 1 · The problem

Some modules are sequential — "Day 1 (Module 1 & 2)", "MODULE 3", "Part 1/2/3" — and
nothing stores that order, so every surface invents its own:

| Surface | Believed sort | Believed location |
|---|---|---|
| /hr/training list | createdAt asc | `api/hr/training/route.ts:65` |
| Assign dialog picker | title asc | `(app)/staff/[id]/page.tsx:496` |
| Staff-facing library | createdAt asc | `api/hr/training/library/route.ts:62` |
| Bulk assign | createdAt desc | `assignments/bulk/route.ts:225` |
| Export | createdAt asc | `api/hr/training/export/route.ts:37` |

Symptom: the Assign dialog leads with "Equipment: How to assemble a Crathco Bubbler"
while the list leads with Day 1.

**Fix:** `orderIndex Int @default(0)` on `TrainingModule`; ADMIN-only reorder endpoint;
drag handle on /hr/training copied from the lesson reorder in `training-form.tsx`
(`@dnd-kit`, already a dependency — no second approach); every surface above reads the
new order with tie-break `[{ orderIndex: "asc" }, { createdAt: "asc" }]`.

**Not this row:** no sequence enforcement (module N+1 locked until N is complete) — file
it as its own `planned` row with the open questions (mid-sequence reorder, trainer
override, whether a locked module still appears) and do not build it. No lesson
reordering (already works). No change to who sees or assigns a module.

---

## 2 · Phase 0 — audit and plan, then STOP

1. Re-verify the table with `file:line` from a fresh read. The grep in §0 is the source of
   truth — if it found a sixth read, it joins the table.
2. Confirm the org-scoping column name and the category column name on `TrainingModule`
   from the schema, not memory.
3. Write the plan: migration SQL; backfill SQL (seed from `createdAt asc` per org, which
   preserves what admins see today — say whether it lives in the migration or a script);
   endpoint route/payload/auth/transaction; archived-module handling; the drag UI and the
   `file:line` it copies; each surface's one-line edit.
4. **The ruling to surface, not decide:** is `orderIndex` GLOBAL across the org, or
   PER-CATEGORY (matching the category chips)? Give a lean and the consequence of each
   for a staff member assigned modules from two categories.
5. Triage anything out of scope: FIX NOW / RULING NOW / COMMENT / ROW, row last, counts.
6. Write the audit to `docs/prompts/2026-08-24_HR-TrainingModule_Order_AUDIT.md`.

**STOP. Return the plan. Wait.**

Gary will reply with: approval, the ruling (GLOBAL or PER_CATEGORY) **in his words**, and
approval of the backfill SQL. Then:

- Append his ruling verbatim to `docs/DECISIONS.md` as a dated entry matching the file's
  existing style. Do not reword it. This is the ratification — nothing below runs without it.
- Carry `RULING = GLOBAL` or `RULING = PER_CATEGORY` through every step below.

---

## 3 · Phase 1 — schema + backfill

Add `orderIndex Int @default(0)` to `model TrainingModule`. Hand-authored migration per
`docs/MIGRATIONS.md` (`migrate dev` is broken, P3018):

```sql
ALTER TABLE "TrainingModule" ADD COLUMN "orderIndex" INTEGER NOT NULL DEFAULT 0;
```

Backfill (partition by org for GLOBAL; by org AND category for PER_CATEGORY — use the
real column names from Phase 0):

```sql
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "TrainingModule"
)
UPDATE "TrainingModule" t SET "orderIndex" = ranked.rn FROM ranked WHERE t.id = ranked.id;
```

`npx prisma generate`. Apply to **`br-square-feather` (`ep-odd-rain`) only**. Prove it
with a query output that names the `ep-` host — `current_database()` does not count:

```sql
SELECT "orgId", "title", "orderIndex", "createdAt" FROM "TrainingModule"
ORDER BY "orgId", "orderIndex" LIMIT 40;
```

Build, eslint, commit: `feat(hr): TrainingModule.orderIndex — additive column + backfill`

---

## 4 · Phase 2 — endpoint + surfaces

`src/app/api/hr/training/reorder/route.ts`, `PATCH`:

- ADMIN only, using the same auth helper `api/hr/training/route.ts` uses on its write
  path. Everyone else 403.
- Body `{ ids: string[] }` (GLOBAL) or `{ category, ids }` (PER_CATEGORY), validated with
  the schema lib already used in that folder.
- One `findMany` scoped to the caller's org (and category). If `found.length !==
  ids.length` → 400, write nothing. Whole request rejected.
- One `$transaction` setting `orderIndex = position`. Return the new list.
- Archived/inactive: client sends active ids only; archived rows keep their index and
  fall to the bottom via the tie-break (unless Phase 0 ruled otherwise).

Then change **every** `orderBy` from the Phase 0 table to
`[{ orderIndex: "asc" }, { createdAt: "asc" }]` (PER_CATEGORY: prefix
`{ category: "asc" }` on the staff-facing merged surfaces). If the Assign dialog sorts
client-side over data the API now sorts, delete the client sort. Both-reads-or-neither —
re-run the §0 grep; every `orderBy` shows `orderIndex`.

Build, eslint, commit: `feat(hr): training module reorder endpoint; all reads honor orderIndex`

---

## 5 · Phase 3 — drag handle

Copy `training-form.tsx`'s lesson reorder exactly: same sensors, contexts, handle icon.
ADMIN-only (same gate as the page's create/edit buttons). Optimistic reorder → `PATCH` →
revert with the page's existing toast on failure.

Chips: GLOBAL → handle disabled while any chip filter is active, tooltip "Clear filter to
reorder". PER_CATEGORY → enabled only with exactly one chip active; request carries it.
No new dependency.

Build, eslint, commit: `feat(hr): drag-to-reorder training modules on /hr/training`

---

## 6 · Staging pass (after Gary deploys)

Precondition: `git rev-parse --short HEAD` equals the deployed staging SHA, both shown.
Check the `~staging` badge before every screenshot.

1. ADMIN `karson@keva.com`: drag three modules on /hr/training, reload, order persists.
2. ADMIN: Assign dialog picker shows the same order.
3. `tommy@keva.com`: staff-facing training surface shows the same order.
4. Bulk assign and export order confirmed once each.
5. MANAGER → `PATCH /api/hr/training/reorder` returns 403.
6. ADMIN with one foreign/fabricated id → 400, DB order unchanged (re-run the §3 query,
   host named).

---

## 7 · Roadmap recorder commit

`docs/ROADMAP.yaml`, preserve-and-mark: this work's row → `staging`, three work SHAs,
notes prepended with date + ruling + backfill seed. Enforcement row present as `planned`.
FIX NOW / COMMENT items noted on the row, not as new rows (DEBT-84).

Commit: `docs(roadmap): TrainingModule order — staging; enforcement row filed not built`

---

## 8 · Report

Quoted DECISIONS.md entry · four SHAs · backfill proof with `ep-` host · §0 grep after
Phase 2 · six staging checks with role and evidence · any delta from the audit · a
`DEPLOY_LOG.md` heredoc for Gary to run before pushing. **No push command, even if asked.**
