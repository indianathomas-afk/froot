import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin } from "@/lib/auth"
import { adjustmentRouteContext, ensureDefaultLossReasons } from "@/lib/adjustments"

const LossReasonSchema = z.object({
  label: z.string().trim().min(1),
})

export async function GET() {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org } = ctx

  await ensureDefaultLossReasons(org.id)
  const reasons = await prisma.lossReason.findMany({
    where: { organizationId: org.id },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { label: "asc" }],
  })
  return NextResponse.json(reasons)
}

export async function POST(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org } = ctx

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const body = await req.json()
  const { label } = LossReasonSchema.parse(body)

  const existing = await prisma.lossReason.findUnique({
    where: { organizationId_label: { organizationId: org.id, label } },
  })
  if (existing) return NextResponse.json({ error: "That reason already exists" }, { status: 409 })

  const maxSort = await prisma.lossReason.aggregate({
    where: { organizationId: org.id },
    _max: { sortOrder: true },
  })
  const reason = await prisma.lossReason.create({
    data: { organizationId: org.id, label, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  })
  return NextResponse.json(reason, { status: 201 })
}
