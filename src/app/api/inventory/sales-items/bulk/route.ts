import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

// Bulk triage: mark modifier junk / $0 rows / one-off POS buttons NON_RECIPE
// (or send them back to UNMAPPED). Items with a recipe attached are skipped.
const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  recipeStatus: z.enum(["UNMAPPED", "NON_RECIPE"]),
})

export async function PATCH(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const body = await req.json()
  const { ids, recipeStatus } = BulkSchema.parse(body)

  const result = await prisma.salesItem.updateMany({
    where: { id: { in: ids }, organizationId: org.id, recipe: null },
    data: { recipeStatus },
  })

  return NextResponse.json({ updated: result.count, skipped: ids.length - result.count })
}
