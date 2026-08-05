import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth"
import { ENFORCED_CAPABILITIES, can, isCapability, type Capability } from "@/lib/permissions"
import { findStaffMemberForUser } from "@/lib/hr"
import { validateDefaultStore } from "@/lib/default-store"

// PERM-5C. Derived from the grid list, never maintained beside it — a second
// hand-written list would be one append away from disagreeing with the UI, and
// the disagreement would show up as a toggle that 400s.
const DENIABLE = new Set<Capability>(ENFORCED_CAPABILITIES.map((e) => e.capability))

const patchSchema = z.object({
  role: z.enum(["ADMIN", "MANAGER", "STORE", "STAFF"]),
  storeIds: z.array(z.string()).default([]),
  // BUILD-2. Nullish, not optional-with-default: null is a meaningful value
  // (clear the default, restore alphabetically-first) and must be
  // distinguishable from "not sent".
  defaultStoreId: z.string().min(1).nullish(),
  // PERM-5. Optional, not defaulted: absent means "this caller did not touch
  // overrides" and the stored set is left alone, matching defaultStoreId's
  // reasoning above. Validated against the registry below, not here, so the
  // 400 can name what was wrong.
  deniedCapabilities: z.array(z.string()).optional(),
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
  const { role, storeIds, defaultStoreId, deniedCapabilities } = parsed.data

  // PERM-5. Three rules, and they fail differently on purpose.
  //
  // An UNREGISTERED capability is a 400: it is a client bug or a hand-rolled
  // request, and storing it would put a string in the column that can() can
  // never match — a denial that silently does nothing forever.
  //
  // PERM-5C. A registered capability that is NOT IN THE GRID is also a 400 —
  // THE GRID LIST IS THE DENIABLE LIST. Session C migrates several capabilities
  // onto can() that are deliberately held out of ENFORCED_CAPABILITIES because
  // denying them would hide a nav entry and a page while an API kept answering:
  // stores.view (GET /api/stores is the shared store-list endpoint every page
  // uses and serves any member by design), dashboard.view (the redirect target
  // problem at (app)/dashboard/page.tsx), settings.access, labor.manage. The
  // grid cannot produce those denials. Without this check a hand-rolled request
  // still could, and the result would be the PERM-2 bug class made expressible
  // INVISIBLY — no toggle to see it by, no screen that shows it on. 400 rather
  // than a silent drop, deliberately, and for the same reason as the
  // unregistered case above: nothing legitimate sends one, so a caller that
  // does is wrong and should be told, not quietly humoured into believing the
  // denial took. A capability leaving this state is a one-line append to
  // ENFORCED_CAPABILITIES — the same one place Session C already grows.
  //
  // A denial of a capability the RESULTING role does not grant is DROPPED, not
  // rejected. It is a no-op today (the ceiling already denies it) and a
  // landmine tomorrow: promote the user later and they would silently lack
  // something their new role grants, with nothing on screen to explain why.
  // Filtered against the role this request WILL PRODUCE — the same discipline
  // validateDefaultStore uses below, and the answer to "does a role change
  // clear stored denials?": yes, for exactly the denials the new role does not
  // grant. Everything else survives the role change untouched.
  let nextDenied: Capability[] | undefined
  if (deniedCapabilities !== undefined) {
    const unknown = deniedCapabilities.filter((c) => !isCapability(c))
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown capability: ${unknown.join(", ")}` },
        { status: 400 }
      )
    }
    const registered = [...new Set(deniedCapabilities.filter(isCapability))]
    const notDeniable = registered.filter((c) => !DENIABLE.has(c))
    if (notDeniable.length > 0) {
      return NextResponse.json(
        { error: `Capability is not individually deniable: ${notDeniable.join(", ")}` },
        { status: 400 }
      )
    }
    nextDenied = registered.filter((c) => can({ role }, c))
  }

  const existing = await prisma.user.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) {
    return NextResponse.json({ error: "User not found in this organization" }, { status: 404 })
  }

  // Self-role-change is blocked outright: combined with the last-admin guard
  // it is the lockout path (an admin demoting themselves).
  //
  // PERM-5 self-lockout: THIS LINE IS ALSO THE OVERRIDE GUARD, and no second
  // one was added. It refuses the whole request when caller === target, so an
  // admin cannot deny themselves anything through this route at all. Nothing
  // in the current grid could strand an admin even if they could — users.manage
  // is not load-bearing yet (/users and this route both use requireAdmin, not
  // can()). SESSION C REQUIREMENT: when users.manage is migrated onto can() and
  // added to ENFORCED_CAPABILITIES, re-check this — at that point a denial of
  // users.manage becomes capable of locking an admin out of user management,
  // and the guard that saves them is this early return.
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

  // BUILD-2. Validated against the set this request WILL PRODUCE, and the role
  // it WILL PRODUCE — not the rows in the database now. This route replaces
  // role, assignments and default together, so checking the current state would
  // reject a legitimate "add store B and default to B" and would accept a
  // default on store A in a request that removes store A. Same reasoning as
  // PERM-6's primaryStoreId check (api/staff/[id]/route.ts:87-93).
  if (defaultStoreId !== undefined) {
    const check = await validateDefaultStore({
      organizationId: org.id,
      defaultStoreId,
      isAdmin: role === "ADMIN",
      resultingStoreIds: storeIds,
    })
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
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
      // Omitted when the client didn't send the field, so a caller that only
      // changes the role cannot silently clear a default it never mentioned.
      ...(defaultStoreId !== undefined ? { defaultStoreId } : {}),
      // Same omit-when-unsent rule as defaultStoreId: a caller that only
      // changes the role must not silently clear overrides it never mentioned.
      ...(nextDenied !== undefined ? { deniedCapabilities: nextDenied } : {}),
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
