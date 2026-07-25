import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { syncCheckpointsForConfirmedAnchors } from "@/lib/hr-anchors"
import { HR_ANCHOR_MARK_TYPES, HR_ANCHOR_PLACEMENTS } from "@/lib/hr-documents"
import { requireHrDocumentAccess } from "../../access"

// Confirmation updates every submitted anchor and links checkpoints; give it
// Node + headroom so a large anchor set can't time out mid-transaction.
export const runtime = "nodejs"
export const maxDuration = 60

const bodySchema = z.object({
  anchors: z
    .array(
      z.object({
        id: z.string().min(1),
        markType: z.enum(HR_ANCHOR_MARK_TYPES),
        placement: z.enum(HR_ANCHOR_PLACEMENTS),
        keep: z.boolean(),
      })
    )
    .min(1)
    .max(500),
})

// POST /api/hr/documents/[id]/anchors — ADMIN. The confirm/mapping step: the
// admin's decisions on the CURRENT version's detected anchors. Kept anchors are
// updated (mark type + placement) and marked confirmed; discarded anchors are
// deleted (they were proposals). Confirmed action-anchors then generate/link
// their checkpoints. Only the current version is editable — historical versions
// keep the anchors they were signed against (ruling #1).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid anchor confirmation" }, { status: 400 })
  }

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: access.org.id, kind: "Acknowledgment" },
    include: { versions: { where: { isCurrent: true }, take: 1 } },
  })
  const version = doc?.versions[0]
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  // Every submitted anchor must belong to THIS document's current version —
  // guards against confirming another doc's or an older version's anchors.
  const owned = await prisma.documentAnchor.findMany({
    where: { hrDocumentVersionId: version.id },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((a) => a.id))
  if (parsed.data.anchors.some((a) => !ownedIds.has(a.id))) {
    return NextResponse.json({ error: "Unknown anchor for this version" }, { status: 400 })
  }

  const kept = parsed.data.anchors.filter((a) => a.keep)
  const discarded = parsed.data.anchors.filter((a) => !a.keep).map((a) => a.id)

  await prisma.$transaction([
    ...kept.map((a) =>
      prisma.documentAnchor.update({
        where: { id: a.id },
        data: { markType: a.markType, placement: a.placement, confirmed: true },
      })
    ),
    ...(discarded.length > 0
      ? [prisma.documentAnchor.deleteMany({ where: { id: { in: discarded } } })]
      : []),
  ])

  // Generate/link checkpoints from the now-confirmed set (link-first, G1-safe).
  await syncCheckpointsForConfirmedAnchors(doc.id, version.id)

  const confirmedCount = await prisma.documentAnchor.count({
    where: { hrDocumentVersionId: version.id, confirmed: true },
  })
  return NextResponse.json({ confirmed: confirmedCount }, { status: 200 })
}
