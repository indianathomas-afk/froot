import { prisma } from "@/lib/prisma"
import { writeAuditLog } from "@/lib/audit"
import { PIN_LOCK_MS, PIN_MAX_ATTEMPTS, lockMinutesLeft, verifyPinHash } from "@/lib/tablet-pin"

// TAB-4 (Gary, 2026-11-10) — ONE PIN ATTEMPT: reserve, compare, lock.
//
// THE ONLY CODE IN THE APP THAT READS StaffMember.pinHash (Gary's build
// requirement), and IMPORTED ONLY BY api/tablet-pin/verify/route.ts —
// scripts/verify-tab4-pin.ts asserts both. It is a library rather than inline
// in the route only so the fixture can drive it against real rows (Clerk's
// auth() does not run outside Next). The Prisma client omits pinHash everywhere
// (src/lib/prisma.ts); the `select: { pinHash: true }` below is the single
// opt-back-in. Everything else learns "has a PIN" from pinSetAt.
//
// THE LOCKOUT IS ATOMIC (Gary: "one conditional update, not a read then a
// write, so parallel attempts can't get past 5"):
//
//   1. RESERVE the attempt BEFORE comparing — one UPDATE … RETURNING that only
//      matches while pinFailedAttempts < 5 and the person is not locked. Five
//      parallel tries take slots 1–5; a sixth matches nothing and is refused.
//   2. Compare (crypto.timingSafeEqual inside verifyPinHash).
//   3. Right → counter back to 0. Wrong on slot 5 → a second conditional
//      UPDATE (pinFailedAttempts >= 5) sets the lock and zeroes the counter;
//      only one request can win it, so exactly one AuditLog lockout row.
//
// The counter is zeroed when the lock is set, so it is clean when the lock
// expires (Q9: "The count resets on a correct PIN or when the lock expires").
// Successful checks write nothing (Q9, too noisy).

export type PinAttemptResult =
  | { kind: "ok" }
  | { kind: "wrong"; triesLeft: number }
  | { kind: "locked"; minutes: number }

export async function attemptPin(args: {
  organizationId: string
  staffId: string
  storeId: string
  pin: string
  pepper: string
  /** For the lockout's AuditLog row (Clerk user id, the AuditLog convention). */
  clerkUserId: string | null
  staffName: string
  now?: Date
}): Promise<PinAttemptResult> {
  const { organizationId, staffId, storeId, pin, pepper, clerkUserId, staffName } = args
  const now = args.now ?? new Date()

  // 1. RESERVE (atomic). updateManyAndReturn is ONE `UPDATE … RETURNING`;
  // no match returns [] rather than throwing — a locked PIN is an ordinary
  // event, and `update` would log a prisma:error line for every one of them.
  const [reserved] = await prisma.staffMember.updateManyAndReturn({
    where: {
      id: staffId,
      organizationId,
      pinFailedAttempts: { lt: PIN_MAX_ATTEMPTS },
      OR: [{ pinLockedUntil: null }, { pinLockedUntil: { lte: now } }],
    },
    data: { pinFailedAttempts: { increment: 1 } },
    select: { pinFailedAttempts: true, pinHash: true },
  })
  if (!reserved) {
    // Nothing matched: locked, or every slot is taken.
    const cur = await prisma.staffMember.findFirst({
      where: { id: staffId, organizationId },
      select: { pinLockedUntil: true },
    })
    if (cur?.pinLockedUntil && cur.pinLockedUntil > now) {
      return { kind: "locked", minutes: lockMinutesLeft(cur.pinLockedUntil, now.getTime()) }
    }
    // Every slot taken but no lock yet — a request holds slot 5 and has not
    // finished (or died between its two statements). Lock now with the same
    // conditional update as step 3, so it still yields one row at most; a lock
    // always expires, so this state cannot stick.
    await lockOut({ organizationId, staffId, storeId, clerkUserId, staffName, now })
    return { kind: "locked", minutes: lockMinutesLeft(new Date(now.getTime() + PIN_LOCK_MS), now.getTime()) }
  }

  // 2. COMPARE (constant time).
  const right = reserved.pinHash ? await verifyPinHash(pin, reserved.pinHash, pepper) : false
  if (right) {
    await prisma.staffMember.updateMany({ where: { id: staffId, organizationId }, data: { pinFailedAttempts: 0 } })
    return { kind: "ok" }
  }

  // 3. WRONG.
  if (reserved.pinFailedAttempts >= PIN_MAX_ATTEMPTS) {
    await lockOut({ organizationId, staffId, storeId, clerkUserId, staffName, now })
    return { kind: "locked", minutes: lockMinutesLeft(new Date(now.getTime() + PIN_LOCK_MS), now.getTime()) }
  }
  return { kind: "wrong", triesLeft: PIN_MAX_ATTEMPTS - reserved.pinFailedAttempts }
}

/** Sets the lock only while the counter is full, and zeroes it in the same
 *  statement — whichever request gets here first wins and every other one
 *  matches nothing. One AuditLog row per lockout. */
async function lockOut(args: {
  organizationId: string
  staffId: string
  storeId: string
  clerkUserId: string | null
  staffName: string
  now: Date
}) {
  const until = new Date(args.now.getTime() + PIN_LOCK_MS)
  const set = await prisma.staffMember.updateMany({
    where: { id: args.staffId, organizationId: args.organizationId, pinFailedAttempts: { gte: PIN_MAX_ATTEMPTS } },
    data: { pinLockedUntil: until, pinFailedAttempts: 0 },
  })
  if (set.count === 1) {
    await writeAuditLog({
      organizationId: args.organizationId,
      userId: args.clerkUserId,
      action: "staff.pin.lockout",
      entityType: "StaffMember",
      entityId: args.staffId,
      metadata: {
        storeId: args.storeId,
        staffName: args.staffName,
        attempts: PIN_MAX_ATTEMPTS,
        lockedUntil: until.toISOString(),
      },
    })
  }
}
