import { prisma } from "@/lib/prisma"

// HR-20. The starter training taxonomy every org begins with.
//
// MUST MATCH prisma/migrations/20260810194426_hr20_training_category_entity
// EXACTLY — same six names, same colours, same sortOrder. That migration
// seeded these for orgs that would otherwise have ended at zero categories;
// this constant does the same job for orgs created afterwards. The SQL is
// frozen and this is live code, so nothing but a comment stops the two
// drifting: if you change one, change the other, and say so on the HR-20 row.
//
// Unlike the template starter set (TPL-1b), this one is a CONVENIENCE, not
// load-bearing: category is OPTIONAL on modules (R-a, 2026-08-10), so an org
// with zero categories can still do everything. These are RENAMEABLE,
// DELETABLE DEFAULTS an operator can see and change — which is what
// distinguishes them from the DEBT-59 offsets, a value stamped silently onto
// a record nobody chose. No module is ever assigned a category by seed code.
export const STARTER_TRAINING_CATEGORIES: { name: string; colorKey: string; sortOrder: number }[] = [
  { name: "New Hire Training", colorKey: "green", sortOrder: 0 },
  { name: "Manager Training", colorKey: "purple", sortOrder: 1 },
  { name: "Procedures Training", colorKey: "blue", sortOrder: 2 },
  { name: "Operations Training", colorKey: "amber", sortOrder: 3 },
  { name: "Product Training", colorKey: "pink", sortOrder: 4 },
  { name: "Smoothie Training", colorKey: "orange", sortOrder: 5 },
]

// Idempotent by construction: skipDuplicates leans on the
// @@unique([organizationId, name]) constraint, so a repeat call is a no-op and
// an org that has since renamed or deleted a starter category does NOT get it
// back. That matters because Clerk does not guarantee webhook delivery order
// and both org-upsert sites call this — see src/app/api/webhooks/clerk/route.ts.
export async function ensureStarterTrainingCategories(organizationId: string): Promise<void> {
  const existing = await prisma.trainingCategory.count({ where: { organizationId } })
  if (existing > 0) return

  await prisma.trainingCategory.createMany({
    data: STARTER_TRAINING_CATEGORIES.map((c) => ({ ...c, organizationId })),
    skipDuplicates: true,
  })
}
