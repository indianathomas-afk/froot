Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-23.md and follow it.

# BUG-23 — Template Delete returns 500 on templates with history

**TIER 2** (contained API + UI change, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files this session touches (no `git add -A`).
Gate: `git log --oneline -1` on staging must be `a9ee8fb` (level with main). If it isn't, STOP and report.

## The bug (filed in `6155ada`, found in the TPL-3 audit, not yet reproduced in a browser)
`DELETE /api/templates/[id]` (`/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/templates/[id]/route.ts`) calls `prisma.template.delete` with no pre-check and no try/catch. `Checklist_templateId_fkey` and `TaskLog_taskId_fkey` are `ON DELETE RESTRICT`, so deleting any template that has ever generated a checklist throws a 500. The form shows "Failed to delete template. Please try again.", and every retry fails the same way.

## Draft rulings (Gary ratifies at PRE-PUSH-CHECK)
- **R1:** A template "has history" if anything RESTRICT-references it or its tasks.
- **R2:** On a template with history, the edit page shows **Archive** in place of **Delete**, with a confirm dialog ("Archive this template? It stops generating new checklists. Past checklists are kept."). Archive uses the existing `PATCH { isArchived: true }` path. Delete never quietly archives.
- **R3:** A template with no history still hard-deletes, as it does today.
- **R4:** The route is the real gate, not the button. If DELETE is called on a template with history (stale tab, direct call), it returns **409** with `{ error: "This template has checklist history — archive it instead." }`. The form shows that text. It also catches Prisma `P2003` around the delete and returns the same 409, so a missed FK can never 500 again.

## Brief audit (report in a few lines each, no stop unless a plan-changer below fires)
1. **Every FK that blocks deleting a Template or its Tasks.** Read them from `prisma/schema.prisma` and the migration SQL, not from memory. Expect at least `Checklist.templateId` and `TaskLog.taskId`. Check for CAL-2 template-backed calendar events, `TemplateStoreAssignment`, task attachments, and anything else. For each one, note RESTRICT, CASCADE or SET NULL. The history check covers every RESTRICT path.
2. **Archive must be a real substitute.** Confirm an archived template generates no new checklists: the daily materialise path and the CAL-2 calendar path. Confirm it disappears from the store-view picker and the schedulable-templates list.
   **Plan-changer:** if archived templates still generate checklists anywhere, STOP and report before building.
3. Where the edit page loads its data, so `hasHistory` can be computed server-side in the same load, with one cheap `exists`-style query per RESTRICT path.

## Build
1. Add a shared helper, `templateHasHistory(templateId)`, near the templates API, covering every RESTRICT path from audit item 1.
2. DELETE route: run the helper first and return 409 per R4 if it finds history. Wrap the delete in try/catch, mapping `P2003` → 409 and leaving anything else as 500 with the existing log line.
3. Edit page and form: pass `hasHistory`. If true, render Archive (with the confirm dialog) in place of Delete; on success, go to `/templates`. If false, keep Delete unchanged. Surface the route's error text on a 409.
4. Fixture `/Users/garythomas/Claude_Projects/Froot/froot/scripts/verify-bug23.ts`, run against dev:
   - a template with no history deletes → 200, row gone;
   - a template with a Checklist → helper true, DELETE 409 with the exact message, row intact;
   - a template whose only history is a TaskLog on a retired task → helper true, 409;
   - archiving a template with history succeeds, and that template is excluded from the next materialise query.

## Commits
Make a work commit and a docs commit. The docs commit carries the BUG-23 row (from `planned` to `in_progress`, nothing deleted), a DECISIONS.md draft of R1–R4 for Gary to ratify, and an UNPROMOTED DEPLOY_LOG entry kept short. Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW. Report the prisma commands run (verbatim; `npm run build` runs `prisma generate`), both SHAs, and `git log --oneline @{u}..`.

## Staging test (Gary, after PRE-PUSH-CHECK and push)
1. Open a template that has run checklists. The button reads **Archive**, the confirm dialog appears, and it lands on /templates with the template under Archived.
2. Create a throwaway template and save it without running it. The button reads **Delete**, and it deletes.
3. Optional: open the same history template in two tabs, archive it in one, then try anything in the other. No raw 500 should appear.
