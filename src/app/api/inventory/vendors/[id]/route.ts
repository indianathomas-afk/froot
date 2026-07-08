import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const VendorSchema = z.object({
  name: z.string().min(1),
  accountNumber: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  minOrderCases: z.number().nonnegative().optional().nullable(),
  minOrderDollars: z.number().nonnegative().optional().nullable(),
  deliveryDays: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const vendor = await prisma.vendor.findFirst({ where: { id, organizationId: org.id } })
  if (!vendor) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const data = VendorSchema.partial().parse(body)

  const updated = await prisma.vendor.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.accountNumber !== undefined && { accountNumber: data.accountNumber || null }),
      ...(data.contactName !== undefined && { contactName: data.contactName || null }),
      ...(data.email !== undefined && { email: data.email || null }),
      ...(data.phone !== undefined && { phone: data.phone || null }),
      ...(data.terms !== undefined && { terms: data.terms || null }),
      ...(data.leadTimeDays !== undefined && { leadTimeDays: data.leadTimeDays }),
      ...(data.minOrderCases !== undefined && { minOrderCases: data.minOrderCases }),
      ...(data.minOrderDollars !== undefined && { minOrderDollars: data.minOrderDollars }),
      // Prisma Json columns take DbNull via undefined-vs-null handling; an
      // empty array is stored as-is and reads back as "no delivery days".
      ...(data.deliveryDays !== undefined && { deliveryDays: data.deliveryDays ?? [] }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  })

  return NextResponse.json(updated)
}

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
  const vendor = await prisma.vendor.findFirst({ where: { id, organizationId: org.id } })
  if (!vendor) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const poCount = await prisma.purchaseOrder.count({ where: { vendorId: id } })
  if (poCount > 0) {
    await prisma.vendor.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true, softDisabled: true })
  }

  await prisma.vendor.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
