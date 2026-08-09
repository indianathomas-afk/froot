# CHK-1 (S1) — SECTIONS BECOME A FIRST-CLASS ENTITY, WITH AN AS-EXECUTED RECORD

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S1 of the approved CHK phase. The plan is **already approved in full** —
Gary's ruling 2026-08-09, recorded in `docs/prompts/CHK-1_PLAN.md` §0-RULING,
board rows filed in `3ec9bc8`. This session **executes S1 per the approved
plan**; it does not redesign it. The plan artifact and
`docs/prompts/CHK-1_SESSION_SKELETONS.md` (S1 block) are the brief. Read both
in full before touching anything. The CHK-1 row in `docs/ROADMAP.yaml`
carries the ships / proves / must-not-touch summary.

Ruled parameters that bind this session (do not reopen):
- Snapshot scope: **names only**, frozen on **first task log**
  (`Checklist.sectionsSnapshot` JSONB).
- Historical `TaskLog` rows: backfill `sectionId`, **fabricate no names**.
- `Task.sectionName` stays as a legacy mirror — written alongside
  `sectionId`, retired by a later row only after the backfill is proven.
- Migration A ships exactly as approved (SQL verbatim in the plan §2.1),
  additive-only, idempotent, dev-first on Gary's side.
- Section ids are generated **per branch** — never pasted across
  (the TPL-1a note, recorded in the migration comments).
- `preview/main` (`br-purple-rain`) is a **fossil** — do not query it, do
  not treat any result from it as evidence (plan §0a).

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd                        # must end .../Froot/froot
git branch --show-current  # staging
git status --short         # clean
git fetch origin           # then confirm level with origin/staging
git rev-parse HEAD         # expected 3ec9bc8 or a descendant
```

STOP on any failure. Never push.

## STEP 1 — RE-VERIFY THE PLAN'S S1 ASSUMPTIONS AT HEAD

The plan was written at `552a5e7`; HEAD has moved (docs-only since, but
verify rather than assume). Re-measure, do not cite:

- The five S1 read sites the plan names (section rendering / grouping
  sites) — confirm each file:line still holds; TYPE-1's line-drift lesson
  applies.
- `template-form.tsx` section handling (free-text + adjacency ordering at
  the lines the plan cites) — confirm shape.
- Checklist creation path (`api/checklists/route.ts`) — confirm it still
  snapshots nothing and stores only ids.
- CSV export/import of templates — confirm the section column shape the
  plan's by-name design assumes.

If any assumption no longer holds, that is a finding: STOP and report
before editing. If all hold, proceed — no approval round-trip is needed;
the plan is the approval.

## STEP 2 — EXECUTE PER THE PLAN'S S1 SECTION

In summary (the plan artifact governs where this summary is thinner):

1. **Schema + Migration A** — `Section` entity, `Task.sectionId`,
   `TaskLog.sectionId`, `Checklist.sectionsSnapshot`, indexes, FKs, and the
   data migration (seed sections from distinct `(templateId, sectionName)`
   with `sortOrder` recovered from `MIN(orderIndex)`; backfill `Task` then
   `TaskLog`). SQL exactly as approved. Hand-authored migration file,
   committed; **never run by you** — Gary runs it dev-first, staging and
   production receive it via `migrate deploy` on push/promotion.
2. **Write paths** — sections created/renamed/reordered as entities from
   the template form; `sectionName` mirror maintained on every write;
   org/template scoping verified on every route touched.
3. **Read sites** — the five rendering sites move to the entity (name via
   join, order via `sortOrder`), with the string as fallback only for
   unmigrated data. The non-contiguous-tasks double-heading defect ends
   here (one heading per section).
4. **As-executed snapshot** — on first task log for a checklist, freeze the
   section names (`sectionsSnapshot`). Print and any completed-checklist
   render read the snapshot when present, live data when not (pre-phase
   rows).
5. **CSV** — export/import sections **by name** per the plan; import
   creates missing sections per template; existing exported files stay
   import-valid.

**MUST NOT TOUCH** (from the CHK-1 row): checklist `status` values,
generation, `StoreHours`, offsets and their copy, anything cron. The
offset fields in `template-form.tsx` are DEBT-59's — the section work is in
the same file; the offset regions and both DEBT-59 comment blocks must not
change (diff-prove it, the TPL-2 pattern: `git diff` scoped to those
regions returns empty).

## STEP 3 — COMMITS AND GATES

Two-commit pattern:
- **Commit 1 — code + migration file.** Gate: scoped eslint (no pipes) +
  `npm run build`.
- **Commit 2 — docs.** CHK-1 row → `in_progress` with commit 1's short SHA
  quoted; the DEBT-36 rider gains a dated line that the entity work is now
  in flight. Gate: `npm run build`.

Committed, **NOT pushed**.

## STEP 4 — REPORT (structure it so Gary's run order is explicit)

1. SHAs; what Step 1 re-verification found vs. the plan.
2. The migration SQL verbatim with Gary's run instructions:
   dev first (`npx prisma db execute --file ...` then
   `npx prisma migrate resolve --applied ...` from the repo root — note
   the lowercase `froot` directory trap), then the per-branch verification
   query from the plan §2.1 (expect `unlinked_tasks = 0`; three live
   branches only), then push, then staging query, then browser pass.
3. The browser verification checklist for Gary on staging, including:
   - Section create / rename / reorder round-trips in the template form.
   - **DEBT-36's trigger fired deliberately**: complete (or use an
     existing completed) checklist, rename a section on its template,
     confirm the print/completed view shows the **old** name (snapshot)
     while the template shows the new — the rename-rewrites-history defect
     is dead. For pre-phase completed checklists (no snapshot), state
     plainly that they still show live names, and that this is the
     recorded limitation, not a bug.
   - Non-contiguous section renders **one** heading.
   - **DEBT-59 nine-check re-run** (form file touched): blank offsets
     survive create/save/edit/clear; clearing gives blank not 0;
     unrelated edits don't invent values; export/import round-trips
     blanks.
   - Org id + Clerk instance named on the same line as every observation
     (§ Browser Evidence — the TPL-2 rider gap does not recur).
4. Triage: FIX NOW / RULING NOW / COMMENT / ROW. **RULING NOW stops the
   session** — propose, don't proceed. Report counts.

## HOUSE RULES

Everything in `CLAUDE.md`; never push; additive-only schema; `npm run
lint` is not a gate (DEBT-33); short SHAs quoted in YAML; exclude
`src/generated/` from greps and verify hits by reading; do not touch
`../froot_docs/`; audit-artifact rule applies if this session ends
audit-only.
