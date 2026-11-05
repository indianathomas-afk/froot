# TPL-3 — Phase 1 audit: deleted template tasks silently survive Save

**TIER 3.** Session prompt: `docs/prompts/TPL-1.md` (saved under the id the prompt
proposed). Read-only phase. Taken on branch `staging` at `2e2f8b0`, which is level with
`origin/staging`. 2026-11-04.

## 0. Phase id

`TPL-1` is **taken**: `docs/ROADMAP.yaml:933` (template types, TPL-1a/1b). `TPL-2` is
also taken (`:1081`). The next free id is **`TPL-3`**. Nothing in `docs/`, `src/` or
`scripts/` mentions `TPL-3`. This phase uses `TPL-3` everywhere: the ROADMAP row, the
fixture name (`scripts/verify-tpl3.ts`, not `verify-tpl1.ts`), the migration name and the
DECISIONS entry.

## 1. Root cause, confirmed on staging

`src/app/api/templates/[id]/route.ts`, PATCH, in the `try` block:

```ts
// Tasks with completion history (TaskLog) can't be deleted (RESTRICT FK) — leave them in place.
const blockedIds = new Set(
  idsToDelete.length
    ? (await prisma.taskLog.findMany({ where: { taskId: { in: idsToDelete } }, select: { taskId: true }, distinct: ["taskId"] })).map((l) => l.taskId)
    : []
)
const safeToDelete = idsToDelete.filter((tid) => !blockedIds.has(tid))
```

`blockedIds` is never used again. Nothing reports it, and the route returns 200 with the
full template. `TaskLog.task` has no `onDelete`, so it defaults to Restrict. That means any
task a store has ever ticked cannot be deleted. **Confirmed.**

**The second defect differs on staging.** The response include already has
`orderBy: { orderIndex: "asc" }` (CHK-1 added it; its comment names the
`template-form.tsx` mapping). The ordering half of the defect is fixed on staging. The
other half is still live: the response includes the blocked tasks. Those tasks keep
their old `orderIndex`, while the incoming tasks are renumbered `0..n-1`. So a blocked
task sorts into the middle of the list and shifts every position after it. On staging,
`savedTemplate.tasks[idx]` can still put a new task's attachment on the wrong task, or on a
blocked task.

## 2. Every read of `Task` / `template.tasks`

Method: I searched for `prisma|tx .task.`, `tasks:` includes and selects, `task:` relation
selects, `.tasks.` consumers, raw `"Task"` SQL, and `_count`. Then I read each hit in
context and followed the client consumers back to their API. There is no raw SQL on
`Task`. No `_count` touches tasks.

### 2a. Template readers: must filter `retiredAt: null`

| # | Site | What it does |
|---|---|---|
| T1 | `api/templates/[id]/route.ts` PATCH: `existingTaskIds` findMany | Diff base. See ruling R2 for how an incoming retired id is handled. |
| T2 | `api/templates/[id]/route.ts` PATCH: response `include.tasks` | Feeds the form's attachment mapping. |
| T3 | `api/templates/route.ts:23` GET | `/templates` cards (task count, sort-by-tasks) **and Duplicate**. `templates-client.tsx:218` builds the copy from this list, so this one filter covers Duplicate. |
| T4 | `(app)/templates/[id]/edit/page.tsx:26` | The edit loader. If it isn't filtered, retired tasks reappear in the form. |
| T5 | `(app)/templates/[id]/page.tsx:21` | Template view page. |
| T6 | `print/template/[id]/page.tsx:20` | Template print. |
| T7 | `api/templates/export/route.ts:67` | CSV export. A re-import must not bring retired tasks back. |
| T8 | `api/stores/[id]/templates/route.ts:40` | Store-view template picker: `taskCount` and `estimatedMinutes`. |

`api/templates/route.ts:217` (the POST response) and `api/templates/import/route.ts:220`
(create) only touch brand-new tasks. No retired row can exist there, and no filter is
needed.

### 2b. Checklist readers: need a rule, not just `retiredAt: null`

These read `checklist.template.tasks` **live**. They are all governed by §3.

| # | Site | Use |
|---|---|---|
| C1 | `(app)/store-view/checklist/[id]/page.tsx:25` | Execution screen (open **and** completed checklists). |
| C2 | `print/checklist/[id]/page.tsx:36` | **The compliance print**, a history reader. |
| C3 | `api/checklists/route.ts:51` GET | `/checklists` list: `taskCount`, `estimatedMinutes`. |
| C4 | `api/dashboard/summary/route.ts:176` | Today's shift-checklist widget. |
| C5 | `api/checklists/[id]/submit/route.ts:20` | `completionRate` and critical-task status. |
| C6 | `api/cron/checklist-day-close/route.ts:252` | Day-close `completionRate` recompute. |
| C7 | `api/checklists/[id]/task-log/route.ts:18` | The ownership check: refuses a task "not on this checklist". |
| C8 | `api/upload/checklist-photo/route.ts:69` | The same ownership gate, before the blob write. |

