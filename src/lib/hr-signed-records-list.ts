import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { formatInstant } from "@/lib/display-time"
import { displayTimeZone } from "@/lib/hr"
import {
  UNCATEGORIZED_FILTER,
  parseSignedRecordFilters,
  signedRecordFiltersToQuery,
  type SignedRecordFilters,
  type SignedRecordSort,
} from "@/lib/hr-signed-records-filters"

// SIGNED-1. The /hr/signed-records query: category + document filters, a
// completed-date sort and cursor paging, ALL IN THE PRISMA `where`. The page
// used to load "the 50 most recent" and nothing else; filtering that page in
// the browser would silently drop every older match, so nothing here filters
// after the fact. The page's first load and GET /api/hr/signed-records ("Load
// more") both call loadSignedRecordsPage, so page two cannot drift from page one.
//
// Scope: HrSignedRecord ONLY — the executed Acknowledgment PDFs. FormSubmission
// rows are a different model and are not listed here (SIGNED-1 scope check).
//
// A RECORD'S CATEGORY IS ITS DOCUMENT'S *CURRENT* CATEGORY. A record pins a
// document VERSION, but categoryId lives on HrDocument (DOC-5), so re-filing a
// document under another category moves every one of its past records with it.
// There is no per-version or per-record category to freeze.
//
// Nothing is excluded for being old: archived documents (isActive false) and
// terminated staff keep their records in every filter.

export { UNCATEGORIZED_FILTER, parseSignedRecordFilters, signedRecordFiltersToQuery }
export type { SignedRecordFilters, SignedRecordSort }

export const SIGNED_RECORDS_PAGE_SIZE = 50

function documentWhere(
  organizationId: string,
  f: Pick<SignedRecordFilters, "category" | "document">
): Prisma.HrDocumentWhereInput {
  const where: Prisma.HrDocumentWhereInput = { organizationId }
  if (f.category === UNCATEGORIZED_FILTER) where.categoryId = null
  else if (f.category) where.categoryId = f.category
  if (f.document) where.id = f.document
  return where
}

export function signedRecordWhere(
  organizationId: string,
  f: Pick<SignedRecordFilters, "category" | "document">
): Prisma.HrSignedRecordWhereInput {
  return { version: { hrDocument: documentWhere(organizationId, f) } }
}

// completedAt carries the sort; id is the deterministic tie-break, so two
// records completed in the same millisecond still page without overlap or skip.
export function signedRecordOrderBy(sort: SignedRecordSort): Prisma.HrSignedRecordOrderByWithRelationInput[] {
  const dir = sort === "oldest" ? "asc" : "desc"
  return [{ completedAt: dir }, { id: dir }]
}

export type SignedRecordRow = {
  id: string
  staffMemberId: string
  staffName: string
  documentTitle: string
  versionNumber: number
  categoryName: string | null
  categoryColorKey: string | null
  completedAtIso: string
  completedLabel: string
  signedPdfHash: string
}

export type SignedRecordsPage = {
  rows: SignedRecordRow[]
  nextCursor: string | null
}

