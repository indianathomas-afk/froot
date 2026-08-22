import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"
import { canSeeWages } from "@/lib/labor-dashboard"
import { getUserStoreScope } from "@/lib/auth"
import { validateAllocationSet, seedWeeklyCostFromAnnual, FULL_ALLOCATION_BPS } from "@/lib/labor-salaried"

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

  const people = await prisma.laborSalariedPerson.findMany({
    where: { organizationId: ctx.org.id },
    orderBy: { displayName: "asc" },
    include: { allocations: { select: { storeId: true, allocationBps: true } } },
  })
  return NextResponse.json(
    people.map((p) => ({
      id: p.id,
      squareTeamMemberId: p.squareTeamMemberId,
      displayName: p.displayName,
      weeklyCost: Number(p.weeklyCost),
      weeklyHours: p.weeklyHours,
      exempt: p.exempt,
      squareAnnualRateSeen: p.squareAnnualRateSeen === null ? null : Number(p.squareAnnualRateSeen),
      allocations: p.allocations,
      totalBps: p.allocations.reduce((t, a) => t + a.allocationBps, 0),
    }))
  )
}

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const { actor } = await getUserStoreScope()
  if (!canSeeWages(ctx.org, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { squareTeamMemberId, displayName, weeklyCost, annualRate, weeklyHours, exempt, allocations } = parsed.data

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

  return NextResponse.json({ id: person.id, squareTeamMemberId, displayName, weeklyCost: Number(person.weeklyCost), weeklyHours, exempt, allocations })
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

  const deleted = await prisma.laborSalariedPerson.deleteMany({
    where: { organizationId: ctx.org.id, squareTeamMemberId },
  })
  if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}
