// DOC-8 F7 (Gary, 2026-10-26) — the one wording for a document's due date.
// A pure module with no server imports, so client surfaces (By Document) and
// server ones (the /staff/[id] Compliance tab, /my) render the same words.
//
//   upcoming  "Due in 5 days" · "Due tomorrow" · "Due today" — never "0 days",
//             the calendar banner's rule (CAL-2b / DEBT-101)
//   overdue   "Was due Nov 2" — training's word ("was due"), the member's day
//   no N      null — the caller renders exactly what it rendered before DOC-8
//
// `dueDate` is a member-local calendar date ("YYYY-MM-DD") computed in
// lib/hr-compliance.ts. It is rendered with formatCivilDate, which reads the
// day back in UTC from midnight UTC — so the day printed is the day computed.
// Passing a zone here would move it a day; that is formatCivilDate's whole
// contract.
import { formatCivilDate } from "@/lib/display-time"

export function documentDueLabel(item: { dueDate: string | null; daysUntilDue: number | null }): string | null {
  if (!item.dueDate || item.daysUntilDue === null) return null
  const d = item.daysUntilDue
  if (d < 0) return `Was due ${formatCivilDate(`${item.dueDate}T00:00:00.000Z`, "monthDay")}`
  if (d === 0) return "Due today"
  if (d === 1) return "Due tomorrow"
  return `Due in ${d} days`
}
