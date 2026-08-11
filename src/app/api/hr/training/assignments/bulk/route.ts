import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingManageAccess } from "../../access"
import {
  RECIPIENT_SELECT,
  type RecipientMember,
  applicabilityCheck,
  loadAssignableModule,
} from "./shared"

const bodySchema = z.object({
  trainingModuleId: z.string().min(1),
  recipients: z.object({
    mode: z.enum(["selection", "all-in-scope"]),
    staffMemberIds: z.array(z.string().min(1)).max(500).optional(),
    storeIds: z.array(z.string().min(1)).max(100).optional(),
  }),
  trainerUserId: z.string().min(1).nullish(),
  dueDate: z.string().datetime().nullish(),
})

type Outcome =
  | "assigned"
  | "already-assigned"
  | "terminated"
  | "not-applicable"
  | "corporate-excluded"

// POST /api/hr/training/assignments/bulk — HR-22. One module × many recipients,
// the inverse of the single-assign path's one person × many modules.
//
// THE RESPONSE SUMS TO ITS INPUT (ruling 4, CHK-3's counter lesson). Five
// mutually exclusive buckets over `requested` — the deduplicated roster this
// request NAMES after expansion. `{ created, skipped }` on the single path is
// the shape to copy FROM, not to copy: ids dropped by its own filter vanish
// from its arithmetic.
//
// IDENTITY ERRORS REFUSE, ELIGIBILITY RULES SKIP-AND-REPORT (ruled 2026-08-11).
// An unknown, foreign, or out-of-scope id fails the whole request before
// anything is written — it is a client bug or an attack, not an ordinary skip —
// so nothing that was written down can drop out of the arithmetic. Terminated,
// corporate, not-applicable and already-assigned are ordinary outcomes and are
// each a named count.
export async function POST(req: Request) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { trainingModuleId, recipients, trainerUserId, dueDate } = parsed.data

  const loaded = await loadAssignableModule(trainingModuleId, access.org.id)
  if (!loaded.ok) return loaded.response
  const { trainingModule } = loaded

  // "All in scope" is a DEFINED population, not a seed to add to: ids sent
  // alongside it are ignored rather than quietly widening it, so the mode in
  // the request always describes the roster in the response.
  const selection = recipients.mode === "selection"
  const staffMemberIds = selection ? [...new Set(recipients.staffMemberIds ?? [])] : []
  const storeIds = selection ? [...new Set(recipients.storeIds ?? [])] : []
  if (selection && staffMemberIds.length === 0 && storeIds.length === 0) {
    return NextResponse.json({ error: "Select at least one staff member or store" }, { status: 400 })
  }

  // Every submitted store id validated against org ownership AND caller scope
  // (PERM-6's lesson, on day one — staff/route.ts:63-84 is the precedent).
  // The two failures are collapsed into ONE message: distinguishing "not yours"
  // from "not in your scope" would leak which ids exist in the org.
  if (storeIds.length > 0) {
    const owned = await prisma.store.findMany({
      where: { id: { in: storeIds }, organizationId: access.org.id },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((s) => s.id))
    const reachable = storeIds.every(
      (id) => ownedIds.has(id) && (access.isAdmin || access.storeIds.includes(id))
    )
    if (!reachable) {
      return NextResponse.json(
        { error: "One or more selected stores are not available to you" },
        { status: 400 }
      )
    }
  }

  // Same treatment for individually picked staff — this is
  // findManageableStaffMember's rule (access.ts:81-94) applied set-wise in one
  // query rather than per-target n+1 times.
  let picked: RecipientMember[] = []
  if (staffMemberIds.length > 0) {
    picked = await prisma.staffMember.findMany({
      where: { id: { in: staffMemberIds }, organizationId: access.org.id },
      select: RECIPIENT_SELECT,
    })
    const allInScope =
      picked.length === staffMemberIds.length &&
      (access.isAdmin ||
        picked.every((m) => m.storeAssignments.some((a) => access.storeIds.includes(a.storeId))))
    if (!allInScope) {
      return NextResponse.json(
        { error: "One or more selected staff members are not available to you" },
        { status: 400 }
      )
    }
  }

  // Trainer validation, verbatim from the single path (assignments/route.ts:40-46).
  if (trainerUserId) {
    const trainer = await prisma.user.findFirst({
      where: { id: trainerUserId, organizationId: access.org.id, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true },
    })
    if (!trainer) return NextResponse.json({ error: "Trainer not found" }, { status: 400 })
  }

  // ── Roster expansion ──────────────────────────────────────────────────────
  // Store expansion carries NO status filter, deliberately: an operator who
  // named a store should see who in it was skipped and why, so a terminated or
  // corporate member there enters the roster and is reported. "All in scope" is
  // a DEFINED population instead — R-d states it as ACTIVE staff — so a
  // years-old terminated record never enters it as reportable noise.
  let derived: RecipientMember[] = []
  if (recipients.mode === "all-in-scope") {
    derived = await prisma.staffMember.findMany({
      where: {
        organizationId: access.org.id,
        status: "ACTIVE",
        ...(access.isAdmin
          ? {}
          : { storeAssignments: { some: { storeId: { in: access.storeIds } } } }),
      },
      select: RECIPIENT_SELECT,
    })
  } else if (storeIds.length > 0) {
    derived = await prisma.staffMember.findMany({
      where: {
        organizationId: access.org.id,
        storeAssignments: { some: { storeId: { in: storeIds } } },
      },
      select: RECIPIENT_SELECT,
    })
  }

  // ADMIN's "everything in scope" is the one derived population that INCLUDES
  // corporate staff — they are org members, and this is the org-wide push
  // (R-d). Every other derived population excludes them, because Square expands
  // corporate staff to every store and a naive store expansion sweeps them in.
  const adminEverywhere = recipients.mode === "all-in-scope" && access.isAdmin

  // Explicit pick beats corporate exclusion (ruled 2026-08-11), which is how
  // R-d's two halves both hold: corporate staff are out of store expansion AND
  // individually selectable. Insertion order matters — picked overwrites the
  // derived entry for the same person.
  const roster = new Map<string, { member: RecipientMember; explicit: boolean }>()
  for (const member of derived) roster.set(member.id, { member, explicit: false })
  for (const member of picked) roster.set(member.id, { member, explicit: true })

  const requested = roster.size
  if (requested === 0) {
    return NextResponse.json({ error: "That selection reaches no staff members" }, { status: 400 })
  }

  const isApplicable = applicabilityCheck(trainingModule)
  const existing = await prisma.trainingAssignment.findMany({
    where: { trainingModuleId: trainingModule.id, staffMemberId: { in: [...roster.keys()] } },
    select: { staffMemberId: true },
  })
  const alreadyHas = new Set(existing.map((a) => a.staffMemberId))

  // Classification. The order IS the precedence, and it runs from the reason
  // that overrides everything to the one that only matters if the rest passed:
  // a terminated corporate member reads as terminated, and someone the module
  // cannot reach at all reads as not-applicable even if they somehow hold a
  // row. Exactly one bucket per person — that is what makes the sum below
  // mean anything.
  const outcomes = new Map<string, Outcome>()
  const names = new Map<string, string>()
  const toCreate: string[] = []
  for (const [id, { member, explicit }] of roster) {
    names.set(id, member.displayName)
    if (member.status !== "ACTIVE") {
      outcomes.set(id, "terminated")
    } else if (member.isCorporate && !explicit && !adminEverywhere) {
      outcomes.set(id, "corporate-excluded")
    } else if (!isApplicable(member)) {
      outcomes.set(id, "not-applicable")
    } else if (alreadyHas.has(id)) {
      outcomes.set(id, "already-assigned")
    } else {
      outcomes.set(id, "assigned")
      toCreate.push(id)
    }
  }

  const created = await prisma.trainingAssignment.createMany({
    data: toCreate.map((staffMemberId) => ({
      trainingModuleId: trainingModule.id,
      staffMemberId,
      assignedByUserId: access.dbUser.id,
      trainerUserId: trainerUserId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
    })),
    // HR-20 shipped @@unique([trainingModuleId, staffMemberId]); without this
    // flag the race the constraint closes would surface as P2002 → 500 instead
    // of the ordinary skip-and-report R-b rules.
    skipDuplicates: true,
  })

  // A concurrent request won some pairs between the read above and this write.
  // Attribution is clock-free: our rows were all inserted by one statement, so
  // they are the newest, and a race loser's row necessarily predates them (it
  // existed, or ours would have won). Ordering comes from the DB's own clock —
  // never compared against this server's. One indexed read, and ONLY when the
  // counts disagree.
  let concurrentlyAssigned = 0
  if (created.count < toCreate.length) {
    concurrentlyAssigned = toCreate.length - created.count
    const rows = await prisma.trainingAssignment.findMany({
      where: { trainingModuleId: trainingModule.id, staffMemberId: { in: toCreate } },
      select: { staffMemberId: true },
      orderBy: { createdAt: "desc" },
    })
    for (const row of rows.slice(created.count)) {
      outcomes.set(row.staffMemberId, "already-assigned")
    }
  }

  const tally = (outcome: Outcome) => [...outcomes.values()].filter((o) => o === outcome).length
  const assigned = tally("assigned")
  const alreadyAssigned = tally("already-assigned")
  const terminated = tally("terminated")
  const notApplicable = tally("not-applicable")
  const corporateExcluded = tally("corporate-excluded")

  // THE INVARIANT FAILS LOUDLY (Gary's rider, 2026-08-11). The buckets are the
  // whole point of this response; a number quietly reconciled to make them add
  // up would be worth less than no number at all. The write has already
  // happened when this fires — saying so is the honest report, and the counts
  // below name the mismatch rather than hiding it.
  //
  // Three checks, and the third is the one that can actually catch something:
  // the buckets are tallied from `outcomes`, so their sum tracks that map by
  // construction, but `assigned` is a CLASSIFICATION and `created.count` is what
  // the DATABASE says it inserted. They are derived independently and must
  // agree — if the race reconciliation above ever mis-attributes a row, this is
  // where it surfaces instead of being rounded away.
  const sum = assigned + alreadyAssigned + terminated + notApplicable + corporateExcluded
  if (sum !== requested || outcomes.size !== requested || assigned !== created.count) {
    return NextResponse.json(
      {
        error:
          "Assignment accounting mismatch — the assignments were written, but this response cannot be trusted to describe them",
        requested,
        sum,
        classified: outcomes.size,
        rowsInserted: created.count,
        assigned,
        alreadyAssigned,
        terminated,
        notApplicable,
        corporateExcluded,
      },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      moduleId: trainingModule.id,
      moduleTitle: trainingModule.title,
      dueDate: dueDate ?? null,
      requested,
      assigned,
      alreadyAssigned,
      terminated,
      notApplicable,
      corporateExcluded,
      // Outside the sum, deliberately: a diagnostic annotating alreadyAssigned,
      // not a sixth bucket. Nonzero means the HR-20 constraint did its job.
      concurrentlyAssigned,
      // Not capped. A silent truncation here would read as "everyone is
      // accounted for" while hiding the ones who were not.
      recipients: [...outcomes].map(([staffMemberId, outcome]) => ({
        staffMemberId,
        displayName: names.get(staffMemberId) ?? "",
        outcome,
      })),
    },
    { status: 201 }
  )
}
