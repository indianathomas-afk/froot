import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../access"

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    pageRef: z.number().int().positive().nullable().optional(),
    attestationText: z.string().trim().min(1).nullable().optional(),
    required: z.boolean().optional(),
    orderIndex: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" })

// Both handlers resolve the checkpoint through its document to enforce org
// scope — checkpointId alone is never trusted.
async function findCheckpoint(id: string, checkpointId: string, orgDbId: string) {
  return prisma.hrDocumentCheckpoint.findFirst({
    where: {
      id: checkpointId,
      hrDocument: { id, organizationId: orgDbId, kind: "Acknowledgment" },
    },
    include: { _count: { select: { acknowledgments: true } } },
  })
}

// PATCH /api/hr/documents/[id]/checkpoints/[checkpointId] — ADMIN. Edits the
// definition future signers see. Checkpoint type is immutable (delete and
// re-add instead) and existing acknowledgment rows carry their own snapshots,
// so nothing already signed changes meaning.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; checkpointId: string }> }
) {
  const { id, checkpointId } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const checkpoint = await findCheckpoint(id, checkpointId, access.org.id)
  if (!checkpoint) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 })

  // An Acknowledgment checkpoint must never lose its attestation text.
  if (checkpoint.type === "Acknowledgment" && parsed.data.attestationText === null) {
    return NextResponse.json(
      { error: "Acknowledgment checkpoints need their attestation text" },
      { status: 400 }
    )
  }

  const updated = await prisma.hrDocumentCheckpoint.update({
    where: { id: checkpoint.id },
    data: parsed.data,
  })
  return NextResponse.json(updated)
}

// DELETE /api/hr/documents/[id]/checkpoints/[checkpointId] — ADMIN. Only
// checkpoints nobody has signed can be removed: acknowledgment rows are
// append-only records, and the FK is RESTRICT — we surface a friendly 409
// instead of letting the constraint throw.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; checkpointId: string }> }
) {
  const { id, checkpointId } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const checkpoint = await findCheckpoint(id, checkpointId, access.org.id)
  if (!checkpoint) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 })

  if (checkpoint._count.acknowledgments > 0) {
    return NextResponse.json(
      { error: "This checkpoint has been signed and is part of the permanent record — mark it not required instead" },
      { status: 409 }
    )
  }

  await prisma.hrDocumentCheckpoint.delete({ where: { id: checkpoint.id } })
  return NextResponse.json({ success: true })
}