### 2c. Readers that must still see retired tasks

| # | Site | Why |
|---|---|---|
| H1 | `api/templates/sections.ts:166` `pruneEmptySections` "holding" query | `Task.sectionId` is `onDelete: Restrict`. A section that holds only retired tasks **must not** be pruned, or the save throws. Leave it unfiltered. (The TaskLog "referenced" guard beside it would usually save it anyway.) |
| H2 | `api/checklists/[id]/task-log/route.ts:136` `task.findUnique` (sectionId) | Runs after C7 has passed. It is a by-id lookup. Leave it. |
| H3 | `api/upload/task-attachment/route.ts:26` and `[taskId]/route.ts:15` | By-id, org-scoped. Only the form calls them, for tasks it holds. Leave them. |
| H4 | `lib/milestones-db.ts:144,166`, milestone report and alerts | Count `TaskLog` rows, never Task lists. A retired task's completions must keep counting. Unaffected. |
| H5 | Operations Report / `/reports` | Read `Checklist.status` / `completionRate` only. There is no Task read. Unaffected. |

**Readers I checked and found to have no Task reads:** `cron/calendar-materialize`, POST
`/api/checklists` (it stores ids only, so creating a checklist reads no tasks),
`lib/search.ts`, `lib/calendar.ts`, `lib/reports.ts`, `/reports/operations`.

**Section side-effects.** A section left holding only retired tasks stays in the DB but is
invisible in the form. The form derives its sections from its tasks
(`sectionGroupsOf(tasks)`) and uses `initialData.sections` only as a name→id map.
`syncTemplateSections` never deletes. `groupTasksBySection` groups by tasks, so it never
renders an empty heading. If an operator later creates a section with the same name,
`syncTemplateSections` reuses the orphan by name. That is harmless, and arguably correct.
No change is needed.

Total: 8 template readers, 8 checklist readers, 5 history/by-id readers, and 6 sites
checked and empty.

## 3. F2: live or snapshot?

**Checklists read template tasks LIVE. There is no task snapshot.** `Checklist` stores
`templateId` and a `sectionsSnapshot` of headings only. The CHK-1 plan §2.4 deliberately
does not freeze task descriptions. Every surface in 2b joins `checklist.template.tasks` at
read time.

Consequences:

- **A filter of plain `retiredAt: null` on C1–C8 would remove the task from today's open
  checklist (F2 wants that). It would also remove it from every past completed checklist
  and its print. That breaks F2's second sentence.** History readers cannot use the same
  filter as template readers.
- History can still be reconstructed, because the retirement instant is known. A task was
  on a checklist if it was not retired before that checklist finished.

**Recommended rule (RULING R1).** Put it in one helper, `src/lib/checklist-tasks.ts`, used
by all of C1–C8. A task is on a checklist when any of these holds:

