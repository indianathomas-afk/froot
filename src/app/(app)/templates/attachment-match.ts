/**
 * TPL-3 — which saved task a pending attachment belongs to, after a template
 * save. The form sends every task with `orderIndex: i` (its position in the
 * form), so `i` names the saved row exactly. Matching by POSITION in the
 * response held only while the response contained nothing but the payload's
 * tasks; before TPL-3 it also carried the silently-skipped ones, with their old
 * orderIndex, sorted into the middle. Pure, so scripts/verify-tpl3.ts tests the
 * function the form actually calls.
 */
export function savedTaskIdFor(
  localIds: string[],
  localId: string,
  savedTasks: { id: string; orderIndex: number }[]
): string | undefined {
  const idx = localIds.indexOf(localId)
  if (idx < 0) return undefined
  return savedTasks.find((t) => t.orderIndex === idx)?.id
}
