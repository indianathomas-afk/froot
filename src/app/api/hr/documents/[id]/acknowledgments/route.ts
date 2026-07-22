import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { findStaffMemberForUser, primaryStoreName } from "@/lib/hr"
import {
  HR_ATTEST_CONSENT_TEXT,
  HR_ATTEST_CONSENT_VERSION,
  HR_ESIGN_CONSENT_TEXT,
  HR_ESIGN_CONSENT_VERSION,
} from "@/lib/hr-documents"
import { ensureSignedRecord } from "@/lib/hr-signed-pdf"
import { requireHrDocumentAccess } from "../../access"

const bodySchema = z.object({
  // Present = manager-attested capture for that staff member; absent = the
  // signed-in user acknowledging their own (email-matched) staff profile.
  staffMemberId: z.string().min(1).optional(),
  // ESIGN gate — the client cannot submit without it, and the API refuses to.
  consent: z.literal(true),
  // Self-serve: the signer's typed legal name (Signature/Acknowledgment
  // checkpoints). Attested: the manager's own typed name.
  typedName: z.string().trim().min(1).max(200),
  entries: z
    .array(
      z.object({
        checkpointId: z.string().min(1),
        // Field → the field's value; Initial → typed initials. Ignored for
        // Signature/Acknowledgment (typedName is the capture).
        value: z.string().trim().max(500).optional(),
      })
    )
    .min(1)
    .max(500),
})

// The audit trail records the connecting client. On Vercel x-forwarded-for is
// set by the platform; first hop is the client.
function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}

// POST /api/hr/documents/[id]/acknowledgments — the HR-4 capture engine.
// Writes one append-only HrDocumentAcknowledgment per checkpoint, pinned to
// the CURRENT version's hash, with signing-time snapshots and the full ESIGN
// evidence block. Idempotent: re-submitting a checkpoint already signed by
// this staff member for this version is skipped, never overwritten.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Signature consent and at least one checkpoint are required" },
      { status: 400 }
    )
  }
  const { staffMemberId, typedName, entries } = parsed.data

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "Acknowledgment", isActive: true },
    include: {
      checkpoints: true,
      versions: { where: { isCurrent: true }, take: 1 },
    },
  })
  const version = doc?.versions[0]
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  // ── Resolve who is being signed for, and under which auth method ─────────
  const selfStaff = await findStaffMemberForUser(org.id, dbUser)
  const isAttested = !!staffMemberId && staffMemberId !== selfStaff?.id

  let staff = selfStaff
  if (isAttested) {
    if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") {
      return NextResponse.json(
        { error: "Only managers can record acknowledgments for someone else" },
        { status: 403 }
      )
    }
    staff = await prisma.staffMember.findFirst({
      where: { id: staffMemberId, organizationId: org.id },
      include: {
        storeAssignments: {
          include: { store: true },
          orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
        },
      },
    })
    if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
    // Managers only attest for staff in their own stores; admins are org-wide.
    if (dbUser.role === "MANAGER") {
      const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
      if (!staff.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) {
        return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
      }
    }
  }
  if (!staff) {
    return NextResponse.json(
      {
        error:
          "No staff profile is linked to your account. Ask a manager to set your email on your staff record.",
      },
      { status: 403 }
    )
  }
  // HR-7 rule 1: self-serve signing requires an ACTIVE staff profile.
  // Attested capture stays available for terminated staff — backfilling exit
  // paperwork is a manager call.
  if (!isAttested && staff.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your staff profile is no longer active" }, { status: 403 })
  }

  // ── Validate entries against the document's checkpoints ──────────────────
  const checkpointById = new Map(doc.checkpoints.map((c) => [c.id, c]))
  for (const entry of entries) {
    const checkpoint = checkpointById.get(entry.checkpointId)
    if (!checkpoint) {
      return NextResponse.json({ error: "Unknown checkpoint" }, { status: 400 })
    }
    // Self-serve requires the actual capture per type; attested captures the
    // manager's attestation instead (Field values still required).
    const needsValue = checkpoint.type === "Field" || (!isAttested && checkpoint.type === "Initial")
    if (needsValue && !entry.value) {
      return NextResponse.json(
        { error: `"${checkpoint.name}" is missing its ${checkpoint.type === "Field" ? "value" : "initials"}` },
        { status: 400 }
      )
    }
  }

  // ── Build the append-only rows: snapshots + ESIGN evidence ───────────────
  const authMethod = isAttested ? ("ManagerAttested" as const) : ("ClerkSession" as const)
  const methodFor = (type: string) => {
    if (isAttested) return "Attested" as const
    if (type === "Field") return "Field" as const
    if (type === "Initial") return "Initial" as const
    return "Signature" as const // Signature + Acknowledgment: typed legal name
  }
  const staffName = staff.fullName ?? staff.displayName
  const storeName = primaryStoreName(staff)
  const ipAddress = requestIp(req)
  const userAgent = req.headers.get("user-agent")
  const signedAt = new Date()

  const rows = entries.map((entry) => {
    const checkpoint = checkpointById.get(entry.checkpointId)!
    return {
      checkpointId: checkpoint.id,
      hrDocumentVersionId: version.id,
      staffMemberId: staff.id,
      userId: dbUser.id,
      checkpointName: checkpoint.name,
      checkpointType: checkpoint.type,
      documentTitle: doc.title,
      documentVersionNumber: version.versionNumber,
      documentFileHash: version.fileHash,
      staffName,
      storeName,
      attestationText: checkpoint.attestationText,
      method: methodFor(checkpoint.type),
      typedName,
      fieldValue: checkpoint.type === "Field" ? entry.value ?? null : null,
      signedAt,
      ipAddress,
      userAgent,
      authMethod,
      consentGiven: true,
      consentText: isAttested ? HR_ATTEST_CONSENT_TEXT : HR_ESIGN_CONSENT_TEXT,
      consentVersion: isAttested ? HR_ATTEST_CONSENT_VERSION : HR_ESIGN_CONSENT_VERSION,
      ...(checkpoint.type === "Initial" && !isAttested ? { typedName: entry.value } : {}),
    }
  })

  // skipDuplicates rides the @@unique([checkpointId, hrDocumentVersionId,
  // staffMemberId]) constraint — a re-submitted checkpoint is silently
  // skipped, so the original record (and its evidence) is never replaced.
  await prisma.hrDocumentAcknowledgment.createMany({
    data: rows,
    skipDuplicates: true,
  })

  // ── Completion check for the CURRENT version ──────────────────────────────
  const acked = await prisma.hrDocumentAcknowledgment.findMany({
    where: { hrDocumentVersionId: version.id, staffMemberId: staff.id },
    select: { checkpointId: true },
  })
  const ackedIds = new Set(acked.map((a) => a.checkpointId))
  const complete = doc.checkpoints.filter((c) => c.required).every((c) => ackedIds.has(c.id))

  // All required checkpoints in: produce the executed artifact synchronously
  // (handbook-size PDFs finish well within the function timeout). A generator
  // failure must not lose the acknowledgments we just wrote — the download
  // path retries ensureSignedRecord lazily, so report and move on.
  let signedRecordId: string | null = null
  if (complete) {
    try {
      signedRecordId = (await ensureSignedRecord(version.id, staff.id)).id
    } catch (err) {
      console.error("HR-4 signed-PDF generation failed", err)
    }
  }

  return NextResponse.json(
    { complete, signedCheckpoints: ackedIds.size, signedRecordId },
    { status: 201 }
  )
}
