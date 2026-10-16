import type { Organization } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { addDaysStr } from "@/lib/labor-schedule"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { dateColumnStr } from "@/lib/milestones"
import { paidMinutesOf } from "@/lib/labor-actuals"
import { laborOverlayOn } from "@/lib/labor-dashboard"
import { getOnTimeForStaff, type MilestoneSettingsValues, type OnTimeResult } from "@/lib/attendance"
import {
  complianceDocumentWhere,
  computeStaffComplianceDetails,
  type StaffComplianceDetail,
} from "@/lib/hr-compliance"
import { DEFAULT_RAISE_SETTINGS, raiseSettingsProblem, type RaiseSettingsValues } from "@/lib/raise-settings"

// ─────────────────────────────────────────────────────────────────────────────
// MS-3a — RAISE ELIGIBILITY. ONE FUNCTION (getRaiseEligibility), batched like
// getOnTimeForStaff, that /staff, the Milestones tab, MS-4's notifications and
// MS-5's report all call. Nothing derived is stored; every badge is computed on
// read from the settings row and the records it names.
//
// THE RULINGS (Gary, 2026-10-15 rulings 2/4/5 and the 2026-10-16 fork rulings,
// docs/prompts/2026-10-16_MS-3_AUDIT.md):
//   F1  RED    = a hard blocker: the compliance gate fails, or on-time has
//                enough shifts and is below the minimum.
//       YELLOW = no blocker, but a criterion is not met yet or has no data.
//       GREEN  = every criterion that applies is met.
//       "N/A — not assigned" criteria are left out of the colour (F11).
//   F2  (b)  a TRAINING fails the gate only when OVERDUE; a required DOCUMENT
//            fails it whenever unsigned (Gary 2026-09-07: a document is owed
//            from the day it applies). Nothing assigned passes.
//   F3  paid hours (gross minus unpaid breaks — paidMinutesOf, the house rule)
//       in EACH of the last Y COMPLETED Monday–Sunday weeks, all stores
//       combined; the current partial week is ignored. Each timecard is dated
//       by its start in ITS OWN store's zone; "this week" is the member's
//       display zone.
//   F4  the MS-2 exact on-time % over those same weeks, the org's grace.
//   F9  never green on missing data.
//   F11 a required training or document that does not reach this person is
//       "N/A — not assigned" and is skipped for them.
//   F12 Square labor off = no badge at all: this returns an EMPTY MAP.
//   Terminated members get no badge.
//
// NO WAGE DATA IS READ HERE (the MS-3a / MS-3b split). Raise detection, the
// manual last-raise date and the cooldown arrive in MS-3b, which is also where
// any amount or date gets redacted per viewer. Nothing in this file's output is
// pay data — verify-ms3 asserts no wage field appears in it.
// ─────────────────────────────────────────────────────────────────────────────

// ─── SETTINGS (DB) ───────────────────────────────────────────────────────────

