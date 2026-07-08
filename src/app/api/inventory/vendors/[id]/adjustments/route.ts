import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

// Standing invoice adjustments for one vendor (I-7). Active ones auto-attach
// as editable lines when receiving that vendor's POs.

const AdjustmentSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["FLAT", "PERCENT"]),
  value: z.number(),
  glCode: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
})

const ReplaceSchema = z.array(AdjustmentSchema.extend({ id: z.string().optional() }))

async function guard(vendorId: string) {
  const { orgId } = await auth()
  if (!orgId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { error: NextResponse.json({ error: "Org not found" }, { status: 404 }) }
  try {
    await requireModule("inventory")
  } catch {
    return { error: NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 }) }
  }
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: org.id } })
  if (!vendor) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  return { org, vendor }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await guard(id)
  if ("error" in ctx) return ctx.error

  const adjustments = await prisma.vendorAdjustment.findMany({
    where: { vendorId: id },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(adjustments)
}

// PUT replaces the vendor's adjustment list wholesale — rows with an id are
// updated, new rows created, missing rows deleted (unless referenced by a PO,
// in which case they're deactivated to keep history intact).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await guard(id)
  if ("error" in ctx) return ctx.error

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const data = ReplaceSchema.parse(body)

  const existing = await prisma.vendorAdjustment.findMany({ where: { vendorId: id } })
  const keptIds = new Set(data.filter((a) => a.id).map((a) => a.id as string))

  await prisma.$transaction(async (tx) => {
    for (const old of existing) {
      if (keptIds.has(old.id)) continue
      const refs = await tx.purchaseOrderAdjustment.count({ where: { vendorAdjustmentId: old.id } })
      if (refs > 0) {
        await tx.vendorAdjustment.update({ where: { id: old.id }, data: { isActive: false } })
      } else {
        await tx.vendorAdjustment.delete({ where: { id: old.id } })
      }
    }
    for (const a of data) {
      if (a.id) {
        await tx.vendorAdjustment.updateMany({
          where: { id: a.id, vendorId: id },
          data: { name: a.name, type: a.type, value: a.value, glCode: a.glCode || null, isActive: a.isActive ?? true },
        })
      } else {
        await tx.vendorAdjustment.create({
          data: { vendorId: id, name: a.name, type: a.type, value: a.value, glCode: a.glCode || null, isActive: a.isActive ?? true },
        })
      }
    }
  })

  const adjustments = await prisma.vendorAdjustment.findMany({ where: { vendorId: id }, orderBy: { createdAt: "asc" } })
  return NextResponse.json(adjustments)
}
