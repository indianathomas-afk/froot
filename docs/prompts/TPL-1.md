Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TPL-1.md and follow it.

# TPL-1 — Deleted template tasks silently survive Save

**TIER 3** (schema: one additive nullable column). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files this session touches (no `git add -A`).
Phase id: confirm `TPL-1` is free in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` by reading the file. If it is taken, use the next free id and say so.

## The bug (reported by Gary, production, Opener Checklist)
On `/templates/[id]/edit`, Gary deleted tasks 48, 49 and 50 and clicked Save Template. The page saved, but the tasks were still there.

Root cause, read from `main` (re-read on staging and confirm before acting):
`/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/templates/[id]/route.ts` PATCH computes `idsToDelete`, then drops every id that has a `TaskLog` row (the RESTRICT FK) into `blockedIds`. Those tasks are left in place, and the route still returns 200. Any task a store has ever completed can never be deleted, and nothing says so. Daily templates hit this on every task.

Second defect on the same path:
`/Users/garythomas/Claude_Projects/Froot/froot/src/app/(app)/templates/template-form.tsx` `handleSave` maps pending attachments with `savedTemplate.tasks[idx]`. The response's `include: { tasks }` has no `orderBy` and contains the blocked tasks, so a new task's attachment can land on the wrong task.

## Draft rulings (Gary ratifies at PRE-PUSH-CHECK)
- **F1:** Add `Task.retiredAt DateTime?`. A deleted task with TaskLog history gets `retiredAt = now()` instead of being skipped. A deleted task with no history is still hard-deleted.
- **F2:** Retired tasks are excluded from every template read and every checklist generated after the save. Completed history (TaskLog, reports, past checklists) still resolves the retired task by id and displays it.
- **F3:** The PATCH response reports `retiredCount` and `deletedCount`. The form shows one line after save ("3 tasks retired — completion history kept") before redirecting, or as a flash on `/templates`, whichever the code makes simplest.
- Filter with `retiredAt: null`. Never use a `not: true` boolean form (that form silently drops NULL rows).

## Phase 1 — Audit (read-only), then STOP
Report each item in a few lines:
1. Confirm the root cause on staging (quote the blockedIds block).
2. List **every** read of `Task` / `template.tasks` in the repo: template GET routes, edit page loader, view page, duplicate, import/export, checklist generation/materialise cron, calendar-generated checklists, Operations Report, search, anything else. For each one, state whether it must filter `retiredAt: null` or must still see retired tasks (history readers).
3. Answer F2 concretely: do open checklists read template tasks live, or do they snapshot at generation? This decides whether retiring removes a task from today's open checklist.
4. Re-read the template-form "unsaved changes" / `saveBlockers` logic (it may differ from main) and confirm the F3 message fits it.

**STOP. Wait for Gary's go.**

## Phase 2 — Build
1. Schema: add `retiredAt DateTime?` to `Task`. Generate the migration with `prisma migrate diff` only.
   **STOP after the migration file is generated.** Gary applies it to dev with `npx prisma migrate deploy` and says go. Do not run the fixture or commit until then.
2. PATCH route: split `idsToDelete` into hard-delete (no TaskLog) and retire (has TaskLog, `updateMany` setting `retiredAt`), both inside the existing transaction. Order the response's tasks by `orderIndex` and filter them to `retiredAt: null`. Return `retiredCount` / `deletedCount`.
3. Apply the `retiredAt: null` filter to every live reader from audit item 2.
4. Form: match pending attachments by `orderIndex` (new tasks are sent with `orderIndex: i`), not by array position. Show the F3 line.
5. Fixture `scripts/verify-tpl1.ts`: a template with a task that has a TaskLog and a task that has none. Remove both and save. Assert the logged task is retired (row exists, `retiredAt` set, absent from the template read and from a freshly generated checklist, its TaskLog intact) and the unlogged task is gone. Also assert that an added task with an attachment lands on the right task id.

## Commits
Make a work commit and a docs commit (ROADMAP row and DECISIONS.md draft of F1–F3 for Gary to ratify). Out-of-scope findings are classified FIX NOW / RULING NOW / COMMENT / ROW before the report. Report the prisma commands run, verbatim, along with both SHAs.

## Staging test (Gary, after push)
On staging, edit a daily template that has history and delete 3 tasks. Save, then reopen: the 3 tasks should be gone and the retired note shown. Run the next checklist materialise and confirm they're absent. Open an old completed checklist and confirm they still show.
