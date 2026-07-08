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

  const vendors = await prisma.vendor.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(vendors)
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

  const body = await req.json()
  const data = VendorSchema.parse(body)

  const vendor = await prisma.vendor.create({
    data: {
      organizationId: org.id,
      name: data.name,
      accountNumber: data.accountNumber || null,
      contactName: data.contactName || null,
      email: data.email || null,
      phone: data.phone || null,
      terms: data.terms || null,
      leadTimeDays: data.leadTimeDays ?? null,
      minOrderCases: data.minOrderCases ?? null,
      minOrderDollars: data.minOrderDollars ?? null,
      deliveryDays: data.deliveryDays ?? undefined,
      notes: data.notes || null,
    },
  })

  return NextResponse.json(vendor, { status: 201 })
}
