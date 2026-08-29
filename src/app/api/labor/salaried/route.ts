import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"
import { canSeeWages } from "@/lib/labor-dashboard"
import { getUserStoreScope } from "@/lib/auth"
import { validateAllocationSet, seedWeeklyCostFromAnnual, FULL_ALLOCATION_BPS } from "@/lib/labor-salaried"
import { compVisibleForMember } from "@/lib/comp-confidential"

// R7-C — salaried people and their store allocations. ADMIN + MANAGER, PLUS the
// wage gate: these rows carry a person's weekly pay, so the same viewer who may
// not see a wage on the roster card may not read or write one here. That is the
// Q5 ruling of 2026-08-19 applied to a second surface rather than re-argued.
//
// THE UNIT OF WRITE IS THE PERSON (invariant 1). PUT takes a person AND their
// COMPLETE allocation set and replaces both in one transaction. There is no
// endpoint that edits a single (person, store) pair, which is what makes a
// half-edited person unreachable rather than merely validated against.
//
// weeklyCost IS SEEDED ONCE AND OWNED IN FROOT AFTER. On create, an omitted
// weeklyCost is derived from the caller-supplied annualRate (Square's mirrored
// figure, read by the CLIENT for display) via annualRate/52, and that annual
// figure is recorded in squareAnnualRateSeen. On update, weeklyCost is whatever
// the admin typed and Square cannot move it. NOTHING HERE READS THE MIRROR.

const allocationSchema = z.object({
  storeId: z.string().min(1),
  allocationBps: z.number().int().min(0).max(FULL_ALLOCATION_BPS),
})

const putSchema = z.object({
  squareTeamMemberId: z.string().min(1),
  displayName: z.string().trim().min(1).max(200),
  // Dollars per week. Omit on FIRST create to seed from annualRate instead.
  weeklyCost: z.number().nonnegative().max(1_000_000).optional(),
  // Square's mirrored annual figure. Used ONLY to seed weeklyCost on create and
  // to record squareAnnualRateSeen for divergence display. Never arithmetic.
  annualRate: z.number().nonnegative().max(100_000_000).nullable().optional(),
  weeklyHours: z.number().int().min(0).max(168),
  // NULL = not reviewed, true = outside allocation, false = explicitly included.
  exempt: z.boolean().nullable(),
  allocations: z.array(allocationSchema),
})

