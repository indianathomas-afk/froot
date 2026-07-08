import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"
import { defaultExpectedAt } from "@/lib/vendor-delivery"

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
    include: { vendor: true },
  })
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (po.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft purchase orders can be submitted" }, { status: 409 })
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "SUBMITTED",
      orderedAt: new Date(),
      // I-7: submitting without an expected date defaults it from the
      // vendor's delivery days (then lead time, then next weekday).
      ...(po.expectedAt ? {} : { expectedAt: defaultExpectedAt(po.vendor) }),
    },
    include: { lines: true, store: true, vendor: true },
  })

  return NextResponse.json(updated)
}
