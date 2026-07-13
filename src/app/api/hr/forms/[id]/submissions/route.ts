import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { primaryStoreName } from "@/lib/hr"
import { HR_ESIGN_CONSENT_TEXT, HR_ESIGN_CONSENT_VERSION } from "@/lib/hr-documents"
import type { FormDefinition } from "@/lib/hr-forms"
import { requireHrDocumentAccess } from "../../../documents/access"
import { loadScopedStaff } from "../../shared"

const bodySchema = z.object({
  staffMemberId: z.string().min(1),
  // The definition hash the client RENDERED — refused if an edit landed since
  // the page loaded, so values never pin to a definition nobody saw.
  definitionHash: z.string().min(1),
  // Positional: values[i] answers the snapshot's fields[i].
  values: z.array(z.string().trim().max(500)).max(100),
  // ESIGN gate — both signers consent; the client cannot submit without it.
  consent: z.literal(true),
  employeeTypedName: z.string().trim().min(1).max(200),
  // Present = co-present execution, finalized immediately. Absent = the
  // employee signed now and a supervisor countersigns later (PendingSupervisor).
  supervisorTypedName: z.string().trim().min(1).max(200).optional(),
})

function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}

// POST /api/hr/forms/[id]/submissions — execute a fillable form for a staff
// member (ADMIN, or MANAGER within store scope; the current user is the
// supervisor side). Writes ONE append-only FormSubmission with values, both
// audit blocks, and signing-time snapshots, pinned to the current version's
// definition hash. Re-execution is routine: no uniqueness — a staff member
// accumulates submissions over time (key re-issues, pay changes).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Signature consent, the employee signature, and field values are required" },
      { status: 400 }
    )
  }
  const { staffMemberId, definitionHash, values, employeeTypedName, supervisorTypedName } =
    parsed.data

  if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") {
    return NextResponse.json({ error: "Only managers can execute forms" }, { status: 403 })
  }
  const staff = await loadScopedStaff(org.id, staffMemberId, dbUser)
  if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "FillableForm", isActive: true },
    include: { versions: { where: { isCurrent: true }, take: 1 } },
  })
  const version = doc?.versions[0]
  if (!doc || !version) return NextResponse.json({ error: "Form not found" }, { status: 404 })

  if (definitionHash !== version.fileHash) {
    return NextResponse.json(
      { error: "This form was updated while you were filling it in — reload and try again" },
      { status: 409 }
    )
  }

  // ── Validate values against the pinned definition ─────────────────────────
  const definition = version.definitionSnapshot as unknown as FormDefinition | null
  if (!definition) {
    return NextResponse.json({ error: "Form definition is missing" }, { status: 500 })
  }
  if (values.length !== definition.fields.length) {
    return NextResponse.json({ error: "Every field must be submitted" }, { status: 400 })
  }
  for (const [i, field] of definition.fields.entries()) {
    const value = values[i] ?? ""
    if (field.required && !value) {
      return NextResponse.json({ error: `"${field.label}" is required` }, { status: 400 })
    }
    if (value && field.fieldType === "Select" && !(field.options ?? []).includes(value)) {
      return NextResponse.json(
        { error: `"${value}" is not one of the options for "${field.label}"` },
        { status: 400 }
      )
    }
  }

  const now = new Date()
  const ipAddress = requestIp(req)
  const userAgent = req.headers.get("user-agent")
  const complete = !!supervisorTypedName

  const submission = await prisma.formSubmission.create({
    data: {
      hrDocumentVersionId: version.id,
      staffMemberId: staff.id,
      // Stored self-describing (label + type + value, in order) so the signed
      // PDF and any future reader never depend on live FormField rows.
      values: definition.fields.map((f, i) => ({
        label: f.label,
        fieldType: f.fieldType,
        value: values[i] ?? "",
      })),
      status: complete ? "Completed" : "PendingSupervisor",
      employeeTypedName,
      employeeSignedAt: now,
      ipAddress,
      userAgent,
      ...(complete
        ? {
            supervisorUserId: dbUser.id,
            supervisorTypedName,
            supervisorSignedAt: now,
            supervisorIpAddress: ipAddress,
            supervisorUserAgent: userAgent,
          }
        : {}),
      // --- snapshots frozen at signing time ---
      formTitle: doc.title,
      formVersionNumber: version.versionNumber,
      staffName: staff.fullName ?? staff.displayName,
      storeName: primaryStoreName(staff),
      definitionHash: version.fileHash,
      consentText: HR_ESIGN_CONSENT_TEXT,
      consentVersion: HR_ESIGN_CONSENT_VERSION,
    },
  })

  return NextResponse.json(
    { id: submission.id, status: submission.status, complete },
    { status: 201 }
  )
}
