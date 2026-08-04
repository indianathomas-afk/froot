import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"

const postSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  fullName: z.string().trim().max(200).nullish(),
  // Deliberately NOT .email() — the PATCH sibling validates the format, this
  // route never has, and tightening it here would fail Square-imported rows on
  // a data-quality problem that is not PERM-6's finding. Logged as out-of-scope.
  email: z.string().trim().max(320).nullish(),
  squareTeamMemberId: z.string().min(1).nullish(),
  storeIds: z.array(z.string().min(1)).default([]),
  primaryStoreId: z.string().min(1).nullish(),
})

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { isAdmin, storeIds, actor } = await getUserStoreScope()
  // PERM-2 §3 #3: matches the /staff pages (ADMIN/MANAGER). A STAFF-role user
  // has no need for a coworker directory — that information is in Square.
  if (!can(actor, "staff.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const staff = await prisma.staffMember.findMany({
    where: {
      organizationId: org.id,
      ...(isAdmin ? {} : { storeAssignments: { some: { storeId: { in: storeIds } } } }),
    },
    include: { storeAssignments: { include: { store: true } } },
    orderBy: { displayName: "asc" },
  })

  return NextResponse.json(staff)
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // PERM-2 §3 #3: this route was entirely unguarded — any org member could
  // create a staff record. Security fix, not a preference.
  const { isAdmin, storeIds: scopeStoreIds, actor } = await getUserStoreScope()
  if (!can(actor, "staff.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { displayName, fullName, email, squareTeamMemberId, primaryStoreId } = parsed.data

  // PERM-6 Task 1. Before this, storeIds flowed from the request body straight
  // into the nested storeAssignments.create with NO ownership query anywhere,
  // so a storeId belonging to ANOTHER ORGANISATION was accepted — cross-tenant,
  // not merely cross-store. Two checks, widest blast radius first:
  //   (1) org ownership — the floor, mirroring users/[id] PATCH;
  //   (2) caller scope — a non-admin may only assign stores they are themselves
  //       assigned to. Org membership is the floor, not the ceiling. This is
  //       PERM-2's deferred item.
  // Deduped first so a repeated id can neither inflate the count comparison nor
  // hit the assignment unique constraint.
  const storeIds = [...new Set(parsed.data.storeIds)]
  if (storeIds.length > 0) {
    const ownedCount = await prisma.store.count({
      where: { id: { in: storeIds }, organizationId: org.id },
    })
    if (ownedCount !== storeIds.length) {
      return NextResponse.json({ error: "One or more stores do not belong to this organization" }, { status: 400 })
    }
    if (!isAdmin && storeIds.some((id) => !scopeStoreIds.includes(id))) {
      return NextResponse.json({ error: "You can only assign stores you manage" }, { status: 403 })
    }
  }
  if (primaryStoreId && !storeIds.includes(primaryStoreId)) {
    return NextResponse.json({ error: "Primary store must be one of the assigned stores" }, { status: 400 })
  }

  // A manual add types the legal name directly → lock it. A Square import seeds
  // Full Name from Square (squareFullName), unlocked, so a later resync can
  // still track/adopt Square's value until an admin corrects it.
  const cleanFullName = (typeof fullName === "string" && fullName.trim()) || null
  const fromSquare = !!squareTeamMemberId

  const member = await prisma.staffMember.create({
    data: {
      organizationId: org.id,
      displayName,
      fullName: cleanFullName,
      fullNameLocked: !fromSquare && !!cleanFullName,
      squareFullName: fromSquare ? cleanFullName : null,
      email: (typeof email === "string" && email.trim()) || null,
      squareTeamMemberId: squareTeamMemberId || null,
      storeAssignments: {
        create: storeIds.map((storeId) => ({ storeId, isPrimary: storeId === primaryStoreId })),
      },
    },
    include: { storeAssignments: true },
  })

  return NextResponse.json(member, { status: 201 })
}
