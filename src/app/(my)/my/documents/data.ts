import { prisma } from "@/lib/prisma"

// Required-acknowledgment status rows for ONE staff member — the /my twin of
// the /staff/[id] Documents-tab query, version-pinned the same way: a signed
// record binds to the version signed; a re-upload flips status to
// needs-current while the old record stays (managers can retrieve it — staff
// never download PDFs, rule 5).
export type MyDocumentRow = {
  documentId: string
  title: string
  category: string | null
  status: "signed" | "pending-record" | "needs-current" | "in-progress" | "not-started"
  currentVersionNumber: number
  completedAt: string | null
  ackedCount: number
  requiredCount: number
}

export async function requiredDocumentRows(staffMember: {
  id: string
  organizationId: string
  storeAssignments: { storeId: string }[]
}): Promise<MyDocumentRow[]> {
  const storeIds = staffMember.storeAssignments.map((a) => a.storeId)
  const docs = await prisma.hrDocument.findMany({
    where: {
      organizationId: staffMember.organizationId,
      kind: "Acknowledgment",
      isActive: true,
      requiresAcknowledgment: true,
      OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: { in: storeIds } } } }],
    },
    include: {
      checkpoints: { where: { required: true }, select: { id: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          signedRecords: { where: { staffMemberId: staffMember.id } },
          acknowledgments: {
            where: { staffMemberId: staffMember.id },
            select: { checkpointId: true },
          },
        },
      },
    },
    orderBy: { title: "asc" },
  })

  return docs.flatMap((d) => {
    const current = d.versions.find((v) => v.isCurrent)
    if (!current) return []
    const currentRecord = current.signedRecords[0]
    const ackedIds = new Set(current.acknowledgments.map((a) => a.checkpointId))
    const requiredCount = d.checkpoints.length
    const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
    const priorSigned = d.versions.find((v) => !v.isCurrent && v.signedRecords.length > 0)

    let status: MyDocumentRow["status"]
    if (currentRecord) status = "signed"
    else if (allAcked) status = "pending-record"
    else if (priorSigned) status = "needs-current"
    else if (ackedIds.size > 0) status = "in-progress"
    else status = "not-started"

    return [
      {
        documentId: d.id,
        title: d.title,
        category: d.category,
        status,
        currentVersionNumber: current.versionNumber,
        completedAt: currentRecord?.completedAt.toISOString() ?? null,
        ackedCount: ackedIds.size,
        requiredCount,
      },
    ]
  })
}
