import { NextResponse } from "next/server"
import { z } from "zod"
import type { LaborDaypart } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborContext } from "@/lib/labor-access"

// Org-default shift blocks / dayparts (storeId = null) with minimum-staffing
// rules. Per-store overrides are a later nicety; Phase 2 manages the org
// defaults. List = any role; mutations = ADMIN + MANAGER.

const bodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  startLocalMinutes: z.number().int().min(0).max(1440),
  endLocalMinutes: z.number().int().min(0).max(1440),
  minHeadcount: z.number().int().min(0).max(99),
  requiresSupervisor: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
})

export function serializeDaypart(d: LaborDaypart) {
  return {
    id: d.id,
    name: d.name,
    startLocalMinutes: d.startLocalMinutes,
    endLocalMinutes: d.endLocalMinutes,
    minHeadcount: d.minHeadcount,
    requiresSupervisor: d.requiresSupervisor,
    sortOrder: d.sortOrder,
    active: d.active,
  }
}

export async function GET() {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error
  const rows = await prisma.laborDaypart.findMany({
    where: { organizationId: ctx.org.id, storeId: null },
    orderBy: [{ sortOrder: "asc" }, { startLocalMinutes: "asc" }],
  })
  return NextResponse.json(rows.map(serializeDaypart))
}

export async function POST(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || parsed.data.endLocalMinutes <= parsed.data.startLocalMinutes) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const created = await prisma.laborDaypart.create({ data: { ...parsed.data, organizationId: ctx.org.id, storeId: null } })
  return NextResponse.json(serializeDaypart(created), { status: 201 })
}
