import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../access"

const bodySchema = z.object({ requiresReacknowledgment: z.boolean() })

// PATCH /api/hr/documents/[id]/versions/[versionId] — ADMIN.
//
// R2 Phase B / Case A (Gary, 2026-08-16). The ONE mutable field on a version,
// and the carve-out that makes it mutable at all: an admin who forgets to tick
// the box, or ticks it by accident, notices five minutes later. Everything else
// about a version is an immutable snapshot and stays that way.
//
// ── THE FREEZE IS ENFORCED HERE, NOT IN THE UI ───────────────────────────────
//
// Editable only while the version has ZERO acknowledgments. After the first
// one it is frozen, in both directions, and both directions are refusals rather
// than one:
//
//   UNTICKING cannot un-collect a signature that has already been given. People
//   have re-read and re-signed because this flag asked them to; clearing it
//   afterwards would not undo the work, it would only erase the reason for it.
//
//   TICKING LATE demands a signature from people who were already told they
//   were finished — which is the exact harm R2 exists to prevent, arriving
//   through the control built to allow it deliberately.
//
// A DISABLED CHECKBOX IS NOT ENFORCEMENT. The dialog renders the control
// read-only once acknowledgments exist, and that is a courtesy to the operator,
// not a guard: a disabled input is one devtools attribute away from enabled and
// says nothing about a direct request. The count is re-read HERE, inside the
// same request that writes, so what the UI believed when it rendered cannot
// decide what the server allows now.
//
// 409, NOT 403. The caller is permitted; the version's state refuses. Same
// distinction the checkpoint DELETE route draws for the same reason — an admin
// who sees 403 goes looking for a permissions problem that does not exist.
//
// NOTHING IS WRITTEN TO HrSignedRecord OR HrDocumentAcknowledgment by this
// route, and nothing here reads back into a record already made. Flipping the
// flag changes what documentCompletion answers from now on; it never edits a
// signature.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id, versionId } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  if (!access.dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Resolved THROUGH the document so org scope is enforced by the query rather
  // than by a later check — versionId alone is never trusted. Same shape as the
  // checkpoint routes.
  const version = await prisma.hrDocumentVersion.findFirst({
    where: {
      id: versionId,
      hrDocument: { id, organizationId: access.org.id, kind: "Acknowledgment" },
    },
    select: { id: true, versionNumber: true, requiresReacknowledgment: true },
  })
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 })

  // Idempotent: setting the value it already holds is a no-op that succeeds. A
  // double-submitted dialog must not 409 against its own first write.
  if (version.requiresReacknowledgment === parsed.data.requiresReacknowledgment) {
    return NextResponse.json(version)
  }

  const ackCount = await prisma.hrDocumentAcknowledgment.count({
    where: { hrDocumentVersionId: version.id },
  })
  if (ackCount > 0) {
    return NextResponse.json(
      {
        error:
          "This version has already been acknowledged — the re-acknowledgment setting is frozen.",
      },
      { status: 409 }
    )
  }

  const updated = await prisma.hrDocumentVersion.update({
    where: { id: version.id },
    data: { requiresReacknowledgment: parsed.data.requiresReacknowledgment },
    select: { id: true, versionNumber: true, requiresReacknowledgment: true },
  })
  return NextResponse.json(updated)
}
