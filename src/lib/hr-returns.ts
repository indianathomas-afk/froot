import { prisma } from "@/lib/prisma"
import { canReadHrSignedRecord } from "@/lib/hr-files"
import { displayTimeZone } from "@/lib/hr"
import { formatCivilDate, formatInstant } from "@/lib/display-time"

// ─── DOC-6: THE KEY HOLDER REGISTER ─────────────────────────────────────────
//
// Rulings: Gary 2026-09-28 (F1–F7, R0–R2), docs/prompts/DOC-6_AUDIT.md. A
// document with `tracksReturn` ISSUES something physical when it is signed (the
// Key Agreement issues a key). The ISSUE is the signed record, and HrSignedRecord
// is append-only (HR-4), so the RETURN is a separate append-only row,
// HrReturnEvent.
//
// THE HOLDING RULE LIVES HERE AND NOWHERE ELSE — `isHolding` below. The
// compliance register, the staff profile, the terminate warning and the POST
// route's duplicate check all reach it through `loadReturnItems`; none of them
// re-derives it. That is R1's (hr-completion.ts) lesson applied from day one:
// one pure predicate, so the fixture tests the thing that ships.
//
// THIS IS NOT COMPLIANCE, and it deliberately disagrees with compliance twice:
// - F4: holding is judged per person per document ACROSS ALL VERSIONS AND ALL
//   SIGNING CYCLES. Compliance asks "has this person signed what we demand of
//   them now"; the register asks "is the key still out". A rehire's prior-cycle
//   signature still means a key was handed over.
// - F7: TERMINATED staff stay in the register, flagged. Compliance counts
//   ACTIVE staff only; a leaver with a key is exactly the case that matters.
// - R2: an ARCHIVED tracks-return document keeps its holders. Mark returned
//   still works; Reissued does not (nothing is issued under a retired agreement).
// Holding a key is never a compliance gap, and nothing here feeds the %.

export type ReturnEventType = "Returned" | "Reissued"

// ─── THE PREDICATE (R1 + F4, Gary 2026-09-28) ───────────────────────────────
//
// "A person holds the key when their latest issue (signature or Reissued) is
// later than their latest Returned, ordered by when each was recorded."
//
// - `signatures` is the completedAt of EVERY signed record the person has on the
//   document — any version, any cycle (F4). None ⇒ never issued ⇒ not holding,
//   whatever events exist.
// - Events order by `createdAt` (when recorded), NEVER by `occurredOn`, which
//   is the date the manager typed and may be backdated.
// - A signature AFTER a Returned re-issues on its own (R1): the rehire who
//   handed a key back at termination and signed again under cycle 2 holds one.
// - A tie (same millisecond) reads NOT holding. It cannot arise from the UI.
export function isHolding(
  signatures: Date[],
  events: { type: ReturnEventType; createdAt: Date }[]
): boolean {
  if (signatures.length === 0) return false
  let latestIssue = Math.max(...signatures.map((d) => d.getTime()))
  let latestReturned = -Infinity
  for (const e of events) {
    const t = e.createdAt.getTime()
    if (e.type === "Reissued") latestIssue = Math.max(latestIssue, t)
    else latestReturned = Math.max(latestReturned, t)
  }
  return latestIssue > latestReturned
}

// ─── WHO MAY RECORD (F5) ─────────────────────────────────────────────────────
//
// ADMIN, or a MANAGER with the staff member in one of their stores. STAFF and
// STORE never. This is HR-7 rule 5's per-person tier, and it is the SAME
// function the signed-record download routes ask — canReadHrSignedRecord — so
// "who may see this person's signed Key Agreement" and "who may record its
// return" cannot drift apart. Pure, so the fixture asserts the shipped decision.
export function canRecordReturn(
  staff: { organizationId: string; staffMemberId: string; staffStoreIds: string[] },
  viewer: { orgDbId: string; role: string | null; storeIds: string[] }
): boolean {
  return canReadHrSignedRecord(staff, viewer)
}

