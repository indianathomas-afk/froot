import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth"
import { findStaffMemberForUser } from "@/lib/hr"

const patchSchema = z.object({
  role: z.enum(["ADMIN", "MANAGER", "STORE", "STAFF"]),
  storeIds: z.array(z.string()).default([]),
})

// Clerk memberships only distinguish admin vs member — MANAGER / STORE / STAFF
// all map to org:member and are distinguished only in the Froot DB. See the
// UM-1 role-mapping truth table in docs/DECISIONS.md.
function clerkRoleFor(role: string): "org:admin" | "org:member" {
  return role === "ADMIN" ? "org:admin" : "org:member"
}

// PATCH: update role and/or store assignments for a DB user.
// Clerk is the source of truth for roles: the org membership role is updated
// FIRST, and the Froot row is only written if that succeeds.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let caller
  try {
    caller = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { role, storeIds } = parsed.data

  const existing = await prisma.user.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) {
    return NextResponse.json({ error: "User not found in this organization" }, { status: 404 })
  }

  // Self-role-change is blocked outright: combined with the last-admin guard
  // it is the lockout path (an admin demoting themselves).
  if (caller.id === existing.id) {
    return NextResponse.json({ error: "You cannot change your own role" }, { status: 403 })
  }

  // Store assignments must belong to this org.
  if (storeIds.length > 0) {
    const ownedCount = await prisma.store.count({
      where: { id: { in: storeIds }, organizationId: org.id },
    })
    if (ownedCount !== storeIds.length) {
      return NextResponse.json({ error: "One or more stores do not belong to this organization" }, { status: 400 })
    }
  }

  // Last-admin guard: the org must never be left without an ADMIN.
  if (existing.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await prisma.user.count({
      where: { organizationId: org.id, role: "ADMIN" },
    })
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot demote the only admin. Promote another user to Admin first." },
        { status: 409 }
      )
    }
  }

  // STAFF users are person-scoped throughout HR: demotion to STAFF requires a
  // linked (or linkable-by-email), ACTIVE staff profile.
  if (role === "STAFF") {
    const staff = await findStaffMemberForUser(org.id, { id: existing.id, email: existing.email })
    const blocked =
      !staff ||
      staff.status !== "ACTIVE" ||
      (staff.userId !== null && staff.userId !== existing.id)
    if (blocked) {
      return NextResponse.json(
        { error: "No active staff profile is linked to this user. Invite them from the Staff directory instead." },
        { status: 409 }
      )
    }
    if (staff.userId === null) {
      // Email-matched but not yet linked — bind it now. userId: null guard so
      // an existing link is never stolen (HR-7 pattern); a lost race blocks.
      const linked = await prisma.staffMember.updateMany({
        where: { id: staff.id, organizationId: org.id, userId: null },
        data: { userId: existing.id },
      })
      if (linked.count === 0) {
        return NextResponse.json(
          { error: "No active staff profile is linked to this user. Invite them from the Staff directory instead." },
          { status: 409 }
        )
      }
    }
  }

  // Sync the Clerk org membership role before touching the Froot row. Skipped
  // when the mapped role already matches (all transitions within
  // MANAGER/STORE/STAFF are org:member → org:member).
  const clerk = await clerkClient()
  let memberships
  try {
    memberships = await clerk.users.getOrganizationMembershipList({ userId: existing.clerkUserId })
  } catch {
    return NextResponse.json({ error: "Failed to read the Clerk membership — role not changed" }, { status: 502 })
  }
  const membership = memberships.data.find((m) => m.organization.id === orgId)
  if (!membership) {
    return NextResponse.json({ error: "User has no Clerk membership in this organization" }, { status: 409 })
  }
  const targetClerkRole = clerkRoleFor(role)
  if (membership.role !== targetClerkRole) {
    try {
      await clerk.organizations.updateOrganizationMembership({
        organizationId: orgId,
        userId: existing.clerkUserId,
        role: targetClerkRole,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update the Clerk membership role"
      return NextResponse.json({ error: `${msg} — role not changed` }, { status: 502 })
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      role,
      storeAssignments: {
        deleteMany: {},
        create: storeIds.map((storeId: string) => ({ storeId })),
      },
    },
    include: { storeAssignments: { include: { store: true } } },
  })

  return NextResponse.json(user)
}

// DELETE: remove a member from the org and delete their Clerk account.
// NOTE (UM-1, follow-up logged for HR-14): deleteUser removes the Clerk
// account GLOBALLY, not just this org's membership — left as-is this session.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let caller
  try {
    caller = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params // this is the Clerk user ID

  if (caller.clerkUserId === id) {
    return NextResponse.json({ error: "You cannot remove your own account" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })

  // Last-admin guard, mirrored from PATCH: removing the only ADMIN would
  // orphan the org.
  if (org) {
    const target = await prisma.user.findFirst({
      where: { clerkUserId: id, organizationId: org.id },
    })
    if (target?.role === "ADMIN") {
      const adminCount = await prisma.user.count({
        where: { organizationId: org.id, role: "ADMIN" },
      })
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the only admin. Promote another user to Admin first." },
          { status: 409 }
        )
      }
    }
  }

  const clerk = await clerkClient()

  try {
    await clerk.organizations.deleteOrganizationMembership({ organizationId: orgId, userId: id })
  } catch {
    // membership may not exist; continue
  }

  try {
    await clerk.users.deleteUser(id)
  } catch {
    // user may not exist or may belong to another org; continue
  }

  // Also remove from DB if present
  if (org) {
    await prisma.user.deleteMany({ where: { clerkUserId: id, organizationId: org.id } })
  }

  return NextResponse.json({ success: true })
}
