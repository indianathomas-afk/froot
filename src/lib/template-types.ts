import { prisma } from "@/lib/prisma"

// TPL-1b. The starter taxonomy every org begins with.
//
// MUST MATCH prisma/migrations/20260808103000_tpl1a_template_type_entity
// EXACTLY — same four names, same colours, same sortOrder. That migration
// seeded these for orgs that would otherwise have ended at zero types; this
// constant does the same job for orgs created afterwards. The SQL is frozen and
// this is live code, so nothing but a comment stops the two drifting: if you
// change one, change the other, and say so on the TPL-1 row.
//
// WHY A STARTER SET EXISTS AT ALL (Gary, Q5, 2026-08-08): the Type select on
// the template form is required, so an org with no types cannot create a
// template at all. These are RENAMEABLE, DELETABLE DEFAULTS an operator can
// see and change — which is what distinguishes them from the DEBT-59 offsets,
// a value stamped silently onto a record nobody chose.
export const STARTER_TEMPLATE_TYPES: { name: string; colorKey: string; sortOrder: number }[] = [
  { name: "Opener", colorKey: "orange", sortOrder: 0 },
  { name: "Mid-Shift", colorKey: "blue", sortOrder: 1 },
  { name: "Closer", colorKey: "purple", sortOrder: 2 },
  { name: "Cleaning", colorKey: "green", sortOrder: 3 },
]

// Idempotent by construction: skipDuplicates leans on the
// @@unique([organizationId, name]) constraint, so a repeat call is a no-op and
// an org that has since renamed or deleted a starter type does NOT get it back.
// That matters because Clerk does not guarantee webhook delivery order and both
// org-upsert sites call this — see src/app/api/webhooks/clerk/route.ts.
export async function ensureStarterTemplateTypes(organizationId: string): Promise<void> {
  const existing = await prisma.templateType.count({ where: { organizationId } })
  if (existing > 0) return

  await prisma.templateType.createMany({
    data: STARTER_TEMPLATE_TYPES.map((t) => ({ ...t, organizationId })),
    skipDuplicates: true,
  })
}
