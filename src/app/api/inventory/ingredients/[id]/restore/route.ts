import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  let dbUser
  try {
    dbUser = await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.ingredient.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!existing.deletedAt) return NextResponse.json({ error: "Ingredient is not deleted" }, { status: 409 })

  const restored = await prisma.ingredient.update({
    where: { id },
    data: { deletedAt: null, lastEditedByUserId: dbUser?.id ?? null },
  })

  return NextResponse.json(restored)
}
