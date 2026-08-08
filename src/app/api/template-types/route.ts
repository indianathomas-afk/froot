import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../templates/access"
import { TemplateTypeSchema, findNameConflict, isUniqueViolation } from "./shared"
import { NextResponse } from "next/server"

// TPL-1a/1b. The org's template taxonomy.
//
// Gated by templates.manage, reusing /api/templates' guard rather than a new
// capability: templates.manage is ADMIN_ONLY (src/lib/permissions.ts) and
// settings.access is ADMIN_ONLY too, so ADMIN is the answer either way and no
// grid entry needed inventing (Gary, Q3, 2026-08-08). Sharing the guard also
// keeps this route and the templates surface it serves refusing in lockstep.
export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const types = await prisma.templateType.findMany({
    where: { organizationId: org.id, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      colorKey: true,
      sortOrder: true,
      // TPL-1b (Gary, Q1, 2026-08-08): the use count is computed HERE, not in
      // the client, and it counts EVERY template — archived included. The
      // manage dialog's client only ever holds one of the Active/Archived
      // views at a time, so a client-derived count would read 0 for a type used
      // only by archived templates, enable delete, and then eat the 409 that
      // ON DELETE RESTRICT produces. Server-side is the only place the whole
      // set is in scope.
      _count: { select: { templates: true } },
    },
  })

  return NextResponse.json(
    types.map((t) => ({
      id: t.id,
      name: t.name,
      colorKey: t.colorKey,
      sortOrder: t.sortOrder,
      templateCount: t._count.templates,
    }))
  )
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // safeParse, not parse. The precedent routes
  // (api/inventory/ingredient-categories) call `Schema.parse(body)` bare, so a
  // malformed body throws and surfaces as a 500 — see the comment left on that
  // file. Names here are user-typed, so bad input is ordinary, not exceptional.
  const parsed = TemplateTypeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const conflict = await findNameConflict(org.id, parsed.data.name)
  if (conflict) {
    return NextResponse.json({ error: `A type called "${conflict.name}" already exists` }, { status: 409 })
  }

  try {
    const created = await prisma.templateType.create({
      data: {
        organizationId: org.id,
        name: parsed.data.name,
        colorKey: parsed.data.colorKey,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
      select: { id: true, name: true, colorKey: true, sortOrder: true },
    })
    return NextResponse.json({ ...created, templateCount: 0 }, { status: 201 })
  } catch (err) {
    // The case-insensitive pre-check above cannot close the race; the DB
    // constraint can, and this is what turns it into an ordinary 409.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "A type with that name already exists" }, { status: 409 })
    }
    throw err
  }
}
