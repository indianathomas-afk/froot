import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const DismissSchema = z.object({
  ingredientAId: z.string().min(1),
  ingredientBId: z.string().min(1),
})

export async function POST(req: Request) {
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { ingredientAId, ingredientBId } = DismissSchema.parse(body)
  if (ingredientAId === ingredientBId) {
    return NextResponse.json({ error: "Cannot dismiss a pair against itself" }, { status: 400 })
  }

  // Canonical ordering so the pair is recognized regardless of argument order.
  const [a, b] = ingredientAId < ingredientBId ? [ingredientAId, ingredientBId] : [ingredientBId, ingredientAId]

  await prisma.ingredientDuplicateDismissal.upsert({
    where: { organizationId_ingredientAId_ingredientBId: { organizationId: org.id, ingredientAId: a, ingredientBId: b } },
    create: { organizationId: org.id, ingredientAId: a, ingredientBId: b },
    update: {},
  })

  return NextResponse.json({ success: true })
}