export async function loadSignedRecordsPage(
  org: { id: string; timezone: string },
  filters: SignedRecordFilters,
  cursor: string | null = null
): Promise<SignedRecordsPage> {
  const where = signedRecordWhere(org.id, filters)
  // A cursor from another org or another filter must not seed the page. Prisma's
  // cursor would still apply `where`, but it takes its POSITION from the cursor
  // row wherever that row lives — so confirm the row matches first.
  if (cursor) {
    const ok = await prisma.hrSignedRecord.count({ where: { AND: [where, { id: cursor }] } })
    if (ok === 0) return { rows: [], nextCursor: null }
  }

  const records = await prisma.hrSignedRecord.findMany({
    where,
    include: {
      version: {
        select: {
          versionNumber: true,
          hrDocument: {
            select: { title: true, docCategory: { select: { name: true, colorKey: true } } },
          },
        },
      },
      // DEBT-70b: store zones join the select so each row renders the day ITS
      // OWN signer lived — the same resolution DEBT-70a stamps into the PDF, so
      // this list and the artifact it links to cannot disagree.
      staffMember: {
        select: {
          id: true, displayName: true, fullName: true, isCorporate: true,
          storeAssignments: {
            select: { isPrimary: true, store: { select: { timezone: true, name: true } } },
            orderBy: [{ isPrimary: "desc" as const }, { store: { name: "asc" as const } }],
          },
        },
      },
    },
    orderBy: signedRecordOrderBy(filters.sort),
    take: SIGNED_RECORDS_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = records.length > SIGNED_RECORDS_PAGE_SIZE
  const page = hasMore ? records.slice(0, SIGNED_RECORDS_PAGE_SIZE) : records
  return {
    rows: page.map((r) => ({
      id: r.id,
      staffMemberId: r.staffMember.id,
      staffName: r.staffMember.fullName ?? r.staffMember.displayName,
      documentTitle: r.version.hrDocument.title,
      versionNumber: r.version.versionNumber,
      categoryName: r.version.hrDocument.docCategory?.name ?? null,
      categoryColorKey: r.version.hrDocument.docCategory?.colorKey ?? null,
      completedAtIso: r.completedAt.toISOString(),
      completedLabel: formatInstant(r.completedAt, displayTimeZone(r.staffMember, org), "mediumTime"),
      signedPdfHash: r.signedPdfHash,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  }
}

export type SignedRecordDocumentOption = {
  id: string
  title: string
  isActive: boolean
  categoryId: string | null
  count: number
}

export type SignedRecordFacets = {
  // Every document in the org that has at least one record, archived included.
  documents: SignedRecordDocumentOption[]
  // Record counts per category id; the UNCATEGORIZED_FILTER key for null.
  categoryCounts: Record<string, number>
  // All records in the org, unfiltered.
  total: number
}

// Server-side counts for the chips, the document select and the header — never
// counted from the loaded page. One groupBy on the version (the only relation
// column on the record), then the versions resolved to their documents'
// CURRENT category.
export async function loadSignedRecordFacets(organizationId: string): Promise<SignedRecordFacets> {
  const byVersion = await prisma.hrSignedRecord.groupBy({
    by: ["hrDocumentVersionId"],
    where: signedRecordWhere(organizationId, { category: null, document: null }),
    _count: { _all: true },
  })
  const versions = await prisma.hrDocumentVersion.findMany({
    where: { id: { in: byVersion.map((g) => g.hrDocumentVersionId) } },
    select: {
      id: true,
      hrDocument: { select: { id: true, title: true, isActive: true, categoryId: true } },
    },
  })
  const docOf = new Map(versions.map((v) => [v.id, v.hrDocument]))

  const docs = new Map<string, SignedRecordDocumentOption>()
  const categoryCounts: Record<string, number> = {}
  let total = 0
  for (const g of byVersion) {
    const d = docOf.get(g.hrDocumentVersionId)
    if (!d) continue
    const n = g._count._all
    total += n
    const key = d.categoryId ?? UNCATEGORIZED_FILTER
    categoryCounts[key] = (categoryCounts[key] ?? 0) + n
    const existing = docs.get(d.id)
    if (existing) existing.count += n
    else docs.set(d.id, { id: d.id, title: d.title, isActive: d.isActive, categoryId: d.categoryId, count: n })
  }

  const documents = [...docs.values()].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.title.localeCompare(b.title)
  )
  return { documents, categoryCounts, total }
}

// The total the header shows for the CURRENT filter, from the facets.
export function filteredTotal(facets: SignedRecordFacets, f: SignedRecordFilters): number {
  return facets.documents
    .filter((d) => (f.document ? d.id === f.document : true))
    .filter((d) =>
      f.category === UNCATEGORIZED_FILTER
        ? d.categoryId === null
        : f.category
          ? d.categoryId === f.category
          : true
    )
    .reduce((sum, d) => sum + d.count, 0)
}
