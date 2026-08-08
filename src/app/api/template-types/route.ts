import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../templates/access"
import { NextResponse } from "next/server"

// TPL-1a. The org's template taxonomy, for the Type select on the template
// form. READ ONLY in this phase — create/rename/recolor/delete is the Settings
// UI in TPL-1b and is not stubbed here.
//
// Gated by templates.manage, reusing /api/templates' guard rather than a new
// capability: templates.manage is ADMIN_ONLY (src/lib/permissions.ts:156) and
// settings.access is ADMIN_ONLY (:192), so ADMIN is the answer either way and
// no grid entry needed inventing (Gary, Q3, 2026-08-08). Sharing the guard also
// keeps this route and the form it feeds refusing in lockstep.
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
    select: { id: true, name: true, colorKey: true },
  })

  return NextResponse.json(types)
}
