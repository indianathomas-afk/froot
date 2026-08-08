import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../../templates/access"
import { TemplateTypeSchema, findNameConflict, isUniqueViolation } from "../shared"
import { NextResponse } from "next/server"

// TPL-1b. Rename, recolor, reorder and delete for one template type.
//
// EVERY lookup is scoped with organizationId, not just the first one — a type
// id from another org must be indistinguishable from one that does not exist.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { id } = await params
  const existing = await prisma.templateType.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = TemplateTypeSchema.partial().safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const data = parsed.data

  if (data.name !== undefined) {
    const conflict = await findNameConflict(org.id, data.name, id)
    if (conflict) {
      return NextResponse.json({ error: `A type called "${conflict.name}" already exists` }, { status: 409 })
    }
  }

  try {
    // A RENAME MUST CARRY Template.type (the legacy string) WITH IT. Five of the
    // six read sites render that string and not the joined row
    // (docs/prompts/TYPE-1_AUDIT.md §3.1), so a rename that touched only
    // TemplateType would leave the detail page, both print sheets, the
    // checklist pill and the execution header showing the old word. Both
    // columns move together, in one transaction, exactly as POST and PATCH
    // /api/templates already do.
    //
    // THIS REWRITES HISTORY, KNOWINGLY. Checklist holds no snapshot of the type
    // (audit §3.4), so historical completed checklists and their print copies
    // re-render under the new name. That is DEBT-36's accepted class — ruled
    // 2026-08-07 for section names — not a new trade, and the UI confirms with
    // the affected count before it fires.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.templateType.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.colorKey !== undefined && { colorKey: data.colorKey }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        },
        select: { id: true, name: true, colorKey: true, sortOrder: true, _count: { select: { templates: true } } },
      })

      if (data.name !== undefined && data.name !== existing.name) {
        await tx.template.updateMany({
          where: { typeId: id, organizationId: org.id },
          data: { type: data.name },
        })
      }

      return row
    })

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      colorKey: updated.colorKey,
      sortOrder: updated.sortOrder,
      templateCount: updated._count.templates,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "A type with that name already exists" }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { id } = await params
  const existing = await prisma.templateType.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Gary, Q2, 2026-08-08: BLOCK while in use, with the count, and offer
  // reassignment as a separate act. Never cascade-to-null — that would
  // reintroduce templates with no type, which is the defect this whole row
  // exists to end. 409 with a count matches the IngredientCategory precedent
  // (api/inventory/ingredient-categories/[id]/route.ts), and the FK's
  // ON DELETE RESTRICT is the backstop behind this check rather than the
  // message the operator sees.
  //
  // Counts EVERY template, archived included — an archived template still holds
  // the FK and still trips RESTRICT.
  const templateCount = await prisma.template.count({ where: { typeId: id, organizationId: org.id } })
  if (templateCount > 0) {
    return NextResponse.json(
      {
        error: `${templateCount} template${templateCount === 1 ? "" : "s"} still use this type — reassign them first`,
        templateCount,
      },
      { status: 409 }
    )
  }

  // THE BACKSTOP DOES NOT LOOK LIKE THE PRE-CHECK, measured on dev
  // (br-broad-wave-a6vpjdw0) 2026-08-08. If a template is assigned to this type
  // between the count above and this delete, Postgres refuses and Prisma 7 with
  // the Neon driver adapter throws a `DriverAdapterError` carrying NO `.code`
  // — unlike a unique violation, which does arrive as P2002. So that race
  // surfaces as a 500, not a 409, and isUniqueViolation()-style code sniffing
  // would never catch it. Left deliberately: catching a bare DriverAdapterError
  // here would swallow every other database failure on this line to dress up a
  // race that the pre-check already makes vanishingly rare.
  await prisma.templateType.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
