import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

async function resolveArea(id: string, orgId: string) {
  return prisma.storageArea.findFirst({ where: { id, organizationId: orgId } })
}

async function guard(area: { storeId: string } | null) {
  if (!area) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(area.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}

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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const area = await resolveArea(id, org.id)
  const denied = await guard(area)
  if (denied) return denied

  const body = await req.json()
  const data = UpdateSchema.parse(body)

  const updated = await prisma.storageArea.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    },
  })

  return NextResponse.json(updated)
}

// Deleting an area removes its mappings (cascade) and frees those ingredients
// back to unassigned — it never deletes ingredients.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const area = await resolveArea(id, org.id)
  const denied = await guard(area)
  if (denied) return denied

  await prisma.storageArea.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
