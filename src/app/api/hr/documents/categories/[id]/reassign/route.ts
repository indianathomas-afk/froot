import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../../access"

// DOC-5. Move every document (and agreement form — F7) on one category to
// another. Copied from api/hr/training/categories/[id]/reassign/route.ts.
//
// ITS OWN ROUTE, not a parameter on DELETE (the TPL-1b shape): moving documents
// without deleting anything is a legitimate thing to want, and delete stays a
// pure 409-guarded delete. Only categoryId moves — the legacy category string
// is NOT rewritten (F3).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrDocumentAccess({ admin: true })
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

  // BOTH ends are resolved against this org, so a hand-crafted body cannot move
  // an org's documents onto another tenant's category.
  const [from, to] = await Promise.all([
    prisma.hrDocumentCategory.findFirst({
      where: { id, organizationId: access.org.id },
      select: { id: true },
    }),
    prisma.hrDocumentCategory.findFirst({
      where: { id: toCategoryId, organizationId: access.org.id },
      select: { id: true, name: true },
    }),
  ])
  if (!from) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!to) return NextResponse.json({ error: "Unknown category" }, { status: 400 })

  const result = await prisma.hrDocument.updateMany({
    where: { categoryId: id, organizationId: access.org.id },
    data: { categoryId: to.id },
  })

  return NextResponse.json({ reassigned: result.count, toCategoryId: to.id, toCategoryName: to.name })
}
