froot

# TIER 2 — Checklist Template Task Sort Order

Fix drag-reorder persistence in the checklist template editor, and add a manual sort-order field to the Edit Task form.

Do not push. Commit only. Stage only the files this session touches — no `git add -A`.

---

## Problem

Two symptoms, one underlying cause to confirm:

1. Dragging a task to reorder it in the template editor (`/templates/[id]/edit`) rarely persists. The list visually reorders, then reverts on refresh.
2. There is no way to reposition a task without dragging. On a 40+ task opening checklist, dragging item 25 up to position 5 is painful even when it works.

## Deliverables

**A. Diagnose and fix the drag-reorder save path.**

**B. Add a sort-order field to the Edit Task form** (the modal shown in `Edit Task` with Section Name / Est. Time / Task Description). It shows the task's current position and accepts a new position. Saving renumbers every other task in the template automatically.

Both must write through the **same** persistence path. One endpoint, two triggers.

---

## Phase 1 — Audit (brief, then report before building)

Locate and read:

- The template edit page and its task list component (search for the drag handle / dnd library usage under `/Users/garythomas/Claude_Projects/Froot/froot/app` and `/Users/garythomas/Claude_Projects/Froot/froot/components`)
- The Edit Task form component
- Whatever API route or server action currently handles task reordering
- The Prisma model for checklist template tasks in `/Users/garythomas/Claude_Projects/Froot/froot/prisma/schema.prisma`

Report back, plainly:

1. What field stores order (`position`, `sortOrder`, `order`, etc.), its type, and **whether it has a unique constraint** (alone or composite with template ID). This determines whether a naive renumber will deadlock or throw.
2. Are positions currently contiguous (1,2,3…) or sparse/gapped? Are there duplicates or NULLs in existing data?
3. The exact current save path on drag-end — does it fire at all, does it await, does it surface errors, does it send the full ordered array or a single moved item?
4. Your root-cause call on why the save rarely lands.

**Do not start Phase 2 until you have reported the above.** Keep the report short — this is TIER 2, not an architecture review.

---

## Phase 2 — Build

### Ordering model (ruling, apply as written)

- Order is **template-global**, not per-section. The numbers in the editor run 1..n across the whole template; `Section Name` is an independent label field on each task.
- Therefore moving a task from 25 to 5 places it between the current 4 and 5 and **does not change its section label**.
- If the task's section label differs from the section label of its new neighbors, that is allowed — but the UI must warn (see below). Do not silently rewrite the section, and do not block the move.

### Reorder endpoint

One endpoint/action that accepts a template ID and the **complete ordered array of task IDs**, and rewrites positions 1..n inside a single Prisma transaction.

- If `position` carries a unique constraint, do a two-phase write inside the transaction: offset all rows to a non-colliding range first (e.g. `position + 100000`), then write final values. Do not rely on update ordering to avoid collisions.
- Validate that the submitted ID array is exactly the set of task IDs belonging to that template — no additions, no omissions. Reject with a clear error otherwise.
- Scope every query by template ID and org. No cross-tenant reach.

### Drag fix

- Drag-end sends the full reordered array from the just-computed order, not from a possibly-stale state read.
- Await the save. On failure, revert the list to server state and show an error toast. Silent failure is the bug being fixed — it must not be possible to fail quietly.
- On success, the list must survive a hard refresh. That is the acceptance test.

### Sort-order field in Edit Task

- Add a numeric field to the Edit Task form, labeled `Sort Order`, showing the task's current position, placed near `Est. Time (min)`.
- Helper text underneath: current position out of total, e.g. `Currently 25 of 41`.
- Accept integers 1..n. Clamp out-of-range input to the valid bounds rather than erroring.
- On save with a changed value: compute the new full ordering (remove the task, reinsert at the requested index), then call the same reorder endpoint. Other tasks shift automatically.
- If the new neighbors carry a different `Section Name` than this task, show an inline warning before save: something to the effect of `Position 5 sits inside "Store Closing" — this task will stay labeled "Store Opening".` Warn only; let the save proceed.
- If the sort order is unchanged, do not fire a reorder write at all.

### Data hygiene

If Phase 1 found duplicate or NULL positions in existing template data, normalize them to contiguous 1..n as part of this work. Report which templates were affected and how many rows moved.

---

## Evidence required before commit

- Hard-refresh proof: drag a task, refresh, order held. State which template ID.
- Sort-order field proof: set a task from a high number to a low one, refresh, order held, all neighbors renumbered contiguously.
- Query result showing contiguous positions with no duplicates for that template, with the branch literal (`br-square-feather`) visible in the same output.
- Failure-path proof: reorder fails → list reverts and toast fires. Force it however you like.
- Section-mismatch warning renders when applicable.

Re-measure. Do not cite prior results.

---

## Roadmap

Read `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` and take the next free ID — do not assume one from a stale note in the file. Add the row for this work. Preserve-and-mark existing rows; never delete.

## Out-of-scope findings

Classify anything you turn up as FIX NOW / RULING NOW / COMMENT / ROW before writing the session report. ROW is the last resort.

## Close out

Run `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PRE-PUSH-CHECK.md`.

Commit. Do not push. Report back with the evidence above and I will review and promote.
