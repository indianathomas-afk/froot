import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../../access"

// POST /api/hr/documents/[id]/checkpoints/[checkpointId]/unretire — ADMIN.
//
// HR-11n Phase A. Clears all three retirement fields, returning the checkpoint
// to the ceremony, the completion denominator and future certificates.
//
// THIS ROUTE IS WHY RETIREMENT IS A NULLABLE MARKER RATHER THAN A DELETE.
// Reversibility is the reason the design was chosen; without un-retire the
// feature is a delete with extra steps and the same one-way failure mode. It is
// in scope for Phase A deliberately, not filed as a follow-up.
//
// Acknowledgments are untouched here as everywhere else — they were never
// removed, so there is nothing to restore. Un-retiring puts the STEP back; the
// evidence never left.
//
// NOTE ON WHAT UN-RETIRE DOES NOT DO. Certificates issued while the checkpoint
// was retired are not reissued and do not gain the step back —
// ensureSignedRecord returns an existing record and never regenerates.
// Retirement is forward-only in both directions: each certificate lists what was
// live when it was minted.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; checkpointId: string }> }
) {
  const { id, checkpointId } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const checkpoint = await prisma.hrDocumentCheckpoint.findFirst({
    where: {
      id: checkpointId,
      hrDocument: { id, organizationId: access.org.id, kind: "Acknowledgment" },
    },
  })
  if (!checkpoint) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 })

  // Idempotent: un-retiring a live checkpoint is a no-op.
  if (!checkpoint.retiredAt) return NextResponse.json(checkpoint)

  const updated = await prisma.hrDocumentCheckpoint.update({
    where: { id: checkpoint.id },
    data: { retiredAt: null, retiredByUserId: null, retiredReason: null },
  })
  return NextResponse.json(updated)
}
