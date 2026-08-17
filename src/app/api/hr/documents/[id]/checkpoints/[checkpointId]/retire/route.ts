import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../../access"

const bodySchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .nullable()
  .optional()

// POST /api/hr/documents/[id]/checkpoints/[checkpointId]/retire — ADMIN.
//
// HR-11n Phase A. Retirement is the removal path for a checkpoint that DELETE
// cannot reach: the 409 guard on the DELETE route refuses anything carrying
// acknowledgments, and every checkpoint this exists to remove has them. Rather
// than weaken that guard — acknowledgment rows are append-only records and
// deleting one reaches backwards into a signature already given — a retired
// checkpoint is hidden going forward and preserved backward.
//
// WHY REVERSIBLE RATHER THAN DESTRUCTIVE. Un-retire (the sibling route) is the
// reason this design was chosen over deletion at all. A wrong retirement is a
// mistake an admin fixes in one click; a wrong delete is unrecoverable and takes
// signatures with it.
//
// G1 IS PRESERVED. The anchor-sync and re-confirmation paths still never delete
// or modify a checkpoint. This is a separate, deliberate, ADMIN-only action —
// nothing here runs on upload, version change, rescan or re-confirmation, and
// there is no auto-retire anywhere in the codebase.
//
// ADMIN ONLY, matching the other document-configuration routes. MANAGER does not
// get it: managers sign and attest, they do not shape documents. It appears on no
// employee-facing surface; a signer never sees it and never knows it exists.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; checkpointId: string }> }
) {
  const { id, checkpointId } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  if (!access.dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Resolved through the document to enforce org scope — checkpointId alone is
  // never trusted. Same shape as findCheckpoint in the sibling route file.
  const checkpoint = await prisma.hrDocumentCheckpoint.findFirst({
    where: {
      id: checkpointId,
      hrDocument: { id, organizationId: access.org.id, kind: "Acknowledgment" },
    },
  })
  if (!checkpoint) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 })

  // Idempotent: retiring an already-retired checkpoint is a no-op that returns
  // the existing row, so a double-submitted dialog cannot overwrite who retired
  // it or when. The FIRST retirement is the one on the record.
  if (checkpoint.retiredAt) return NextResponse.json(checkpoint)

  const updated = await prisma.hrDocumentCheckpoint.update({
    where: { id: checkpoint.id },
    data: {
      retiredAt: new Date(),
      retiredByUserId: access.dbUser.id,
      retiredReason: parsed.data?.reason ?? null,
    },
  })
  return NextResponse.json(updated)
}