/// The org's raise settings, or the defaults when it has never saved. The
/// required lists come back with ARCHIVED trainings and documents no longer
/// admitted by the compliance filter ALREADY DROPPED — so the form never shows a
/// dead pick, and the next save removes its row.
export async function getRaiseSettings(organizationId: string): Promise<RaiseSettingsValues> {
  const row = await prisma.milestoneSettings.findUnique({
    where: { organizationId },
    select: {
      raiseComplianceGate: true,
      raiseMinHoursPerWeek: true,
      raiseConsecutiveWeeks: true,
      raiseMinOnTimePct: true,
      raiseCooldownDays: true,
      raiseRequiredTrainings: {
        where: { module: { organizationId, isActive: true, isArchived: false } },
        select: { trainingModuleId: true },
        orderBy: { createdAt: "asc" },
      },
      raiseRequiredDocuments: {
        where: { document: complianceDocumentWhere(organizationId) },
        select: { hrDocumentId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  })
  if (!row) return { ...DEFAULT_RAISE_SETTINGS, requiredTrainingIds: [], requiredDocumentIds: [] }
  const { raiseRequiredTrainings, raiseRequiredDocuments, ...rest } = row
  return {
    ...rest,
    requiredTrainingIds: raiseRequiredTrainings.map((r) => r.trainingModuleId),
    requiredDocumentIds: raiseRequiredDocuments.map((r) => r.hrDocumentId),
  }
}

export type RaisePickerOption = { id: string; title: string }

/// What the setup form may tick: live trainings (active, not archived) and the
/// documents the compliance engine counts. Org-scoped; titles only.
export async function getRaisePickerOptions(
  organizationId: string
): Promise<{ trainings: RaisePickerOption[]; documents: RaisePickerOption[] }> {
  const [trainings, documents] = await Promise.all([
    prisma.trainingModule.findMany({
      where: { organizationId, isActive: true, isArchived: false },
      select: { id: true, title: true },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    }),
    prisma.hrDocument.findMany({
      where: complianceDocumentWhere(organizationId),
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ])
  return { trainings, documents }
}

/// The write, extracted from the route so scripts/verify-ms3.ts runs the same
/// refusal. THE CALLER HAS ALREADY PASSED requireMilestones("milestones.manage")
/// and resolved organizationId from the session — this is not a gate. Every id
/// must name a live training / compliance document IN THIS ORG; a foreign or
/// archived id is refused, never silently dropped. One transaction: the row and
/// both lists change together or not at all.
export async function saveRaiseSettings(
  organizationId: string,
  values: RaiseSettingsValues
): Promise<{ ok: true; settings: RaiseSettingsValues } | { ok: false; error: string }> {
  const problem = raiseSettingsProblem(values)
  if (problem) return { ok: false, error: problem }

  const [liveTrainings, liveDocuments] = await Promise.all([
    values.requiredTrainingIds.length
      ? prisma.trainingModule.count({
          where: { id: { in: values.requiredTrainingIds }, organizationId, isActive: true, isArchived: false },
        })
      : 0,
    values.requiredDocumentIds.length
      ? prisma.hrDocument.count({ where: { id: { in: values.requiredDocumentIds }, ...complianceDocumentWhere(organizationId) } })
      : 0,
  ])
  if (liveTrainings !== values.requiredTrainingIds.length) {
    return { ok: false, error: "One of the chosen trainings is archived or doesn't exist. Reload and choose again." }
  }
  if (liveDocuments !== values.requiredDocumentIds.length) {
    return { ok: false, error: "One of the chosen documents is archived or doesn't exist. Reload and choose again." }
  }

  const { requiredTrainingIds, requiredDocumentIds, ...fields } = values
  await prisma.$transaction(async (tx) => {
    const row = await tx.milestoneSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...fields },
      update: fields,
      select: { id: true },
    })
    await tx.milestoneRaiseTraining.deleteMany({ where: { milestoneSettingsId: row.id } })
    await tx.milestoneRaiseDocument.deleteMany({ where: { milestoneSettingsId: row.id } })
    if (requiredTrainingIds.length) {
      await tx.milestoneRaiseTraining.createMany({
        data: requiredTrainingIds.map((trainingModuleId) => ({ milestoneSettingsId: row.id, trainingModuleId })),
      })
    }
    if (requiredDocumentIds.length) {
      await tx.milestoneRaiseDocument.createMany({
        data: requiredDocumentIds.map((hrDocumentId) => ({ milestoneSettingsId: row.id, hrDocumentId })),
      })
    }
  })
  return { ok: true, settings: values }
}

// ─── PURE: THE WEEKS ─────────────────────────────────────────────────────────

/// F3: the Mondays of the last `count` COMPLETED labor weeks before the week
/// containing `today` (a store-local yyyy-mm-dd), oldest first. The current
/// week is never included, however far into it today is.
export function completedWeeks(today: string, count: number): string[] {
  const thisMonday = mondayOfWeekStr(today)
  const out: string[] = []
  for (let k = count; k >= 1; k--) out.push(addDaysStr(thisMonday, -7 * k))
  return out
}

// ─── PURE: ONE MEMBER ────────────────────────────────────────────────────────

export type RaiseCriterionKey = "compliance" | "hours" | "onTime" | "trainings" | "documents"
/// blocked = the hard-blocker kind of not-met (F1 red). na = F11, left out of
/// the colour.
export type RaiseCriterionState = "met" | "not-met" | "blocked" | "no-data" | "na"
export type RaiseCriterion = { key: RaiseCriterionKey; label: string; state: RaiseCriterionState; detail: string }
export type RaiseStatus = "green" | "yellow" | "red"
export type RaiseEligibility = {
  status: RaiseStatus
  criteria: RaiseCriterion[]
  /// The completed weeks judged, store-local, Monday of the first to Sunday of
  /// the last.
  weeks: { from: string; to: string }
}

export type RaiseMemberInputs = {
  settings: RaiseSettingsValues
  weeks: string[]
  /// paid minutes per Monday, this member, all stores
  minutesByWeek: Map<string, number>
  /// first store-local date Froot holds timecards for at this member's stores;
  /// null = none at all
  dataStart: string | null
  /// StaffMember.startDate as yyyy-mm-dd, or null
  startDate: string | null
  linked: boolean
  compliance: StaffComplianceDetail | undefined
  onTime: OnTimeResult | undefined
  requiredTrainings: RaisePickerOption[]
  /// this member's assignment status per required module id; absent = not assigned
  trainingStatus: Map<string, string>
  requiredDocuments: RaisePickerOption[]
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const hoursLabel = (minutes: number) => `${(Math.floor(minutes / 6) / 10).toFixed(1)} h`
const listTitles = (xs: string[]) => xs.join(", ")

function complianceCriterion(c: StaffComplianceDetail | undefined): RaiseCriterion {
  const label = "Compliance"
  if (!c) return { key: "compliance", label, state: "no-data", detail: "No compliance record for this person." }
  // F2 (b): an overdue training, or ANY unsigned required document.
  const overdue = c.items.filter((i) => i.kind === "training" && i.status === "overdue").length
  const unsigned = c.items.filter((i) => i.kind === "document" && i.status !== "complete").length
  if (overdue === 0 && unsigned === 0) {
    return {
      key: "compliance",
      label,
      state: "met",
      detail: c.items.length === 0 ? "Nothing assigned." : "No overdue training and every required document signed.",
    }
  }
  const parts: string[] = []
  if (overdue) parts.push(`${plural(overdue, "overdue training")}`)
  if (unsigned) parts.push(`${plural(unsigned, "unsigned document")}`)
  return { key: "compliance", label, state: "blocked", detail: `${parts.join(" and ")}.` }
}

function hoursCriterion(i: RaiseMemberInputs): RaiseCriterion {
  const min = i.settings.raiseMinHoursPerWeek
  const label = `${min}+ hours a week for ${plural(i.weeks.length, "week")}`
  if (!i.linked) return { key: "hours", label, state: "no-data", detail: "Not linked to Square, so there are no timecards." }
  // F9: a week is COVERED only when Froot holds timecards from before it began
  // and the person had started by its Monday. An uncovered week is "no data",
  // never a zero.
  const covered = (monday: string) =>
    i.dataStart !== null && monday >= i.dataStart && (i.startDate === null || i.startDate <= monday)
  const coveredWeeks = i.weeks.filter(covered)
  const short = coveredWeeks.filter((w) => (i.minutesByWeek.get(w) ?? 0) < min * 60)
  const each = i.weeks.map((w) => (covered(w) ? hoursLabel(i.minutesByWeek.get(w) ?? 0) : "no data")).join(", ")
  if (short.length) return { key: "hours", label, state: "not-met", detail: `Weeks oldest first: ${each}.` }
  if (coveredWeeks.length < i.weeks.length) {
    return {
      key: "hours",
      label,
      state: "no-data",
      detail: `Only ${coveredWeeks.length} of ${i.weeks.length} weeks have timecard data (${each}).`,
    }
  }
  return { key: "hours", label, state: "met", detail: `Weeks oldest first: ${each}.` }
}

function onTimeCriterion(i: RaiseMemberInputs): RaiseCriterion {
  const min = i.settings.raiseMinOnTimePct
  const label = `${min}%+ on time over the same weeks`
  const r = i.onTime
  if (!r) return { key: "onTime", label, state: "no-data", detail: "No on-time result." }
  if (r.status === "not-linked") return { key: "onTime", label, state: "no-data", detail: "Not linked to Square." }
  if (r.status === "no-schedule") return { key: "onTime", label, state: "no-data", detail: "No published Square shifts in these weeks." }
  if (r.status === "not-enough" || r.percent === null) {
    return { key: "onTime", label, state: "no-data", detail: `Only ${plural(r.total, "scheduled shift")} in these weeks — not enough to judge.` }
  }
  // Exact percentage decides; the displayed one rounds DOWN (MS-2's ruling), so
  // the words never disagree with the state.
  const shown = `${r.displayPercent}% (${r.onTime} of ${r.total} shifts)`
  return r.percent >= min
    ? { key: "onTime", label, state: "met", detail: `${shown}.` }
    : { key: "onTime", label, state: "blocked", detail: `${shown} — below ${min}%.` }
}

function trainingsCriterion(i: RaiseMemberInputs): RaiseCriterion {
  const label = "Required trainings"
  const na = i.requiredTrainings.filter((t) => !i.trainingStatus.has(t.id))
  const applicable = i.requiredTrainings.filter((t) => i.trainingStatus.has(t.id))
  const open = applicable.filter((t) => i.trainingStatus.get(t.id) !== "Completed")
  const naNote = na.length ? ` N/A — not assigned: ${listTitles(na.map((t) => t.title))}.` : ""
  if (applicable.length === 0) return { key: "trainings", label, state: "na", detail: `N/A — not assigned: ${listTitles(na.map((t) => t.title))}.` }
  if (open.length) return { key: "trainings", label, state: "not-met", detail: `Not completed: ${listTitles(open.map((t) => t.title))}.${naNote}` }
  return { key: "trainings", label, state: "met", detail: `All ${plural(applicable.length, "training")} completed.${naNote}` }
}

function documentsCriterion(i: RaiseMemberInputs): RaiseCriterion {
  const label = "Required documents"
  // A required document reaches this person exactly when the compliance engine
  // listed it for them (audience + current version): one definition.
  const items = new Map(
    (i.compliance?.items ?? []).flatMap((it) => (it.kind === "document" ? [[it.documentId, it.status] as const] : []))
  )
  const na = i.requiredDocuments.filter((d) => !items.has(d.id))
  const applicable = i.requiredDocuments.filter((d) => items.has(d.id))
  const open = applicable.filter((d) => items.get(d.id) !== "complete")
  const naNote = na.length ? ` N/A — not assigned: ${listTitles(na.map((d) => d.title))}.` : ""
  if (applicable.length === 0) return { key: "documents", label, state: "na", detail: `N/A — not assigned: ${listTitles(na.map((d) => d.title))}.` }
  if (open.length) return { key: "documents", label, state: "not-met", detail: `Not signed: ${listTitles(open.map((d) => d.title))}.${naNote}` }
  return { key: "documents", label, state: "met", detail: `All ${plural(applicable.length, "document")} signed.${naNote}` }
}

/// THE PURE RULE for one member — every input already loaded. Exported so the
/// fixture can walk each boundary without a database.
export function assembleRaise(i: RaiseMemberInputs): RaiseEligibility {
  const criteria: RaiseCriterion[] = []
  if (i.settings.raiseComplianceGate) criteria.push(complianceCriterion(i.compliance))
  if (i.settings.raiseMinHoursPerWeek > 0) criteria.push(hoursCriterion(i))
  if (i.settings.raiseMinOnTimePct > 0) criteria.push(onTimeCriterion(i))
  if (i.requiredTrainings.length) criteria.push(trainingsCriterion(i))
  if (i.requiredDocuments.length) criteria.push(documentsCriterion(i))

  const states = criteria.map((c) => c.state)
  const status: RaiseStatus = states.includes("blocked")
    ? "red"
    : states.some((s) => s === "not-met" || s === "no-data")
      ? "yellow"
      : "green"
  const first = i.weeks[0]
  const last = i.weeks[i.weeks.length - 1]
  return { status, criteria, weeks: { from: first, to: addDaysStr(last, 6) } }
}

// ─── THE READ (DB) ───────────────────────────────────────────────────────────

export type RaiseMember = {
  id: string
  squareTeamMemberId: string | null
  assignedStoreIds: string[]
  startDate: Date | null
  status: string
  /// displayTimeZone(member, org) — decides which week "this week" is.
  zone: string
}

/// BATCHED: a fixed set of reads for every member passed, whether one profile
/// or the whole /staff roster (HR-8's "never a query per row").
///
/// F12: with the Square labor overlay off this returns an EMPTY MAP and reads
/// nothing — no member gets a badge. Terminated members are skipped.
///
/// `compliance` lets a caller that has already run computeStaffComplianceDetails
/// for the same members (the /staff list) pass it in rather than run it twice.
export async function getRaiseEligibility(
  org: Organization,
  members: RaiseMember[],
  raise: RaiseSettingsValues,
  onTimeSettings: MilestoneSettingsValues,
  opts: { now?: Date; compliance?: Map<string, StaffComplianceDetail> } = {}
): Promise<Map<string, RaiseEligibility>> {
  const out = new Map<string, RaiseEligibility>()
  if (!laborOverlayOn(org)) return out
  const active = members.filter((m) => m.status !== "TERMINATED")
  if (active.length === 0) return out
  const now = opts.now ?? new Date()

  const weeksOf = new Map(
    active.map((m) => [m.id, completedWeeks(localDateStr(now, m.zone), raise.raiseConsecutiveWeeks)] as const)
  )
  const ids = active.map((m) => m.id)
  const linked = active.filter((m) => m.squareTeamMemberId)

  // Compliance details: needed for the gate and for required documents.
  let compliance = opts.compliance
  if (!compliance && (raise.raiseComplianceGate || raise.requiredDocumentIds.length)) {
    const details = await computeStaffComplianceDetails(org.id, ids)
    compliance = new Map(details.map((d) => [d.staffId, d]))
  }

  const [requiredTrainings, requiredDocuments, assignments] = await Promise.all([
    raise.requiredTrainingIds.length
      ? prisma.trainingModule.findMany({
          where: { id: { in: raise.requiredTrainingIds }, organizationId: org.id, isActive: true, isArchived: false },
          select: { id: true, title: true },
          orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([] as RaisePickerOption[]),
    raise.requiredDocumentIds.length
      ? prisma.hrDocument.findMany({
          where: { id: { in: raise.requiredDocumentIds }, ...complianceDocumentWhere(org.id) },
          select: { id: true, title: true },
          orderBy: { title: "asc" },
        })
      : Promise.resolve([] as RaisePickerOption[]),
    raise.requiredTrainingIds.length
      ? prisma.trainingAssignment.findMany({
          where: { staffMemberId: { in: ids }, trainingModuleId: { in: raise.requiredTrainingIds } },
          select: { staffMemberId: true, trainingModuleId: true, status: true },
        })
      : Promise.resolve([]),
  ])
  const trainingStatus = new Map<string, Map<string, string>>()
  for (const a of assignments) {
    const m = trainingStatus.get(a.staffMemberId) ?? new Map<string, string>()
    m.set(a.trainingModuleId, a.status)
    trainingStatus.set(a.staffMemberId, m)
  }

  // Hours: one timecard read for the whole window, closed cards only.
  const minutes = new Map<string, Map<string, number>>()
  const dataStartByStore = new Map<string, string>()
  let orgDataStart: string | null = null
  if (raise.raiseMinHoursPerWeek > 0 && linked.length) {
    const stores = await prisma.store.findMany({ where: { organizationId: org.id }, select: { id: true, timezone: true } })
    const zoneOf = new Map(stores.map((s) => [s.id, s.timezone || org.timezone]))
    const allMondays = [...weeksOf.values()].flat().sort()
    const lo = new Date(Date.parse(`${allMondays[0]}T00:00:00.000Z`) - 2 * 86_400_000)
    const hi = new Date(Date.parse(`${allMondays[allMondays.length - 1]}T00:00:00.000Z`) + 9 * 86_400_000)
    const byTeamMember = new Map(linked.map((m) => [m.squareTeamMemberId as string, m.id]))
    const [cards, firsts] = await Promise.all([
      prisma.squareTimecard.findMany({
        where: {
          organizationId: org.id,
          squareTeamMemberId: { in: [...byTeamMember.keys()] },
          endAt: { not: null },
          startAt: { gte: lo, lt: hi },
        },
        select: { squareTeamMemberId: true, storeId: true, startAt: true, endAt: true, breakUnpaidMinutes: true },
      }),
      prisma.squareTimecard.groupBy({ by: ["storeId"], where: { organizationId: org.id }, _min: { startAt: true } }),
    ])
    for (const f of firsts) {
      if (!f._min.startAt) continue
      const d = localDateStr(f._min.startAt, zoneOf.get(f.storeId) ?? org.timezone)
      dataStartByStore.set(f.storeId, d)
      if (orgDataStart === null || d < orgDataStart) orgDataStart = d
    }
    for (const c of cards) {
      const memberId = byTeamMember.get(c.squareTeamMemberId)
      if (!memberId) continue
      const paid = paidMinutesOf(c, now.getTime())
      if (paid === null) continue
      const monday = mondayOfWeekStr(localDateStr(c.startAt, zoneOf.get(c.storeId) ?? org.timezone))
      const m = minutes.get(memberId) ?? new Map<string, number>()
      m.set(monday, (m.get(monday) ?? 0) + paid)
      minutes.set(memberId, m)
    }
  }

  // On-time over the same completed weeks, with the org's grace (F4).
  const onTime =
    raise.raiseMinOnTimePct > 0
      ? await getOnTimeForStaff(
          org,
          active.map((m) => {
            const w = weeksOf.get(m.id) as string[]
            return {
              id: m.id,
              squareTeamMemberId: m.squareTeamMemberId,
              assignedStoreIds: m.assignedStoreIds,
              range: { from: w[0], to: addDaysStr(w[w.length - 1], 6) },
            }
          }),
          onTimeSettings,
          now
        )
      : new Map<string, OnTimeResult>()

  for (const m of active) {
    // Data start for this member: the earliest of their stores' first
    // timecards; a member with no store (corporate) falls back to the org's.
    const own = m.assignedStoreIds.map((s) => dataStartByStore.get(s)).filter((d): d is string => !!d).sort()
    const dataStart = m.assignedStoreIds.length ? (own[0] ?? null) : orgDataStart
    out.set(
      m.id,
      assembleRaise({
        settings: raise,
        weeks: weeksOf.get(m.id) as string[],
        minutesByWeek: minutes.get(m.id) ?? new Map(),
        dataStart,
        startDate: m.startDate ? dateColumnStr(m.startDate) : null,
        linked: !!m.squareTeamMemberId,
        compliance: compliance?.get(m.id),
        onTime: onTime.get(m.id),
        requiredTrainings,
        trainingStatus: trainingStatus.get(m.id) ?? new Map(),
        requiredDocuments,
      })
    )
  }
  return out
}
