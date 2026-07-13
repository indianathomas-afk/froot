import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../../documents/access"
import { loadScopedStaff } from "../../../shared"

const bodySchema = z.object({
  consent: z.literal(true),
  supervisorTypedName: z.string().trim().min(1).max(200),
})

function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}

// POST /api/hr/forms/submissions/[submissionId]/countersign — the second
// signature when the signers weren't co-present. Appends the supervisor block
// to a PendingSupervisor submission and finalizes it; the employee's values
// and signature are never rewritten. The status-guarded updateMany makes this
// once-only — a second countersign (or a race) changes nothing.
export async function POST(req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Signature consent and your typed name are required" },
      { status: 400 }
    )
  }

  if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") {
    return NextResponse.json({ error: "Only managers can countersign forms" }, { status: 403 })
  }

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: { version: { include: { hrDocument: { select: { organizationId: true } } } } },
  })
  // Cross-org or unknown IDs 404 rather than 403 — don't leak existence.
  if (!submission || submission.version.hrDocument.organizationId !== org.id) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  }
  const staff = await loadScopedStaff(org.id, submission.staffMemberId, dbUser)
  if (!staff) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  if (submission.status !== "PendingSupervisor") {
    return NextResponse.json({ error: "This form is already completed" }, { status: 409 })
  }

  const { count } = await prisma.formSubmission.updateMany({
    where: { id: submission.id, status: "PendingSupervisor" },
    data: {
      status: "Completed",
      supervisorUserId: dbUser.id,
      supervisorTypedName: parsed.data.supervisorTypedName,
      supervisorSignedAt: new Date(),
      supervisorIpAddress: requestIp(req),
      supervisorUserAgent: req.headers.get("user-agent"),
    },
  })
  if (count === 0) {
    return NextResponse.json({ error: "This form is already completed" }, { status: 409 })
  }

  return NextResponse.json({ id: submission.id, status: "Completed", complete: true })
}
