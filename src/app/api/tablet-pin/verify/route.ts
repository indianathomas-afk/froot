import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { resolveTaskLogStaff } from "@/lib/task-log-staff"
import { PIN_NOT_CONFIGURED, PIN_RE, pinEnv, signPinToken } from "@/lib/tablet-pin"
import { attemptPin } from "@/lib/tablet-pin-attempt"

// TAB-4 (Gary, 2026-11-10) — CHECK A PIN, HAND BACK A 10-MINUTE TOKEN.
//
// The one route that reads a PIN hash, through src/lib/tablet-pin-attempt.ts
// (imported by nothing else). The reserve → compare → lock sequence and why it
// is atomic are documented there.
//
// The token it returns is bound to the person, the store, the org and THIS
// login (Q8), and is what POST /api/checklists/[id]/task-log and
// POST /api/calendar/occurrences/[id]/complete require from a STORE login
// while the switch is on (src/lib/tablet-pin-gate.ts).

const bodySchema = z.object({
  staffId: z.string().min(1),
  storeId: z.string().min(1),
  pin: z.string(),
})

export async function POST(req: Request) {
  const { orgId, userId: clerkUserId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, tabletPinRequired: true },
  })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { staffId, storeId, pin } = parsed.data

  const { isAdmin, storeIds, dbUser } = await getUserStoreScope()
  if (!dbUser || dbUser.organizationId !== org.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // A PIN only means something while the switch is on; off, there is nothing to
  // unlock, so this does not stand open as a PIN oracle.
  if (!org.tabletPinRequired) {
    return NextResponse.json({ error: "PINs aren't switched on for this organization." }, { status: 409 })
  }
  const env = pinEnv()
  if (!env.ok) return NextResponse.json({ error: PIN_NOT_CONFIGURED, code: "pin_not_configured" }, { status: 503 })

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id }, select: { id: true } })
  if (!store || (!isAdmin && !storeIds.includes(store.id))) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 })
  }

  // CHK-15's rules, unchanged: in the org, ACTIVE, assigned here or corporate.
  // A token is only ever minted for a name the gated routes would accept.
  const resolved = await resolveTaskLogStaff({ organizationId: org.id, storeId: store.id, staffId })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })
  if (!resolved.staffId) return NextResponse.json({ error: "Choose your name first." }, { status: 400 })

  const member = await prisma.staffMember.findFirst({
    where: { id: resolved.staffId, organizationId: org.id },
    select: { id: true, displayName: true, pinSetAt: true },
  })
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (!member.pinSetAt) {
    return NextResponse.json({ error: `${member.displayName} has no PIN yet — ask a manager.` }, { status: 409 })
  }
  // A malformed entry is not a guess, so it costs no attempt.
  if (!PIN_RE.test(pin)) return NextResponse.json({ error: "Enter all 4 digits." }, { status: 400 })

  const now = new Date()
  const result = await attemptPin({
    organizationId: org.id,
    staffId: member.id,
    storeId: store.id,
    pin,
    pepper: env.pepper,
    clerkUserId: clerkUserId ?? null,
    staffName: member.displayName,
    now,
  })

  if (result.kind === "ok") {
    const token = signPinToken(
      { staffId: member.id, storeId: store.id, orgId: org.id, userId: dbUser.id },
      env.tokenSecret,
      now.getTime()
    )
    return NextResponse.json({ token, staffId: member.id, displayName: member.displayName })
  }
  if (result.kind === "locked") {
    const m = result.minutes
    return NextResponse.json(
      {
        error: `Too many wrong PINs. ${member.displayName} is locked — try again in ${m} minute${m === 1 ? "" : "s"}, or ask a manager to reset the PIN.`,
        code: "pin_locked",
      },
      { status: 429 }
    )
  }
  const left = result.triesLeft
  return NextResponse.json(
    {
      error: `That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left before ${member.displayName} is locked for 5 minutes.`,
      code: "pin_wrong",
    },
    { status: 401 }
  )
}
