import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { fetchSquareTeamMember } from "@/lib/square"

// HR-15: bring a terminated staff member back. Reactivation flips status to
// ACTIVE — it never creates a duplicate row and never touches signed records,
// form submissions, or training history (terminated-not-deleted stays
// inviolate; old signatures stand per the Fork-2 Policy-A decision). Any
// stale login link is cleared so the rehire re-links cleanly through the
// staff-directory invite flow — old logins stay dead. Same tier as terminate:
// ADMIN org-wide; MANAGER only for staff assigned to one of their own stores.

async function loadScopedMember(id: string) {
  const { orgId } = await auth()
  if (!orgId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { isAdmin, storeIds, role } = await getUserStoreScope()
  if (!isAdmin && role !== "MANAGER") {
    return { error: NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 }) }
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { error: NextResponse.json({ error: "Org not found" }, { status: 404 }) }

  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  // Cross-org or unknown IDs 404 — don't leak existence.
  if (!member) return { error: NextResponse.json({ error: "Staff member not found" }, { status: 404 }) }
  if (!isAdmin && !member.storeAssignments.some((a) => storeIds.includes(a.storeId))) {
    return { error: NextResponse.json({ error: "Staff member not found" }, { status: 404 }) }
  }
  return { member, org }
}

// Preflight for the reactivate dialog: is this member Square-linked, and does
// Square currently report them INACTIVE? The Fork-1 decision: the sync
// reconcile stays absolute-state (Square INACTIVE → terminated), so the
// dialog warns that a member left inactive in Square will be re-terminated on
// the next sync. Square unreachable → squareStatus null (dialog shows no
// warning rather than blocking the rehire).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadScopedMember(id)
  if ("error" in loaded) return loaded.error
  const { member, org } = loaded

  let squareStatus: string | null = null
  if (member.squareTeamMemberId && org.squareAccessToken) {
    try {
      const squareMember = await fetchSquareTeamMember(org, member.squareTeamMemberId)
      squareStatus = squareMember?.status ?? null
    } catch {
      // preflight is advisory only
    }
  }

  return NextResponse.json({
    squareLinked: !!member.squareTeamMemberId,
    squareStatus,
  })
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadScopedMember(id)
  if ("error" in loaded) return loaded.error
  const { member } = loaded

  if (member.status !== "TERMINATED") {
    return NextResponse.json({ error: "Staff member is not terminated" }, { status: 409 })
  }

  // Status flip only — records untouched. userId is cleared defensively for
  // rows terminated before terminateStaffMember unlinked inline (the webhook
  // path could miss), along with the dead login's store assignments.
  await prisma.$transaction([
    prisma.staffMember.update({
      where: { id: member.id },
      data: { status: "ACTIVE", terminatedAt: null, userId: null },
    }),
    ...(member.userId
      ? [prisma.storeUserAssignment.deleteMany({ where: { userId: member.userId } })]
      : []),
  ])

  return NextResponse.json({ success: true })
}
