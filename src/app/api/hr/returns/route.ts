import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canRecordReturn, loadReturnItems, returnEventConflict } from "@/lib/hr-returns"
import { requireHrDocumentAccess } from "../documents/access"

// POST /api/hr/returns — DOC-6: append a Returned or Reissued event against a
// tracks-return document for one staff member.
//
// APPEND-ONLY. This file exports POST and nothing else, and no other route
// writes HrReturnEvent: there is no update and no delete, by ruling (F3). A
// mistake is corrected by appending the opposite event. Do not add a PATCH or
// DELETE here — scripts/verify-doc6-key-register.ts checks this file for one.
//
// Who (F5): ADMIN, or a MANAGER with the person in one of their stores —
// canRecordReturn, which is canReadHrSignedRecord (HR-7 rule 5). STAFF and STORE
// get 403. Cross-org or unknown ids 404, like the signed-record download route.
const bodySchema = z.object({
  hrDocumentId: z.string().min(1),
  staffMemberId: z.string().min(1),
  type: z.enum(["Returned", "Reissued"]),
  // The civil date the manager typed. Stored as DATE; display only — the
  // holding rule orders by createdAt (R1).
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  note: z.string().trim().max(500).nullish(),
})

export async function POST(req: Request) {
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access

  // Role first, so a STAFF or STORE caller learns nothing about which ids exist.
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { hrDocumentId, staffMemberId, type, occurredOn, note } = parsed.data

  // A real calendar day, and not in the future. One day of slack, because the
  // browser's today can be the server's tomorrow.
  const occurred = new Date(`${occurredOn}T00:00:00Z`)
  if (Number.isNaN(occurred.getTime()) || occurred.toISOString().slice(0, 10) !== occurredOn) {
    return NextResponse.json({ error: "Not a valid date" }, { status: 400 })
  }
  if (occurred.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "The date can't be in the future" }, { status: 400 })
  }

  const [doc, member] = await Promise.all([
    prisma.hrDocument.findFirst({
      where: { id: hrDocumentId, organizationId: org.id, kind: "Acknowledgment", tracksReturn: true },
      select: { id: true, isActive: true },
    }),
    prisma.staffMember.findFirst({
      where: { id: staffMemberId, organizationId: org.id },
      select: { id: true, storeAssignments: { select: { storeId: true } } },
    }),
  ])
  if (!doc) return NextResponse.json({ error: "Document not found or doesn't track returns" }, { status: 404 })
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })

  const allowed = canRecordReturn(
    {
      organizationId: org.id,
      staffMemberId: member.id,
      staffStoreIds: member.storeAssignments.map((a) => a.storeId),
    },
    {
      orgDbId: org.id,
      role: dbUser.role,
      storeIds: dbUser.storeAssignments.map((a) => a.storeId),
    }
  )
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // The state check reads the SAME loader and predicate every surface does.
  const [item] = await loadReturnItems(org.id, { staffId: member.id, documentId: doc.id })
  const conflict = returnEventConflict(
    { hasSignedRecord: !!item, holding: item?.holding ?? false, documentActive: doc.isActive },
    type
  )
  if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })

  const event = await prisma.hrReturnEvent.create({
    data: {
      organizationId: org.id,
      hrDocumentId: doc.id,
      staffMemberId: member.id,
      type,
      occurredOn: occurred,
      note: note || null,
      recordedByUserId: dbUser.id,
      recordedByName: dbUser.name?.trim() || dbUser.email,
    },
  })
  return NextResponse.json({ id: event.id, type: event.type }, { status: 201 })
}
