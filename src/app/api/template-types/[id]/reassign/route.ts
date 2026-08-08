import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../../../templates/access"
import { NextResponse } from "next/server"

// TPL-1b. Move every template on one type to another type.
//
// ITS OWN ROUTE, not a ?reassignTo= parameter on DELETE (Gary, Q2, approved
// 2026-08-08): moving templates between types WITHOUT deleting anything is a
// legitimate thing to want, and folding it into DELETE would make the
// destructive path do two jobs. Delete stays a pure 409-guarded delete; once
// this has run the count is zero and delete unlocks on its own.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const toTypeId = (body as { toTypeId?: unknown } | null)?.toTypeId

  if (typeof toTypeId !== "string" || !toTypeId.trim()) {
    return NextResponse.json({ error: "toTypeId is required" }, { status: 400 })
  }
  if (toTypeId === id) {
    return NextResponse.json({ error: "Choose a different type to reassign to" }, { status: 400 })
  }

  // BOTH ends are resolved against this org. Scoping only the source would let
  // a hand-crafted body move an org's templates onto another tenant's type —
  // the same cross-tenant hole api/templates/template-type.ts closes on the
  // template write path.
  const [from, to] = await Promise.all([
    prisma.templateType.findFirst({ where: { id, organizationId: org.id }, select: { id: true } }),
    prisma.templateType.findFirst({ where: { id: toTypeId, organizationId: org.id }, select: { id: true, name: true } }),
  ])
  if (!from) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!to) return NextResponse.json({ error: "Unknown template type" }, { status: 400 })

  // TPL-2 step (1): `type: to.name` STOOD ALONGSIDE typeId HERE AND IS GONE.
  // It was written because the read sites rendered the legacy string, so
  // leaving it on the old type's name would have put them out of step with the
  // type the template now belongs to. They read `templateType.name` now, so
  // moving the FK moves what every site renders, and the string these rows
  // carry is left at whatever it was — unread while typeId is set.
  const result = await prisma.template.updateMany({
    where: { typeId: id, organizationId: org.id },
    data: { typeId: to.id },
  })

  return NextResponse.json({ reassigned: result.count, toTypeId: to.id, toTypeName: to.name })
}