// ─── WHICH EVENT MAY BE APPENDED (F3 + R2) ───────────────────────────────────
//
// Duplicates are refused (Gary: "duplicate events refused"): Returned only while
// holding, Reissued only while not holding. Reissued also needs a signed record
// (nothing was ever issued otherwise) and an ACTIVE document (R2). Returns null
// when the event may be appended, else the 409 message.
//
// A race between two simultaneous clicks can still append two rows; that is
// harmless to `isHolding` (two Returneds read the same as one) and the route
// does not take a lock for it.
export function returnEventConflict(
  state: { hasSignedRecord: boolean; holding: boolean; documentActive: boolean },
  type: ReturnEventType
): string | null {
  if (!state.hasSignedRecord) return "This person has no signed record on this document"
  if (type === "Returned") {
    return state.holding ? null : "Already recorded as returned"
  }
  if (state.holding) return "Already holding — nothing to reissue"
  if (!state.documentActive) return "This document is archived — it can't be reissued"
  return null
}

// ─── THE LOADER ─────────────────────────────────────────────────────────────

export interface ReturnFieldValue {
  label: string
  value: string
}

export interface ReturnEventRow {
  id: string
  type: ReturnEventType
  occurredOnLabel: string // civil date, rendered in UTC (formatCivilDate)
  note: string | null
  recordedByName: string
}

export interface ReturnItem {
  documentId: string
  documentTitle: string
  itemLabel: string // returnItemLabel, or "Item"
  documentActive: boolean
  staffId: string
  staffName: string
  terminated: boolean
  groupName: string // primary store, "Corporate", or "No store on file"
  holding: boolean
  latestSignedAtLabel: string // the most recent signature, in the person's zone
  latestVersionNumber: number
  // Field checkpoint answers from the most recent signed record (e.g. "Key
  // Number: 14"). Empty when the document has no Field checkpoint (audit §1).
  fields: ReturnFieldValue[]
  events: ReturnEventRow[] // newest first
}

export function itemLabelOf(doc: { returnItemLabel: string | null }): string {
  return doc.returnItemLabel?.trim() || "Item"
}

