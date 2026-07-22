import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"
import { serializeDaypart } from "../route"

// Update / delete one org-default daypart (ADMIN + MANAGER). Org-scoped.

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    startLocalMinutes: z.number().int().min(0).max(1440),
    endLocalMinutes: z.number().int().min(0).max(1440),
    minHeadcount: z.number().int().min(0).max(99),
    requiresSupervisor: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
    active: z.boolean(),
  })
  .partial()

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const existing = await prisma.laborDaypart.findFirst({ where: { id, organizationId: ctx.org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const start = parsed.data.startLocalMinutes ?? existing.startLocalMinutes
  const end = parsed.data.endLocalMinutes ?? existing.endLocalMinutes
  if (end <= start) return NextResponse.json({ error: "End must be after start" }, { status: 400 })

  const updated = await prisma.laborDaypart.update({ where: { id }, data: parsed.data })
  return NextResponse.json(serializeDaypart(updated))
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const existing = await prisma.laborDaypart.findFirst({ where: { id, organizationId: ctx.org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.laborDaypart.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
