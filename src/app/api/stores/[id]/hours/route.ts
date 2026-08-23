import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { denyUnlessStoresManage } from "../../access"
import { validateStoreHours } from "@/lib/store-hours-validate"

// CHK-2 (S2). THE FIRST WRITER StoreHours HAS EVER HAD.
//
// The table has existed since 20260627002005_init and nothing has ever written
// to it: `prisma.storeHours` appeared in exactly one place in the codebase, a
// read at src/lib/labor-plan.ts:170, and that file says so outright at :173-174
// ("StoreHours is currently never populated, so inference is the normal path").
// So labor's explicit-hours branch (labor-plan.ts:195-207) has been dead code
// for its whole life, and CHK-3's day close — which Gary's R2 makes
// StoreHours-driven — would have had no input on any branch. This route is that
// input. See docs/prompts/CHK-1_PLAN.md §3.1.
//
// NULL IS A REAL ANSWER HERE, AND IT IS THE DEFAULT. A day the operator has not
// decided about gets NO ROW — not a fabricated 9-to-5, not a placeholder. That
// is DEBT-59's principle (never write values nobody chose) at store scale, and
// it is also what both existing readers already expect: labor treats "no row"
// and "row with unusable times" identically and falls back to sales inference
// (labor-plan.ts:197-207). "Hours not set" therefore stays a queryable state —
// the absence of a row — rather than becoming indistinguishable from a real
// decision to open at nine.
//
// REPLACE, NOT UPSERT. THE PARAGRAPH THIS REPLACES WENT STALE AND IS CORRECTED
// HERE (BUG-14 recorder, 2026-08-23) RATHER THAN LEFT TO MISLEAD. It read
// "StoreHours carries no @@unique([storeId, dayOfWeek]) — verified at HEAD,
// prisma/schema.prisma:181". That was true when S2 wrote it and is FALSE NOW:
// CHK-3 added the constraint on 2026-08-09 and it sits at
// prisma/schema.prisma:255, where the schema's own note records the change. A
// false comment beside the code it describes is how the next reader gets the
// behaviour backwards.
//
// THE CODE BELOW IS UNCHANGED AND IS STILL CORRECT — only the reason moved. The
// replace was originally forced by the ABSENCE of the key: `upsert` had nothing
// to target and the table could already hold two rows for one weekday. With the
// constraint in place the duplicate is unrepresentable, and the whole-week
// replace inside one transaction remains the right write because this endpoint
// receives the whole week and a day dropped from the payload must disappear —
// which an upsert loop would silently leave behind. Same shape as the closest
// existing per-store set-write, api/labor/day-hours/route.ts PUT.

// 24-hour "HH:MM" — the format <input type="time"> emits and the format
// labor-plan.ts's parseHourStart/parseHourEnd already read.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const timeField = z
  .string()
  .regex(TIME_RE, "Times must be HH:MM (24-hour)")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null))

const putSchema = z.object({
  hours: z
    .array(
      z.object({
        // 0 Sun .. 6 Sat — the JS convention, because that is what the two
        // existing readers index by: labor-plan.ts:194-195 matches against
        // jsDowOf(), and (app)/stores/page.tsx treats 0 as Sunday and 6 as
        // Saturday. Changing it here would silently misfile every row.
        dayOfWeek: z.number().int().min(0).max(6),
        openingTime: timeField,
        closingTime: timeField,
        isClosed: z.boolean().default(false),
      })
    )
    .max(7),
})

// GET — this store's hours. Deliberately NOT gated on a capability, matching
// GET /api/stores, which has never had a role check and serves any org member
// by design (see the comment in api/stores/access.ts): the same rows already
// reach every caller through that endpoint's `include: { hours: true }`, so
// gating them here would restrict nothing and only disagree with the endpoint
// next to it. Org ownership is still checked first, and it is the check that
// matters — PERM-2/PERM-6: org ownership, then caller scope.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { id } = await params
  // Cross-org and unknown ids both 404 — don't leak existence.
  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const hours = await prisma.storeHours.findMany({
    where: { storeId: store.id },
    orderBy: { dayOfWeek: "asc" },
  })
  return NextResponse.json({ hours })
}

// PUT — replace this store's whole week. stores.manage (ADMIN_ONLY), the same
// gate as every other write on this resource; no new capability.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessStoresManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { id } = await params
  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fields", details: parsed.error.flatten() }, { status: 400 })
  }

  const submitted = parsed.data.hours
  if (new Set(submitted.map((h) => h.dayOfWeek)).size !== submitted.length) {
    return NextResponse.json({ error: "Duplicate day" }, { status: 400 })
  }

  // THE SECOND CALL SITE, AND IT IS THE POINT. The dialog runs the same
  // validateStoreHours and disables Save on the same list, but a form-only check
  // is not a check — BUG-11/BUG-12 are the precedent for the editor and the
  // write path drifting apart because each carried its own copy of the rule.
  // One module, both ends.
  //
  // BLOCKING ONLY. Warnings are computed here too and deliberately DISCARDED:
  // they are not persisted, there is no column and no flag, and a warned save
  // must succeed. A store open three hours on a Tuesday is Rohan's, not an
  // error, and R7-C's shape is to raise a visible flag and never normalise.
  const { blocking } = validateStoreHours(
    submitted.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      openingTime: h.openingTime ?? null,
      closingTime: h.closingTime ?? null,
      isClosed: h.isClosed,
    }))
  )
  if (blocking.length > 0) {
    return NextResponse.json(
      { error: blocking[0].reason, details: { blocking } },
      { status: 400 }
    )
  }

  // A day carries a decision when it is marked closed, or when at least one
  // time is filled in. Anything else is genuinely blank and is persisted as the
  // ABSENCE of a row rather than as a row full of nulls — same meaning to both
  // readers, and it keeps "never been set" and "set, then cleared" from drifting
  // into two different-looking states.
  //
  // A closed day KEEPS whatever times were typed. They are values the operator
  // chose, unchecking the box has to give them back, and no reader looks at them
  // while isClosed is true (labor-plan.ts:199).
  //
  // NO ORDERING CHECK on open vs close: a store that closes at 02:00 is a real
  // store, and the day-close design handles it explicitly (plan §3.5, the
  // `closingTime <= openingTime` row). Rejecting it here would make an overnight
  // store unrepresentable.
  const rows = submitted.filter((h) => h.isClosed || h.openingTime || h.closingTime)

  await prisma.$transaction([
    prisma.storeHours.deleteMany({ where: { storeId: store.id } }),
    ...rows.map((h) =>
      prisma.storeHours.create({
        data: {
          storeId: store.id,
          dayOfWeek: h.dayOfWeek,
          openingTime: h.openingTime ?? null,
          closingTime: h.closingTime ?? null,
          isClosed: h.isClosed,
        },
      })
    ),
  ])

  const hours = await prisma.storeHours.findMany({
    where: { storeId: store.id },
    orderBy: { dayOfWeek: "asc" },
  })
  return NextResponse.json({ ok: true, hours })
}