// One loader for every surface. Returns an item per (tracks-return document,
// person with at least one signed record on it) — holding or not; callers
// filter. Scope:
//   - storeIds null = the whole org (ADMIN);
//   - storeIds [...] = people assigned to one of those stores (MANAGER), the
//     same overlap canRecordReturn tests, so a manager can act on every row
//     they are shown;
//   - staffId = one person (the profile and the terminate warning), no store
//     filter — the page already decided the viewer may open this person;
//   - documentId = one document (the POST route's state check).
// TERMINATED staff are included on purpose (F7), and archived documents (R2).
export async function loadReturnItems(
  organizationId: string,
  opts: { storeIds?: string[] | null; staffId?: string; documentId?: string } = {}
): Promise<ReturnItem[]> {
  const docs = await prisma.hrDocument.findMany({
    where: {
      organizationId,
      kind: "Acknowledgment",
      tracksReturn: true,
      ...(opts.documentId ? { id: opts.documentId } : {}),
    },
    select: { id: true, title: true, returnItemLabel: true, isActive: true },
    orderBy: { title: "asc" },
  })
  if (docs.length === 0) return []
  const docIds = docs.map((d) => d.id)

  const staffWhere = {
    organizationId,
    ...(opts.staffId ? { id: opts.staffId } : {}),
    ...(opts.storeIds ? { storeAssignments: { some: { storeId: { in: opts.storeIds } } } } : {}),
  }

  const records = await prisma.hrSignedRecord.findMany({
    where: { version: { hrDocumentId: { in: docIds } }, staffMember: staffWhere },
    select: {
      staffMemberId: true,
      completedAt: true,
      signingCycle: true,
      hrDocumentVersionId: true,
      version: { select: { hrDocumentId: true, versionNumber: true } },
    },
  })
  if (records.length === 0) return []
  const staffIds = [...new Set(records.map((r) => r.staffMemberId))]

  const [staff, events, org] = await Promise.all([
    prisma.staffMember.findMany({
      where: { id: { in: staffIds } },
      select: {
        id: true,
        displayName: true,
        status: true,
        isCorporate: true,
        storeAssignments: {
          select: { isPrimary: true, store: { select: { name: true, timezone: true } } },
          orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
        },
      },
    }),
    prisma.hrReturnEvent.findMany({
      where: { hrDocumentId: { in: docIds }, staffMemberId: { in: staffIds } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ])
  const staffById = new Map(staff.map((s) => [s.id, s]))

  // The most recent signed record per (document, person) — the one whose Field
  // answers are shown and whose date is "signed".
  const key = (docId: string, staffId: string) => `${docId}:${staffId}`
  const signaturesByKey = new Map<string, Date[]>()
  const latestByKey = new Map<string, (typeof records)[number]>()
  for (const r of records) {
    const k = key(r.version.hrDocumentId, r.staffMemberId)
    signaturesByKey.set(k, [...(signaturesByKey.get(k) ?? []), r.completedAt])
    const prev = latestByKey.get(k)
    if (!prev || r.completedAt > prev.completedAt) latestByKey.set(k, r)
  }

  const latest = [...latestByKey.values()]
  const fieldAcks = await prisma.hrDocumentAcknowledgment.findMany({
    where: {
      checkpointType: "Field",
      checkpoint: { retiredAt: null },
      OR: latest.map((r) => ({
        hrDocumentVersionId: r.hrDocumentVersionId,
        staffMemberId: r.staffMemberId,
        signingCycle: r.signingCycle,
      })),
    },
    select: {
      hrDocumentVersionId: true,
      staffMemberId: true,
      signingCycle: true,
      checkpointName: true,
      fieldValue: true,
      checkpoint: { select: { orderIndex: true } },
    },
  })

  const eventsByKey = new Map<string, typeof events>()
  for (const e of events) {
    const k = key(e.hrDocumentId, e.staffMemberId)
    eventsByKey.set(k, [...(eventsByKey.get(k) ?? []), e])
  }

  const items: ReturnItem[] = []
  for (const doc of docs) {
    for (const [k, rec] of latestByKey) {
      if (rec.version.hrDocumentId !== doc.id) continue
      const s = staffById.get(rec.staffMemberId)
      if (!s) continue
      const evs = eventsByKey.get(k) ?? []
      const primary = s.storeAssignments[0]
      items.push({
        documentId: doc.id,
        documentTitle: doc.title,
        itemLabel: itemLabelOf(doc),
        documentActive: doc.isActive,
        staffId: s.id,
        staffName: s.displayName,
        terminated: s.status === "TERMINATED",
        groupName: s.isCorporate ? "Corporate" : (primary?.store.name ?? "No store on file"),
        holding: isHolding(signaturesByKey.get(k) ?? [], evs),
        latestSignedAtLabel: formatInstant(
          rec.completedAt,
          displayTimeZone(s, { timezone: org?.timezone ?? "" }),
          "medium"
        ),
        latestVersionNumber: rec.version.versionNumber,
        fields: fieldAcks
          .filter(
            (a) =>
              a.hrDocumentVersionId === rec.hrDocumentVersionId &&
              a.staffMemberId === rec.staffMemberId &&
              a.signingCycle === rec.signingCycle &&
              a.fieldValue
          )
          .sort((a, b) => a.checkpoint.orderIndex - b.checkpoint.orderIndex)
          .map((a) => ({ label: a.checkpointName, value: a.fieldValue! })),
        events: evs.map((e) => ({
          id: e.id,
          type: e.type,
          occurredOnLabel: formatCivilDate(e.occurredOn, "medium"),
          note: e.note,
          recordedByName: e.recordedByName,
        })),
      })
    }
  }
  items.sort(
    (a, b) =>
      a.documentTitle.localeCompare(b.documentTitle) ||
      a.groupName.localeCompare(b.groupName) ||
      a.staffName.localeCompare(b.staffName)
  )
  return items
}

// ─── THE REGISTER VIEW (F6, /hr/compliance) ─────────────────────────────────
//
// Every tracks-return document, with its CURRENT holders. A document with
// nobody holding still appears ("0 holding") so an admin who just ticked the
// box sees it took.
export interface ReturnRegisterDocument {
  documentId: string
  title: string
  itemLabel: string
  active: boolean
  holders: ReturnItem[]
}

export async function getReturnRegister(
  organizationId: string,
  storeIds: string[] | null
): Promise<ReturnRegisterDocument[]> {
  const [docs, items] = await Promise.all([
    prisma.hrDocument.findMany({
      where: { organizationId, kind: "Acknowledgment", tracksReturn: true },
      select: { id: true, title: true, returnItemLabel: true, isActive: true },
      orderBy: { title: "asc" },
    }),
    loadReturnItems(organizationId, { storeIds }),
  ])
  return docs.map((d) => ({
    documentId: d.id,
    title: d.title,
    itemLabel: itemLabelOf(d),
    active: d.isActive,
    holders: items.filter((i) => i.documentId === d.id && i.holding),
  }))
}
