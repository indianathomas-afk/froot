import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"
import { serializePosition } from "../route"

// Update / delete one LaborPosition (ADMIN + MANAGER). Org-scoped: the id must
// belong to the caller's org or it 404s.

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    payType: z.enum(["HOURLY", "SALARIED"]),
    defaultHourlyRate: z.number().positive().max(99999999),
    impliedWeeklyHours: z.number().int().positive().max(168).nullable(),
    isSupervisory: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
    active: z.boolean(),
  })
  .partial()

async function loadScoped(id: string, orgId: string) {
  return prisma.laborPosition.findFirst({ where: { id, organizationId: orgId } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const existing = await loadScoped(id, ctx.org.id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const updated = await prisma.laborPosition.update({ where: { id }, data: parsed.data })
  return NextResponse.json(serializePosition(updated))
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const existing = await loadScoped(id, ctx.org.id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.laborPosition.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
