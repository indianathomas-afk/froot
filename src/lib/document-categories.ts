import { prisma } from "@/lib/prisma"

// DOC-5. The starter document taxonomy every org begins with — one taxonomy
// for library documents AND agreement forms (F7, Gary 2026-09-28).
//
// MUST MATCH prisma/migrations/20260928213037_doc5_document_category_entity
// STEP 1 EXACTLY — same five names, same colours, same sortOrder. That
// migration seeded these for every existing org and backfilled categoryId from
// the legacy string; this constant does the seed half for orgs created
// afterwards. The SQL is frozen and this is live code, so nothing but a comment
// stops the two drifting: if you change one, change the other, and say so on
// the DOC-5 row. Handbook is ORANGE, not amber — Gary's F1 ruling, matching the
// chip users saw before DOC-5.
//
// These are RENAMEABLE, DELETABLE rows an operator can see and change (the
// HR-20 distinction from DEBT-59's silently stamped values). categoryId is
// OPTIONAL (F2), so an org with zero categories still works.
export const STARTER_DOCUMENT_CATEGORIES: { name: string; colorKey: string; sortOrder: number }[] = [
  { name: "Handbook", colorKey: "orange", sortOrder: 0 },
  { name: "Pay Agreement", colorKey: "green", sortOrder: 1 },
  { name: "Policy", colorKey: "blue", sortOrder: 2 },
  { name: "HR Management", colorKey: "purple", sortOrder: 3 },
  { name: "Other", colorKey: "gray", sortOrder: 4 },
]

// The legacy HrDocument.category string a CREATE writes (F3): the chosen
// category's name, or "Other" when uncategorized. The column is NOT NULL and
// stale by design — rename, reassign and the edit dialogs never touch it.
export const LEGACY_UNCATEGORIZED_STRING = "Other"

// The two columns a CREATE writes, from a resolved category (or null). ONE
// definition, called by POST /api/hr/documents and POST /api/hr/forms, so the
// F3 rule cannot differ between the library and forms — and so
// scripts/verify-doc5-categories.ts tests the shipped mapping, not a copy.
export function categoryWriteFields(resolved: { id: string; name: string } | null): {
  categoryId: string | null
  category: string
} {
  return {
    categoryId: resolved?.id ?? null,
    category: resolved?.name ?? LEGACY_UNCATEGORIZED_STRING,
  }
}

// Idempotent by construction, exactly as ensureStarterTrainingCategories: the
// zero-count guard means an org that has since renamed or deleted a starter
// does NOT get it back, and skipDuplicates covers the webhook race (Clerk does
// not guarantee delivery order and both org-upsert sites call this).
export async function ensureStarterDocumentCategories(organizationId: string): Promise<void> {
  const existing = await prisma.hrDocumentCategory.count({ where: { organizationId } })
  if (existing > 0) return

  await prisma.hrDocumentCategory.createMany({
    data: STARTER_DOCUMENT_CATEGORIES.map((c) => ({ ...c, organizationId })),
    skipDuplicates: true,
  })
}

// The org's categories in display order — the one query every picker and every
// grouped view reads, so sortOrder means the same thing everywhere.
export async function listDocumentCategories(organizationId: string) {
  return prisma.hrDocumentCategory.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, colorKey: true, sortOrder: true },
  })
}

// Resolve a client-supplied categoryId against THIS org. A foreign or unknown
// id must be indistinguishable from a bad request — never a bare id lookup.
// Returns: undefined when the field was absent, null for "uncategorized", the
// row when valid, or "invalid".
export async function resolveDocumentCategoryId(
  organizationId: string,
  categoryId: string | null | undefined
): Promise<{ id: string; name: string } | null | undefined | "invalid"> {
  if (categoryId === undefined) return undefined
  if (categoryId === null) return null
  const row = await prisma.hrDocumentCategory.findFirst({
    where: { id: categoryId, organizationId },
    select: { id: true, name: true },
  })
  return row ?? "invalid"
}
