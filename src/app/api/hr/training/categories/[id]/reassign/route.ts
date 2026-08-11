import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../../../access"

// HR-21. Move every module on one category to another category.
//
// ITS OWN ROUTE, not a ?reassignTo= parameter on DELETE (the TPL-1b shape,
// ruled 2026-08-08 and carried here): moving modules between categories
// WITHOUT deleting anything is a legitimate thing to want, and delete stays a
// pure 409-guarded delete — once this has run the count is zero and delete
// unlocks on its own. The response reports how many modules moved; this is
// where "a delete that reassigns says how many modules moved" lives, on the
// act that actually moves them.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const body = await req.json().catch(() => null)
  const toCategoryId = (body as { toCategoryId?: unknown } | null)?.toCategoryId

  if (typeof toCategoryId !== "string" || !toCategoryId.trim()) {
    return NextResponse.json({ error: "toCategoryId is required" }, { status: 400 })
  }
  if (toCategoryId === id) {
    return NextResponse.json({ error: "Choose a different category to reassign to" }, { status: 400 })
  }

  // BOTH ends are resolved against this org. Scoping only the source would let
  // a hand-crafted body move an org's modules onto another tenant's category —
  // the same cross-tenant hole the module routes close on categoryId.
  const [from, to] = await Promise.all([
    prisma.trainingCategory.findFirst({
      where: { id, organizationId: access.org.id },
      select: { id: true },
    }),
    prisma.trainingCategory.findFirst({
      where: { id: toCategoryId, organizationId: access.org.id },
      select: { id: true, name: true },
    }),
  ])
  if (!from) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!to) return NextResponse.json({ error: "Unknown category" }, { status: 400 })

  const result = await prisma.trainingModule.updateMany({
    where: { categoryId: id, organizationId: access.org.id },
    data: { categoryId: to.id },
  })

  return NextResponse.json({ reassigned: result.count, toCategoryId: to.id, toCategoryName: to.name })
}
