import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

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

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { isAdmin, storeIds } = await getUserStoreScope()
  const { id } = await params

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: org.id, ...(isAdmin ? {} : { storeId: { in: storeIds } }) },
  })
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (po.status !== "DRAFT" && po.status !== "SUBMITTED") {
    return NextResponse.json({ error: "Only draft or submitted purchase orders can be cancelled" }, { status: 409 })
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: { lines: true, store: true, vendor: true },
  })

  return NextResponse.json(updated)
}
