// DOC-13 (draft rulings 1 + 3, Gary chose "Ruling 3, all three" 2026-10-28) —
// the one ORDER for open items that carry a document due date, shared by /my,
// /my/documents and the /staff/[id] Documents tab so the three cannot disagree.
//
//   overdue   first, most overdue first (earliest due day)
//   due soon  next, soonest first — an open document with an upcoming due date
//   the rest  in the order the caller already had (the sort is stable)
//
// NO DUE-DATE LOGIC HERE. The dates come from computeStaffComplianceDetails
// (documentDueState, DOC-8); this file only orders by them and copies them onto
// a surface's own rows by documentId. A surface that rendered "Due in 3 days"
// from anything else would be DEBT-26's drift shape again.
//
// TRAINING JOINS THE OVERDUE GROUP ONLY. /my already put overdue training first
// (its status rank), so it is ordered by how overdue it is alongside documents.
// An upcoming training due date does not lift it into "due soon": DOC-13's
// rulings are about documents, and that would be an unruled reorder of training.
import type { ComplianceItem, StaffComplianceDetail } from "@/lib/hr-compliance"
import { localDateStr } from "@/lib/reports"

export type DocumentDueFields = { dueDate: string | null; daysUntilDue: number | null }

type DueKey = { overdue: boolean; day: string | null }

const rank = (k: DueKey) => (k.overdue ? 0 : k.day ? 1 : 2)

export function sortByDue<T>(items: T[], key: (item: T) => DueKey): T[] {
  return items
    .map((item, i) => ({ item, i, k: key(item) }))
    .sort((a, b) => {
      const r = rank(a.k) - rank(b.k)
      if (r !== 0) return r
      if (rank(a.k) < 2 && a.k.day && b.k.day && a.k.day !== b.k.day) return a.k.day < b.k.day ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.item)
}

export function documentDueKey(d: DocumentDueFields): DueKey {
  return { overdue: d.daysUntilDue !== null && d.daysUntilDue < 0, day: d.dueDate }
}

// The compliance item for each row, by documentId. A row with no item (it
// should not happen — both lists ask the same audience rule) gets no due date,
// i.e. renders exactly as before.
export function attachDocumentDue<T extends { documentId: string }>(
  rows: T[],
  detail: StaffComplianceDetail | null | undefined
): (T & DocumentDueFields)[] {
  const byId = new Map<string, DocumentDueFields>()
  for (const i of detail?.items ?? []) {
    if (i.kind === "document") byId.set(i.documentId, { dueDate: i.dueDate, daysUntilDue: i.daysUntilDue })
  }
  return rows.map((r) => {
    const due = byId.get(r.documentId)
    return { ...r, dueDate: due?.dueDate ?? null, daysUntilDue: due?.daysUntilDue ?? null }
  })
}

// DOC-7 ruling 3: the re-sign notice, carried exactly as the due date is —
// from the compliance item, by documentId, never recomputed by the surface.
export type ReSignNoticeFields = { reSignDueDate: string | null; reSignDaysUntilDue: number | null }
export function attachReSignNotice<T extends { documentId: string }>(
  rows: T[],
  detail: StaffComplianceDetail | null | undefined
): (T & ReSignNoticeFields)[] {
  const byId = new Map<string, ReSignNoticeFields>()
  for (const i of detail?.items ?? []) {
    if (i.kind === "document")
      byId.set(i.documentId, { reSignDueDate: i.reSignDueDate, reSignDaysUntilDue: i.reSignDaysUntilDue })
  }
  return rows.map((r) => {
    const n = byId.get(r.documentId)
    return { ...r, reSignDueDate: n?.reSignDueDate ?? null, reSignDaysUntilDue: n?.reSignDaysUntilDue ?? null }
  })
}

// /my's list: the status rank it has always used, then the due order above.
// Moved here from (my)/my/page.tsx so the fixture orders with the same code.
const STATUS_RANK: Record<string, number> = { overdue: 0, "needs-resign": 1, "in-progress": 2, "not-started": 3 }

export function openItemsInDueOrder(items: ComplianceItem[], timeZone: string): ComplianceItem[] {
  const ranked = [...items].sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
  return sortByDue(ranked, (item) =>
    item.kind === "document"
      ? documentDueKey(item)
      : {
          overdue: item.status === "overdue",
          day: item.status === "overdue" && item.dueDate ? localDateStr(new Date(item.dueDate), timeZone) : null,
        }
  )
}
