import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../access"

// PATCH /api/hr/training/reorder — HR-29. Writes TrainingModule.orderIndex for
// the org's ACTIVE library in one transaction.
//
// ADMIN via requireHrTrainingAccess, the same guard the module routes use on
// their write paths (access.ts:11 — MANAGER and STORE are refused at the same
// line that already refuses them for create/edit/archive; no new gate, and no
// widened one). Every query below is org-scoped through the guard's resolved
// org, never a bare id lookup.
//
// GLOBAL, not per-category — Gary's ruling of 2026-08-24 (docs/DECISIONS.md).
// The payload carries no category and the endpoint never reads one.
const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

export async function PATCH(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { ids } = parsed.data

  // Duplicates first, because the completeness check below counts and a list
  // carrying the same id twice can satisfy a count while two positions collide.
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "Duplicate module ids" }, { status: 400 })
  }

  // THE SCOPE IS THE ORG'S FULL ACTIVE SET, STATED RATHER THAN INFERRED. The
  // list on /hr/training is filtered twice — by category chip and by tab — so
  // there is no view in the product that shows every module at once, and an
  // endpoint that wrote dense positions over whatever subset it was handed
  // would be writing a partial order it could not describe. One read of the
  // whole active scope answers all three questions at once: an id from another
  // org is absent, an archived or inactive id is absent, and a MISSING active
  // id shows up as a length mismatch. Any of them rejects the WHOLE request and
  // writes nothing.
  const active = await prisma.trainingModule.findMany({
    where: { organizationId: access.org.id, isActive: true, isArchived: false },
    select: { id: true },
  })
  const activeIds = new Set(active.map((m) => m.id))
  if (active.length !== ids.length || ids.some((id) => !activeIds.has(id))) {
    return NextResponse.json(
      { error: "ids must be exactly this organization's active modules" },
      { status: 400 }
    )
  }

  // updateMany rather than update, so organizationId sits in the WHERE even
  // though the check above already proved it. Belt and braces, and it matches
  // the bulk lifecycle PATCH in ../route.ts.
  await prisma.$transaction(
    ids.map((id, position) =>
      prisma.trainingModule.updateMany({
        where: { id, organizationId: access.org.id },
        data: { orderIndex: position },
      })
    )
  )

  // Return the new order read back from the database rather than echoing the
  // request, so an optimistic client can reconcile against what was actually
  // written. Same tie-break as every consuming surface.
  const modules = await prisma.trainingModule.findMany({
    where: { organizationId: access.org.id, isActive: true, isArchived: false },
    select: { id: true, title: true, orderIndex: true },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  })
  return NextResponse.json(modules)
}
