import type { Prisma } from "@prisma/client"

/**
 * TPL-3 — the task half of PATCH /api/templates/[id], lifted out of the route
 * so scripts/verify-tpl3.ts runs the SAME code against the dev database (a
 * route handler needs Clerk's auth() and cannot run under tsx).
 *
 * Call it INSIDE the caller's transaction, after syncTemplateSections (renames
 * must land before any task is stamped) and before pruneEmptySections (a
 * section is only empty once the tasks have moved off it).
 *
 * F1 — THIS USED TO BE A SILENT SKIP. A task with TaskLog history cannot be
 * deleted (TaskLog.task is RESTRICT). Before TPL-3 the route dropped such tasks
 * into a `blockedIds` set that nothing ever read: the task stayed live, the
 * route returned 200, and the operator watched it come back. Now:
 *   - a removed task WITH history is RETIRED (`retiredAt = now`) — the row
 *     stays, so completion history keeps resolving it by id;
 *   - a removed task WITHOUT history is hard-deleted, as before;
 *   - an incoming id naming a RETIRED task (a stale tab saved after another
 *     tab retired it) UN-RETIRES it — ruling R2 (a): the save is the truth, and
 *     one row keeps the task's history continuous;
 *   - a retired task absent from the payload is left exactly as it is.
 * The history check runs inside the transaction, so it sees the same rows the
 * delete does.
 */
export type TaskWriteData = Omit<Prisma.TaskUncheckedCreateInput, "templateId">

export interface TaskSyncResult {
  retired: number
  deleted: number
  created: number
  updated: number
}

export async function syncTemplateTasks<T extends { id?: string | null }>(
  tx: Prisma.TransactionClient,
  templateId: string,
  incoming: T[],
  dataFor: (t: T) => TaskWriteData
): Promise<TaskSyncResult> {
  // The diff base is EVERY row on the template, retired ones included, so an
  // incoming retired id is recognised instead of being re-created as a copy.
  const existing = await tx.task.findMany({ where: { templateId }, select: { id: true, retiredAt: true } })
  const existingIds = new Set(existing.map((t) => t.id))
  const retiredIds = new Set(existing.filter((t) => t.retiredAt != null).map((t) => t.id))

  const toUpdate = incoming.filter((t): t is T & { id: string } => !!t.id && existingIds.has(t.id))
  const toCreate = incoming.filter((t) => !t.id || !existingIds.has(t.id))
  const keep = new Set(toUpdate.map((t) => t.id))

  // Only LIVE tasks can be removed.
  const removed = existing.filter((t) => t.retiredAt == null && !keep.has(t.id)).map((t) => t.id)
  const withHistory = new Set(
    removed.length
      ? (await tx.taskLog.findMany({ where: { taskId: { in: removed } }, select: { taskId: true }, distinct: ["taskId"] })).map((l) => l.taskId)
      : []
  )
  const toRetire = removed.filter((id) => withHistory.has(id))
  const toHardDelete = removed.filter((id) => !withHistory.has(id))

  const deleted = toHardDelete.length
    ? (await tx.task.deleteMany({ where: { id: { in: toHardDelete }, templateId } })).count
    : 0
  // `retiredAt: null` in the filter keeps the count honest under a concurrent
  // save that already retired the same row.
  const retired = toRetire.length
    ? (await tx.task.updateMany({ where: { id: { in: toRetire }, templateId, retiredAt: null }, data: { retiredAt: new Date() } })).count
    : 0

  for (const t of toUpdate) {
    await tx.task.update({
      where: { id: t.id },
      data: { ...dataFor(t), ...(retiredIds.has(t.id) ? { retiredAt: null } : {}) },
    })
  }
  for (const t of toCreate) {
    await tx.task.create({ data: { ...dataFor(t), templateId } })
  }

  return { retired, deleted, created: toCreate.length, updated: toUpdate.length }
}
