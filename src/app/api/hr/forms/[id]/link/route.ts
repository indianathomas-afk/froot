import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../documents/access"

const bodySchema = z.object({
  // A form id to pair with, or null to unpair.
  linkedFormId: z.string().min(1).nullable(),
})

// POST /api/hr/forms/[id]/link — ADMIN. Check-Out ↔ Check-In pairing.
// linkedFormId is kept SYMMETRIC: every link/unlink writes both documents in
// one transaction so the pair resolves from either direction. Pairing to a
// form that is already in another pair is refused (unpair it first) — links
// are never silently stolen.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const { linkedFormId } = parsed.data

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "FillableForm" },
  })
  if (!doc) return NextResponse.json({ error: "Form not found" }, { status: 404 })

  // ── Unpair ────────────────────────────────────────────────────────────────
  if (linkedFormId === null) {
    await prisma.$transaction([
      prisma.hrDocument.updateMany({
        where: { organizationId: org.id, linkedFormId: doc.id },
        data: { linkedFormId: null },
      }),
      prisma.hrDocument.update({ where: { id: doc.id }, data: { linkedFormId: null } }),
    ])
    return NextResponse.json({ id: doc.id, linkedFormId: null })
  }

  // ── Pair ──────────────────────────────────────────────────────────────────
  if (linkedFormId === doc.id) {
    return NextResponse.json({ error: "A form cannot be paired with itself" }, { status: 400 })
  }
  const target = await prisma.hrDocument.findFirst({
    where: { id: linkedFormId, organizationId: org.id, kind: "FillableForm" },
  })
  if (!target) return NextResponse.json({ error: "Form to pair with not found" }, { status: 404 })
  if (target.linkedFormId && target.linkedFormId !== doc.id) {
    return NextResponse.json(
      { error: "That form is already paired — unpair it first" },
      { status: 409 }
    )
  }

  await prisma.$transaction([
    // Detach this form's previous partner (both directions), if any.
    prisma.hrDocument.updateMany({
      where: { organizationId: org.id, linkedFormId: doc.id, id: { not: target.id } },
      data: { linkedFormId: null },
    }),
    prisma.hrDocument.update({ where: { id: doc.id }, data: { linkedFormId: target.id } }),
    prisma.hrDocument.update({ where: { id: target.id }, data: { linkedFormId: doc.id } }),
  ])

  return NextResponse.json({ id: doc.id, linkedFormId: target.id })
}
