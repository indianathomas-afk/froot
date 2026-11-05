/**
 * TPL-3 — WHICH TEMPLATE TASKS BELONG TO A CHECKLIST.
 *
 * A Checklist stores no task snapshot: every checklist surface reads
 * `checklist.template.tasks` LIVE. So when a task is retired (`Task.retiredAt`,
 * set when an operator deletes a task that has TaskLog history), a plain
 * `retiredAt: null` filter would remove it from today's open checklist — wanted
 * — and ALSO from every past completed checklist and its compliance print — not
 * wanted (F2). Template readers filter `retiredAt: null` in Prisma; checklist
 * readers come through here instead.
 *
 * RULING R1 (Gary, 2026-11-04, accepted as recommended in
 * docs/prompts/TPL-3_AUDIT.md §3). A task is on a checklist when ANY of:
 *   1. it is live (`retiredAt` is null);
 *   2. it has a TaskLog on THIS checklist — a tick that already happened never
 *      vanishes, even from today's open checklist;
 *   3. the checklist had finished (`completedAt ?? closedAt`) before the task
 *      was retired — it was live while the checklist ran.
 *
 * Every reader that counts or validates tasks — submit, day close, task-log,
 * photo upload — uses this same set, so the stored `completionRate` and the
 * printed "x of y" cannot disagree.
 *
 * Known limitation, unchanged by TPL-3: Task has no `createdAt`, so a task
 * ADDED after a past checklist still shows on it.
 */

export interface RetirableTask {
  id: string
  retiredAt: Date | null
}

export interface ChecklistTaskContext {
  completedAt: Date | null
  closedAt: Date | null
  /** Task ids with a TaskLog on this checklist. */
  loggedTaskIds: Iterable<string>
}

export function tasksForChecklist<T extends RetirableTask>(tasks: T[], checklist: ChecklistTaskContext): T[] {
  const logged = new Set(checklist.loggedTaskIds)
  const finishedAt = checklist.completedAt ?? checklist.closedAt
  return tasks.filter(
    (t) =>
      t.retiredAt == null ||
      logged.has(t.id) ||
      (finishedAt != null && t.retiredAt.getTime() > finishedAt.getTime())
  )
}
