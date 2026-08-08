import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"
import { can } from "@/lib/permissions"

const CategorySchema = z.object({
  name: z.string().min(1),
  glCode: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
})

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  // Operational: category names and GL codes, no pricing (PERM-2 §3 #5).
  const { actor } = await getUserStoreScope()
  if (!can(actor, "inventory.assets.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const categories = await prisma.ingredientCategory.findMany({
    where: { organizationId: org.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(categories)
}

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

  // TPL-1b, 2026-08-08 — OBSERVATION, NOT A FIX. `parse` throws on a malformed
  // body, so bad input from a client surfaces as a 500 rather than a 400, and a
  // duplicate name trips @@unique([organizationId, name]) as an unhandled P2002
  // — also a 500. Left alone because changing the status codes on a live route
  // is not this row's business; recorded because api/template-types/ was
  // modelled on this file and deliberately did NOT copy either behaviour
  // (safeParse, and a 409 on P2002). Whoever uses this as precedent next should
  // copy the newer pair.
  const body = await req.json()
  const data = CategorySchema.parse(body)

  const category = await prisma.ingredientCategory.create({
    data: {
      organizationId: org.id,
      name: data.name,
      glCode: data.glCode || null,
      sortOrder: data.sortOrder ?? 0,
    },
  })

  return NextResponse.json(category, { status: 201 })
}