export async function GET() {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error
  const { actor } = await getUserStoreScope()
  if (!canSeeWages(ctx.org, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // COMP-1 ruling 6 — the flag lives on SquareTeamMemberWage and is read across
  // the shared (organizationId, squareTeamMemberId) key. Every wage row in the
  // org, not just the salaried ones: "no row" has to mean no row, because
  // absent FAILS CLOSED below.
  const [people, flags] = await Promise.all([
    prisma.laborSalariedPerson.findMany({
      where: { organizationId: ctx.org.id },
      orderBy: { displayName: "asc" },
      include: { allocations: { select: { storeId: true, allocationBps: true } } },
    }),
    prisma.squareTeamMemberWage.findMany({
      where: { organizationId: ctx.org.id },
      select: { squareTeamMemberId: true, compConfidential: true },
    }),
  ])
  const flagBySquareId = new Map(flags.map((f) => [f.squareTeamMemberId, f.compConfidential]))

  // Ruling 3 / Option B — THE TOTAL IS COMPUTED FROM THE REAL VALUES AND STAYS
  // VISIBLE. Masked numbers still feed it, which is the whole of Option B, and
  // it is computed here rather than summed in the browser because a browser
  // summing the masked rows below would silently under-report the estate by
  // exactly the confidential people's pay.
  const estateWeeklyTotal = people
    .filter((p) => p.exempt !== true && p.allocations.length > 0)
    .reduce((t, p) => t + Number(p.weeklyCost), 0)

  return NextResponse.json({
    estateWeeklyTotal,
    people: people.map((p) => {
      const visible = compVisibleForMember(actor, flagBySquareId.get(p.squareTeamMemberId))
      return {
        id: p.id,
        squareTeamMemberId: p.squareTeamMemberId,
        displayName: p.displayName,
        // ABSENT, NOT ZERO. null here is the same "no value in the payload" the
        // loader uses; the card draws the lock from compConfidential, never from
        // the null, so a masked person is not confused with an unentered one.
        weeklyCost: visible ? Number(p.weeklyCost) : null,
        weeklyHours: p.weeklyHours,
        exempt: p.exempt,
        squareAnnualRateSeen: !visible || p.squareAnnualRateSeen === null ? null : Number(p.squareAnnualRateSeen),
        compConfidential: flagBySquareId.get(p.squareTeamMemberId) !== false,
        allocations: p.allocations,
        totalBps: p.allocations.reduce((t, a) => t + a.allocationBps, 0),
      }
    }),
  })
}

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { actor } = await getUserStoreScope()
  if (!canSeeWages(ctx.org, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { squareTeamMemberId, displayName, weeklyCost, annualRate, weeklyHours, exempt, allocations } = parsed.data

  // COMP-1 — A HOLE THIS FEATURE ITSELF OPENS, CLOSED HERE.
  //
  // Masking weeklyCost on the GET means a MANAGER now sees a confidential
  // person's cost as blank. Blank is an editable state: without this check they
  // could not READ the salary but could OVERWRITE it, and would then watch the
  // estate total move by the difference — a write-side version of exactly the
  // subtraction ruling 3 accepted only as a read-side limitation.
  //
  // Ruling 2 is that confidential comp is ADMIN-only, and that governs the write
  // as well as the read: a figure you may not see is a figure you may not set.
  // The flag is read across the shared key and FAILS CLOSED (ruling 6), so a
  // person with no wage row is admin-only to write too.
  if (!ctx.isAdmin) {
    const flag = await prisma.squareTeamMemberWage.findUnique({
      where: { organizationId_squareTeamMemberId: { organizationId: ctx.org.id, squareTeamMemberId } },
      select: { compConfidential: true },
    })
    if (!compVisibleForMember(actor, flag?.compConfidential)) {
      return NextResponse.json(
        { error: "This person's compensation is confidential and is edited by an administrator." },
        { status: 403 }
      )
    }
  }

  // EXEMPT IS OUTSIDE THE SYSTEM, NOT ALLOCATED 0%. A person marked exempt who
  // also carries allocations is a contradiction, and it is refused rather than
  // silently resolved in either direction — dropping the allocations would throw
  // away typed data, honouring them would let an exempt person reach a forecast.
  if (exempt === true && allocations.length > 0) {
    return NextResponse.json(
      { error: "An exempt person is outside allocation entirely. Clear their store allocations first." },
      { status: 400 }
    )
  }

  const invalid = validateAllocationSet(allocations)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  // Every storeId is verified against the caller's org BEFORE any write.
  // Without this a caller could allocate onto another tenant's store, and the
  // unique key alone would accept it.
  if (allocations.length > 0) {
    const ids = allocations.map((a) => a.storeId)
    const count = await prisma.store.count({ where: { id: { in: ids }, organizationId: ctx.org.id } })
    if (count !== ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const existing = await prisma.laborSalariedPerson.findUnique({
    where: { organizationId_squareTeamMemberId: { organizationId: ctx.org.id, squareTeamMemberId } },
    select: { id: true },
  })

  // SEED-AND-OWN. weeklyCost is taken from the body when present; only on FIRST
  // create, and only when the body omits it, is it derived from annualRate/52.
  // After that Square can never move it — an update with no weeklyCost keeps the
  // stored one rather than re-deriving.
  const seeded = weeklyCost != null ? weeklyCost : annualRate != null ? seedWeeklyCostFromAnnual(annualRate) : null
  if (!existing && seeded == null) {
    return NextResponse.json({ error: "A weekly cost is required, or a Square annual rate to seed it from" }, { status: 400 })
  }

  const person = await prisma.$transaction(async (tx) => {
    const p = existing
      ? await tx.laborSalariedPerson.update({
          where: { id: existing.id },
          data: {
            displayName,
            weeklyHours,
            exempt,
            ...(weeklyCost != null ? { weeklyCost } : {}),
            // The mirror's last-seen annual figure is refreshed for DISPLAY only.
            ...(annualRate !== undefined ? { squareAnnualRateSeen: annualRate } : {}),
          },
        })
      : await tx.laborSalariedPerson.create({
          data: {
            organizationId: ctx.org.id,
            squareTeamMemberId,
            displayName,
            weeklyCost: seeded!,
            weeklyHours,
            exempt,
            squareAnnualRateSeen: annualRate ?? null,
          },
        })

    // THE WHOLE SET, ATOMICALLY. Delete-then-create inside the transaction, so
    // there is no moment at which a partially-written set is visible to a reader
    // and no path by which one store's share survives an edit it was not part of.
    await tx.laborSalariedAllocation.deleteMany({ where: { personId: p.id } })
    if (allocations.length > 0) {
      await tx.laborSalariedAllocation.createMany({
        data: allocations.map((a) => ({
          organizationId: ctx.org.id,
          personId: p.id,
          storeId: a.storeId,
          allocationBps: a.allocationBps,
        })),
      })
    }
    return p
  })

  // COMP-1 — THE WRITE ROUTE ECHOES A NUMBER TOO, AND IT IS A REAL LEAK PATH.
  // weeklyCost is optional on update: a MANAGER could PUT a confidential person
  // with the field omitted (keeping the stored value) and read the stored figure
  // straight back out of this response. Masked on the same rule as the GET.
  const echoVisible = compVisibleForMember(
    actor,
    (
      await prisma.squareTeamMemberWage.findUnique({
        where: { organizationId_squareTeamMemberId: { organizationId: ctx.org.id, squareTeamMemberId } },
        select: { compConfidential: true },
      })
    )?.compConfidential
  )
  return NextResponse.json({
    id: person.id,
    squareTeamMemberId,
    displayName,
    weeklyCost: echoVisible ? Number(person.weeklyCost) : null,
    weeklyHours,
    exempt,
    allocations,
  })
}

// DELETE ?squareTeamMemberId= — remove a person record entirely. Allocations
// cascade. This is "this person is not part of our salaried model", which is
// distinct from exempt ("reviewed, and deliberately outside it").
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { actor } = await getUserStoreScope()
  if (!canSeeWages(ctx.org, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const squareTeamMemberId = new URL(req.url).searchParams.get("squareTeamMemberId") ?? ""
  if (!squareTeamMemberId) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  // COMP-1 — SAME RULE AS THE PUT, AND DELETE NEEDS IT FOR THE SAME REASON.
  // Removing a confidential person drops their allocation, and the estate total
  // then falls by exactly their weekly pay: a manager who cannot read the figure
  // could still measure it by deleting the record and reading the difference.
  if (!ctx.isAdmin) {
    const flag = await prisma.squareTeamMemberWage.findUnique({
      where: { organizationId_squareTeamMemberId: { organizationId: ctx.org.id, squareTeamMemberId } },
      select: { compConfidential: true },
    })
    if (!compVisibleForMember(actor, flag?.compConfidential)) {
      return NextResponse.json(
        { error: "This person's compensation is confidential and is edited by an administrator." },
        { status: 403 }
      )
    }
  }

  const deleted = await prisma.laborSalariedPerson.deleteMany({
    where: { organizationId: ctx.org.id, squareTeamMemberId },
  })
  if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}
