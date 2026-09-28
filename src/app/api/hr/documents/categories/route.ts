import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../access"
import { DocumentCategorySchema, findNameConflict, isUniqueViolation } from "./shared"

// DOC-5. The org's document taxonomy — list and create for the Manage
// Categories dialog. Copied from api/hr/training/categories/route.ts.
//
// ADMIN only (F5), via the same guard every document-configuration route uses.
// A STATIC segment, so Next resolves it ahead of the sibling [id] route.
// Every query is scoped to the caller's org — never a bare id lookup.

export async function GET() {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const categories = await prisma.hrDocumentCategory.findMany({
    where: { organizationId: access.org.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      colorKey: true,
      sortOrder: true,
      // Org-wide, archived-inclusive, and counting forms too: this count
      // governs deletion, and every such row holds the FK. The library's filter
      // chips count per-view, client-side — two counts, deliberately different
      // (TPL-1's ruling, carried through HR-20).
      _count: { select: { documents: true } },
    },
  })

  return NextResponse.json(
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      colorKey: c.colorKey,
      sortOrder: c.sortOrder,
      documentCount: c._count.documents,
    }))
  )
}

export async function POST(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = DocumentCategorySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const conflict = await findNameConflict(access.org.id, parsed.data.name)
  if (conflict) {
    return NextResponse.json({ error: `A category called "${conflict.name}" already exists` }, { status: 409 })
  }

  try {
    const created = await prisma.hrDocumentCategory.create({
      data: {
        organizationId: access.org.id,
        name: parsed.data.name,
        colorKey: parsed.data.colorKey,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
      select: { id: true, name: true, colorKey: true, sortOrder: true },
    })
    return NextResponse.json({ ...created, documentCount: 0 }, { status: 201 })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 })
    }
    throw err
  }
}
