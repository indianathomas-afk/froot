import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

// Recipe-triage status only. Square catalog fields are READ-ONLY everywhere —
// recipes never create, modify, or write Square catalog IDs (hard I-6 rule).
const PatchSchema = z.object({
  recipeStatus: z.enum(["UNMAPPED", "MAPPED", "NON_RECIPE"]),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const body = await req.json()
  const { recipeStatus } = PatchSchema.parse(body)

  const salesItem = await prisma.salesItem.findFirst({
    where: { id, organizationId: org.id },
    include: { recipe: { select: { id: true, name: true } } },
  })
  if (!salesItem) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (salesItem.recipe && recipeStatus !== "MAPPED") {
    return NextResponse.json(
      { error: `"${salesItem.displayName}" has recipe "${salesItem.recipe.name}" attached — detach or delete it first.` },
      { status: 409 }
    )
  }
  if (!salesItem.recipe && recipeStatus === "MAPPED") {
    return NextResponse.json({ error: "MAPPED is set automatically when a recipe is attached" }, { status: 422 })
  }

  const updated = await prisma.salesItem.update({ where: { id }, data: { recipeStatus } })
  return NextResponse.json(updated)
}