1. `retiredAt IS NULL`, or
2. it has a `TaskLog` on **this** checklist (a tick that already happened never vanishes,
   even on today's open checklist), or
3. the checklist is finished (`completedAt ?? closedAt` is not null) and
   `retiredAt > that instant` (the task was live while the checklist ran).

What this means in practice:

- **Today's open checklist:** retired tasks disappear on the next read, *unless* they were
  already ticked today. Those stay, ticked, and count toward the rate. Without rule 2, a
  completed tick would silently disappear mid-shift.
- **Past completed or missed checklists:** they show exactly the tasks that were live when
  they finished, ticked or not.
- **`completionRate`** (C5, C6) uses the same set, so the stored rate and the printed
  "x of y" agree.

The template readers in 2a use plain `retiredAt: null` in Prisma. The checklist readers in
2b load the tasks with `retiredAt` selected and filter them in JS through the helper.
Prisma cannot express rule 3 for list loaders (C3, C4, C6), because each row has a
different instant. One JS helper beats eight hand-written `OR`s.

**A limitation that already exists and that this rule does not fix:** `Task` has no
`createdAt`. A task *added* after a past checklist still appears on that checklist's
history view. That is not new and it is out of scope (COMMENT).

## 4. The "unsaved changes" / `saveBlockers` logic on staging

`template-form.tsx` on staging:

- `saveBlockers` (around line 1469) is **pre-save only**: a missing name or a missing type.
  It disables Save and lists its reasons beside the button. A post-save notice does not
  belong in it.
- The dirty guard is `isDirty = !savedAndLeaving && dirtySnapshot !== baseline`.
  `handleSave` sets `setSavedAndLeaving(true)` and then immediately runs
  `router.push("/templates")`. There is no pause between save and redirect.

**Choice for F3: a flash on `/templates`.** `handleSave` reads `retiredCount` from the
PATCH response. It already parses the body when attachments are pending, so it will
always parse it. Then it pushes `/templates?retired=N`.
`(app)/templates/page.tsx` is a 12-line server component. It reads `searchParams` (a
Promise in Next 16) and passes a `retiredNotice` prop to `TemplatesClient`, which renders
one dismissible line: "3 tasks retired — completion history kept". There is no
`useSearchParams`, so no Suspense boundary is needed. The dirty guard is untouched,
because the flag is set before the push exactly as it is today. Holding the user on the
form would mean adding a delay or a second click to a redirect that `savedAndLeaving`
was built around, which is more change for the same message. I'll confirm the
`searchParams` shape against `node_modules/next/dist/docs/` before writing it.

`deletedCount` is returned but not shown, because a hard delete is the behaviour the user
expected. The note fires only when `retiredCount > 0`.

**Attachment mapping fix.** New tasks are sent with `orderIndex: i`, so I'll match on that
instead of position: `localIds.indexOf(localId)` gives `i`, then
`savedTemplate.tasks.find(t => t.orderIndex === i)`. The response type gains
`orderIndex`. This is robust even if the response ever contains an extra row.

## 5. Rulings needed before Phase 2 (RULING NOW)

- **R1: the checklist visibility rule in §3.** Do you accept rules 1–3, and in particular
  rule 2 (a task ticked today stays on today's checklist after it is retired)? The
  alternative is to drop it, and the tick then disappears from view and from the rate.
- **R2: an incoming id that points at a *retired* task** (a stale tab, or a second tab
  saved after the first). Options:
  - (a) **un-retire it** (`retiredAt = null`, then update): one row, continuous history,
    and the save is the truth;
  - (b) create a fresh task (the old id stays retired, and history splits across two
    rows);
  - (c) drop it silently.

  **Recommend (a).** As it stands the code would do (b), because T1 filtered to live tasks
  makes the id "unknown" and it falls into `toCreate`.
- **R3: F3 placement.** §4 recommends the flash on `/templates`. The prompt left this
  choice to the session, so it does not need a ruling unless you object.

## 6. Out-of-scope findings, triaged

- **COMMENT: template DELETE 500s on any template with history.**
  `DELETE /api/templates/[id]` calls `prisma.template.delete`. Tasks cascade, but
  `TaskLog.task` and `Checklist.template` are Restrict, and there is no try/catch, so the
  route throws a 500. It is reachable from the form's Delete button
  (`template-form.tsx:1020`). It existed before TPL-3 and has the same root (RESTRICT
  history). I'm proposing it as a **ROW** only if you want it tracked. Archive is the
  working path today. Not touched here.
- **COMMENT: no `Task.createdAt`**, so tasks added later show on old checklists (§3).
  This already exists. I'm not filing it.
- **COMMENT: `main` vs `staging` drift on the response `orderBy`** (§1). The prompt's root
  cause was read from `main`. Staging already has CHK-1's ordering. I'm recording it so
  nobody "re-fixes" it.

Counts: FIX NOW 0 · RULING NOW 3 (R1–R3) · COMMENT 3 · ROW 0 filed (1 offered).

## 7. Phase 2 plan, as it will be built if R1–R3 land as recommended

1. `prisma/schema.prisma`: add `Task.retiredAt DateTime?` and generate
   `prisma/migrations/<ts>_tpl3_task_retired_at/` with `migrate diff`. **STOP** until you
   apply it.
2. PATCH: the existing set includes `retiredAt`. Split `idsToDelete` into live-with-log →
   `updateMany { retiredAt: now }` and live-without-log → `deleteMany`. An incoming retired
   id is un-retired (R2a). The response tasks are filtered to `retiredAt: null` and
   ordered by `orderIndex`. Return `retiredCount` / `deletedCount`. All writes stay inside
   the existing transaction.
3. Filter T2–T8 on `retiredAt: null`. Add `src/lib/checklist-tasks.ts` and route C1–C8
   through it. Leave H1–H5 unfiltered, each with a comment saying why.
4. Form: match attachments by `orderIndex` and add the `?retired=N` flash.
5. `scripts/verify-tpl3.ts`: the prompt's assertions, plus checks of R1 rules 2 and 3 on a
   completed checklist and an open one.
