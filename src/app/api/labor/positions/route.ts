import { NextResponse } from "next/server"
import { z } from "zod"
import type { LaborPosition } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"

// LaborPosition CRUD (the rate legend). List + mutations are ADMIN + MANAGER.
// defaultHourlyRate is DOLLARS (Decimal); serialized to a number for clients.

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  payType: z.enum(["HOURLY", "SALARIED"]),
  defaultHourlyRate: z.number().positive().max(99999999),
  impliedWeeklyHours: z.number().int().positive().max(168).nullable(),
  isSupervisory: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
})

export function serializePosition(p: LaborPosition) {
  return {
    id: p.id,
    name: p.name,
    payType: p.payType,
    defaultHourlyRate: Number(p.defaultHourlyRate),
    impliedWeeklyHours: p.impliedWeeklyHours,
    isSupervisory: p.isSupervisory,
    sortOrder: p.sortOrder,
    active: p.active,
  }
}

export async function GET() {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error

  const positions = await prisma.laborPosition.findMany({
    where: { organizationId: ctx.org.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })
  return NextResponse.json(positions.map(serializePosition))
}

export async function POST(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const created = await prisma.laborPosition.create({
    data: { ...parsed.data, organizationId: ctx.org.id },
  })
  return NextResponse.json(serializePosition(created), { status: 201 })
}
