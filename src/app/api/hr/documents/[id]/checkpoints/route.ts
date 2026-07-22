import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { HR_CHECKPOINT_TYPES } from "@/lib/hr-documents"
import { requireHrDocumentAccess } from "../../access"

const bodySchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.enum(HR_CHECKPOINT_TYPES),
    pageRef: z.number().int().positive().nullable().optional(),
    attestationText: z.string().trim().min(1).nullable().optional(),
    required: z.boolean().default(true),
    orderIndex: z.number().int().min(0).optional(),
  })
  .refine((d) => d.type !== "Acknowledgment" || !!d.attestationText, {
    message: "Acknowledgment checkpoints need their attestation text",
  })

// POST /api/hr/documents/[id]/checkpoints — ADMIN. Adds a checkpoint to a
// signature document (on top of the auto-generated per-page defaults).
// Checkpoints are document-scoped, so additions apply to the current version
// going forward; existing acknowledgment rows are snapshots and unaffected.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid checkpoint" },
      { status: 400 }
    )
  }

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: access.org.id, kind: "Acknowledgment" },
  })
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

  const { orderIndex, ...data } = parsed.data
  let index = orderIndex
  if (index === undefined) {
    const last = await prisma.hrDocumentCheckpoint.aggregate({
      where: { hrDocumentId: doc.id },
      _max: { orderIndex: true },
    })
    index = (last._max.orderIndex ?? -1) + 1
  }

  const checkpoint = await prisma.hrDocumentCheckpoint.create({
    data: { ...data, hrDocumentId: doc.id, orderIndex: index },
  })
  return NextResponse.json(checkpoint, { status: 201 })
}
