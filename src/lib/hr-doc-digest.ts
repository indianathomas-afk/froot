// ─── NOTIFY-14: the overdue & due-soon document digest — WHAT is in it ───────
// docs/prompts/NOTIFY-DOC-DIGEST_AUDIT.md § 1; rulings in docs/DECISIONS.md
// 2026-10-27 (Gary, F1–F17).
//
// READ ONLY OFF THE /hr/compliance ROLLUP. docDigestView() calls
// getOrgComplianceRollup() with exactly the storeIds argument the compliance
// page passes for that viewer (null = ADMIN, a manager's StoreUserAssignment
// ids otherwise), so the email cannot disagree with the page: terminated
// staff, recordMissing, signed items, documents with no "sign within N days"
// and a MANAGER's corporate staff are all already out before this file sees a
// row (audit § 1 table). The ONE filter added here is the window (F7):
//
//   a document item with a dueDate and daysUntilDue <= DUE_SOON_DAYS
//
// overdue items have daysUntilDue < 0, so they are always in. Training is out
// by the `kind` test (draft ruling 8). Every line's wording is
// documentDueLabel() — DOC-8's, never this file's (F7, F16).
//
// GROUPING IS THE ROLLUP'S (F13). A person sits under rollupStoreGroupId() —
// the same single group /hr/compliance puts them in — so nobody appears twice.
// Corporate staff group as "Corporate" and no-store staff as "Unassigned";
// both can only occur in an ADMIN view (F6), since a manager's rollup never
// fetches them.

import {
  getOrgComplianceRollup,
  rollupStoreGroupId,
  type ComplianceDocItem,
  type StaffComplianceDetail,
} from "@/lib/hr-compliance"
import { documentDueLabel } from "@/lib/hr-due-wording"

/** F7 (Gary, 2026-10-27: "Agreed."): today through 3 days out, inclusive. */
export const DUE_SOON_DAYS = 3

export const UNASSIGNED_GROUP = "Unassigned"
export const CORPORATE_GROUP = "Corporate"

export type DigestLine = {
  staffId: string
  staffName: string
  documentId: string
  title: string
  /** Member-local "YYYY-MM-DD". */
  dueDate: string
  daysUntilDue: number
  /** documentDueLabel() — "Was due Oct 20" · "Due today" · "Due tomorrow" · "Due in 3 days". */
  label: string
}

export type DigestGroup = { name: string; lines: DigestLine[] }

/** One viewer's digest. Serialisable: it is stored on the intent payload. */
export type DocDigestView = {
  groups: DigestGroup[]
  overdue: number
  dueSoon: number
}

/** The window (F7, F15). Exported for the fixture. */
export function inDigestWindow(item: ComplianceDocItem): boolean {
  return item.dueDate !== null && item.daysUntilDue !== null && item.daysUntilDue <= DUE_SOON_DAYS
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" })

/**
 * Pure: the rollup's staff in, the digest out. `storeIds` is the same value
 * the rollup was built with; `storeNames` names the store groups.
 */
export function buildDocDigest(
  staff: StaffComplianceDetail[],
  storeIds: string[] | null,
  storeNames: Map<string, string>
): DocDigestView {
  type Bucket = { name: string; order: number; lines: DigestLine[] }
  const buckets = new Map<string, Bucket>()
  let overdue = 0
  let dueSoon = 0

  for (const s of staff) {
    const lines: DigestLine[] = []
    for (const item of s.items) {
      if (item.kind !== "document" || !inDigestWindow(item)) continue
      const label = documentDueLabel(item)
      if (!label) continue
      lines.push({
        staffId: s.staffId,
        staffName: s.displayName,
        documentId: item.documentId,
        title: item.title,
        dueDate: item.dueDate!,
        daysUntilDue: item.daysUntilDue!,
        label,
      })
      if (item.daysUntilDue! < 0) overdue++
      else dueSoon++
    }
    if (lines.length === 0) continue

    // F6 / F13: stores first (order 0, A–Z), then Unassigned (1), then Corporate (2).
    let key: string
    let bucket: Omit<Bucket, "lines">
    if (s.isCorporate) {
      key = "\u0000corporate"
      bucket = { name: CORPORATE_GROUP, order: 2 }
    } else {
      const storeId = rollupStoreGroupId(s, storeIds)
      const name = storeId ? (storeNames.get(storeId) ?? s.primaryStoreName) : null
      if (storeId && name) {
        key = storeId
        bucket = { name, order: 0 }
      } else {
        key = "\u0000unassigned"
        bucket = { name: UNASSIGNED_GROUP, order: 1 }
      }
    }
    const b = buckets.get(key) ?? { ...bucket, lines: [] }
    b.lines.push(...lines)
    buckets.set(key, b)
  }

  // F13: people A–Z; within a person, ascending daysUntilDue puts the most
  // overdue first and then due-soon soonest first; ties by title.
  const groups = [...buckets.values()]
    .sort((a, b) => a.order - b.order || byName(a.name, b.name))
    .map((b) => ({
      name: b.name,
      lines: b.lines.sort(
        (x, y) =>
          byName(x.staffName, y.staffName) ||
          x.staffId.localeCompare(y.staffId) ||
          x.daysUntilDue - y.daysUntilDue ||
          byName(x.title, y.title)
      ),
    }))
  return { groups, overdue, dueSoon }
}

/** One viewer's digest, from the same rollup call /hr/compliance makes. */
export async function docDigestView(organizationId: string, storeIds: string[] | null): Promise<DocDigestView> {
  const rollup = await getOrgComplianceRollup(organizationId, { storeIds })
  const storeNames = new Map<string, string>()
  for (const s of rollup.staff) if (s.primaryStoreId && s.primaryStoreName) storeNames.set(s.primaryStoreId, s.primaryStoreName)
  for (const s of rollup.stores) if (s.storeId) storeNames.set(s.storeId, s.storeName)
  return buildDocDigest(rollup.staff, storeIds, storeNames)
}

export function digestIsEmpty(view: DocDigestView | undefined): boolean {
  return !view || view.overdue + view.dueSoon === 0
}
