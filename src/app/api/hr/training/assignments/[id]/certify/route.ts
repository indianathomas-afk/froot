import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recalcAssignmentStatus } from "@/lib/training"
import { ensureTrainingCertPdf, SignedRecordError } from "@/lib/hr-signed-pdf"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../../../access"

const bodySchema = z.object({
  // The trainer's typed-name co-signature; consent is the attestation gate.
  typedName: z.string().trim().min(1).max(200),
  consent: z.literal(true),
})

// POST /api/hr/training/assignments/[id]/certify — HR-7 trainer co-sign +
// certification. Requires a Completed module (all lessons + quiz passed) with
// hours logged. Stamps certifiedAt/certifiedByUserId/trainerTypedName once
// (race-guarded), then generates the signed certificate PDF via the shared
// HR-4/5 engine — private store, write-once pointer on the assignment.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id, trainingModule: { organizationId: access.org.id } },
  })
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const member = await findManageableStaffMember(assignment.staffMemberId, access)
  if (!member) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Typed name and attestation are required" }, { status: 400 })
  }

  if (assignment.certifiedAt) {
    return NextResponse.json({ error: "Already certified" }, { status: 409 })
  }
  // Re-derive completion instead of trusting the stored status.
  const status = await recalcAssignmentStatus(assignment.id)
  if (status !== "Completed") {
    return NextResponse.json(
      { error: "All lessons and the quiz must be complete before certification" },
      { status: 409 }
    )
  }
  if (assignment.hoursLogged === null) {
    return NextResponse.json({ error: "Log training hours before certifying" }, { status: 409 })
  }

  // Once-only co-sign: the certifiedAt null guard makes a double submit lose
  // harmlessly (HR-5 countersign rule).
  const { count } = await prisma.trainingAssignment.updateMany({
    where: { id: assignment.id, certifiedAt: null },
    data: {
      certifiedAt: new Date(),
      certifiedByUserId: access.dbUser.id,
      trainerTypedName: parsed.data.typedName,
    },
  })
  if (count === 0) {
    return NextResponse.json({ error: "Already certified" }, { status: 409 })
  }

  try {
    const certified = await ensureTrainingCertPdf(assignment.id)
    return NextResponse.json(
      { certifiedAt: certified.certifiedAt, certPdfHash: certified.certPdfHash },
      { status: 201 }
    )
  } catch (err) {
    // Co-sign is stamped; the PDF can be regenerated idempotently on the next
    // certify/download attempt rather than losing the signature.
    const msg = err instanceof SignedRecordError ? err.message : "Certificate generation failed"
    return NextResponse.json({ error: msg, certifiedButPdfPending: true }, { status: 500 })
  }
}
