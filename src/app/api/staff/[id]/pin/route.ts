import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { resolveSelfStaff } from "@/lib/hr"
import { writeAuditLog } from "@/lib/audit"
import { PIN_NOT_CONFIGURED, PIN_RE, hashPin, pinEnv } from "@/lib/tablet-pin"
import { decidePinAccess, staffLoginRole } from "@/lib/tablet-pin-access"

// TAB-4 (Gary, 2026-11-10, Q5) — SET OR RESET A STAFF MEMBER'S PIN.
//
// Its own route rather than a field on PATCH /api/staff/[id], so a PIN can
// never ride along with a name edit and its audit row is unambiguous.
//
// Gates: staff.manage (ADMIN + MANAGER, deniable per user), then the scope rule
// in src/lib/tablet-pin-access.ts — a MANAGER may set their own PIN and their
// stores' staff, never another MANAGER's or an ADMIN's.
//
// A reset is simply a new PIN (Q5 iv): there is no "show" and no "clear", and
// the response is `{ hasPin: true }` — never the PIN, never the hash. Setting a
// PIN also clears any lockout, since a manager standing there has just proved
// the person's identity another way.

const bodySchema = z.object({ pin: z.string().regex(PIN_RE, "A PIN is exactly 4 digits") })

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin, storeIds, role, actor, dbUser } = await getUserStoreScope()
  if (!dbUser || !can(actor, "staff.manage")) {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId }, select: { id: true } })
  if (!org || dbUser.organizationId !== org.id) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "A PIN is exactly 4 digits." }, { status: 400 })

  // Fail closed (Q4): no pepper, no PIN — never store an unpeppered hash.
  const env = pinEnv()
  if (!env.ok) return NextResponse.json({ error: PIN_NOT_CONFIGURED }, { status: 503 })

  const { id } = await params
  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    select: {
      id: true,
      displayName: true,
      userId: true,
      email: true,
      pinSetAt: true,
      storeAssignments: { select: { storeId: true } },
    },
  })
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })

  const self = role === "MANAGER" ? await resolveSelfStaff(org.id, dbUser) : null
  const decision = decidePinAccess(
    { role: role ?? "", isAdmin, storeIds, selfStaffId: self?.ok ? self.staffMember.id : null },
    {
      id: member.id,
      storeIds: member.storeAssignments.map((a) => a.storeId),
      loginRole: isAdmin ? null : await staffLoginRole(org.id, member),
    }
  )
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status })

  const pinHash = await hashPin(parsed.data.pin, env.pepper)
  await prisma.staffMember.update({
    where: { id: member.id },
    data: { pinHash, pinSetAt: new Date(), pinFailedAttempts: 0, pinLockedUntil: null },
    select: { id: true },
  })

  await writeAuditLog({
    organizationId: org.id,
    userId: userId ?? null,
    action: member.pinSetAt ? "staff.pin.reset" : "staff.pin.set",
    entityType: "StaffMember",
    entityId: member.id,
    metadata: { by: decision.by, staffName: member.displayName },
  })

  return NextResponse.json({ hasPin: true })
}
