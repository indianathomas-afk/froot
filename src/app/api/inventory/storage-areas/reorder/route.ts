import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const ReorderSchema = z.object({
  storeId: z.string().min(1),
  areaIds: z.array(z.string().min(1)).min(1),
})

// POST /api/inventory/storage-areas/reorder — persist the walk order of a
// store's areas in one call (areaIds in the desired order).
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
  const data = ReorderSchema.parse(body)

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const areas = await prisma.storageArea.findMany({
    where: { id: { in: data.areaIds }, organizationId: org.id, storeId: data.storeId },
  })
  if (areas.length !== data.areaIds.length) {
    return NextResponse.json({ error: "One or more areas not found in this store" }, { status: 404 })
  }

  await prisma.$transaction(
    data.areaIds.map((id, index) => prisma.storageArea.update({ where: { id }, data: { sortOrder: index } }))
  )

  return NextResponse.json({ success: true })
}
