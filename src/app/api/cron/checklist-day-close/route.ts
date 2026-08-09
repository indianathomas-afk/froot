import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { dbDate, localDateStr } from "@/lib/reports"
import {
  DAY_CLOSE_GRACE_HOURS,
  DAY_CLOSE_LOOKBACK_DAYS,
  dayCloseInstant,
  expectedWindow,
  hoursForDate,
  materializesMisses,
  shiftDateStr,
  type DayCloseSource,
} from "@/lib/checklist-lifecycle"

// GET /api/cron/checklist-day-close — CHK-3 (S3). THE ONLY WRITER OF THE CLOSED
// FACT. Every hour, for each active store, close any business day whose
// store-local close + DAY_CLOSE_GRACE_HOURS has passed: unfinished checklists
// become Missed, and a Daily template that nobody started gets a Missed row
// CREATED for it.
//
// Registered in vercel.json at "0 * * * *"; Vercel calls it with
// "Authorization: Bearer ${CRON_SECRET}". Shaped on api/cron/pace-alerts/route.ts
// — same auth, same maxDuration, same per-store try/catch, same summary log.
//
// HOURLY, NOT DAILY. A daily UTC cron fires at one instant for stores across
// several timezones; hourly lets each store close on its own clock and makes a
// skipped run self-healing.
//
// MATERIALISE, NOT MARK. The finding neither parked row could see (plan §0
// finding 1): /store-view lists TEMPLATES, and a Checklist row is only created
// on "Start Checklist" (api/checklists/route.ts:130) or by the admin bulk button
// (:167). A checklist nobody touched HAS NO ROW to write Missed onto.
//
// IDEMPOTENT BY CONSTRUCTION, not by a marker table. Every close is an
// `updateMany` filtered on `closedAt: null`, and every materialisation is
// read-then-create guarded by Migration B's unique index; a second run in the
// same hour changes nothing and reports zeros. There is no "day closed" flag to
// keep in sync.
//
// NO ORG SCOPE, DELIBERATELY. This is a system job with no caller and no
// session — the multi-tenancy rule in CLAUDE.md is about routes that serve a
// user, and inventing an org filter here would just be a way to miss a tenant.
// Every write below is still keyed to the store's own organizationId.
//
// OVERDUE IS NOT WRITTEN HERE OR ANYWHERE. It is derived on read
// (src/lib/checklist-lifecycle.ts). If you are looking for the place that
// records a checklist as overdue, there isn't one, and that is the design.

export const maxDuration = 300

/** How far back the stranded-open probe looks, BEFORE the lookback window. */
const STRANDED_PROBE_DAYS = 7

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002"
}

type DayResult = {
  date: string
  dayCloseAt: string
  dayCloseSource: DayCloseSource
  /** "closed" — this run closed the day; "not-yet" — day close is in the future. */
  outcome: "closed" | "not-yet"
  markedMissed: number
  materialized: number
  alreadyClosed: number
  completedLeft: number
  /** Templates skipped by the Daily-only rule (DEBT-61's containment). */
  frequencySkipped: number
  /** Materialisations lost to a race with a concurrent create — the unique
   *  index doing its job, not an error. */
  raced: number
}

type StoreResult = {
  storeId: string
  storeName: string
  timezone: string
  days: DayResult[]
  /** Open checklists older than the lookback window — a cron outage longer than
   *  the lookback, left OPEN on purpose and reported rather than swept. */
  strandedOpen: { count: number; from: string; to: string } | null
  error?: string
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()

  // Active stores only. An inactive store's open checklists are left exactly as
  // they are — deactivating a store is not a statement about whether last
  // Tuesday's closing checklist was done.
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      organizationId: true,
      timezone: true,
      hours: { select: { dayOfWeek: true, openingTime: true, closingTime: true, isClosed: true } },
    },
  })

  // Templates that could apply to a store, per org. Same filter the store-view
  // list uses (api/stores/[id]/templates/route.ts) — isActive, not archived,
  // appliesTo honoured — so the job can never materialise a miss for a template
  // the store was never shown.
  const orgIds = [...new Set(stores.map((s) => s.organizationId))]
  const templates = await prisma.template.findMany({
    where: { organizationId: { in: orgIds }, isActive: true, isArchived: false },
    select: {
      id: true,
      organizationId: true,
      frequency: true,
      availabilityType: true,
      operationalPhase: true,
      startOffsetHours: true,
      endOffsetHours: true,
      appliesTo: true,
      storeAssignments: { select: { storeId: true } },
    },
  })
  const templatesByOrg = new Map<string, typeof templates>()
  for (const t of templates) templatesByOrg.set(t.organizationId, [...(templatesByOrg.get(t.organizationId) ?? []), t])

  const results: StoreResult[] = []

  for (const store of stores) {
    const result: StoreResult = {
      storeId: store.id,
      storeName: store.name,
      timezone: store.timezone,
      days: [],
      strandedOpen: null,
    }
    results.push(result)

    try {
      const todayStr = localDateStr(now, store.timezone)
      // Yesterday and the day before — never today, which has not ended. One
      // skipped hourly run therefore repairs itself on the next.
      const days = Array.from({ length: DAY_CLOSE_LOOKBACK_DAYS }, (_, i) => shiftDateStr(todayStr, -(i + 1)))
      const orgTemplates = templatesByOrg.get(store.organizationId) ?? []

      for (const day of days) {
        const hoursRow = hoursForDate(store.hours, day)
        const dc = dayCloseInstant(hoursRow, day, store.timezone)
        const dayResult: DayResult = {
          date: day,
          dayCloseAt: dc.at.toISOString(),
          dayCloseSource: dc.source,
          outcome: now < dc.at ? "not-yet" : "closed",
          markedMissed: 0,
          materialized: 0,
          alreadyClosed: 0,
          completedLeft: 0,
          frequencySkipped: 0,
          raced: 0,
        }
        result.days.push(dayResult)
        if (dayResult.outcome === "not-yet") continue

        const date = dbDate(day)
        const existing = await prisma.checklist.findMany({
          where: { storeId: store.id, date },
          select: {
            id: true,
            templateId: true,
            status: true,
            closedAt: true,
            taskLogs: { select: { taskId: true } },
            template: { select: { tasks: { select: { id: true } } } },
          },
        })

        // ── Close what exists ────────────────────────────────────────────────
        for (const c of existing) {
          if (c.status === "Completed") {
            dayResult.completedLeft++
            continue
          }
          if (c.closedAt) {
            dayResult.alreadyClosed++
            continue
          }

          // Non-Compliant is treated as not-Completed and becomes Missed
          // (plan §3.4, §12.7). It is a submit-time verdict on a partial
          // checklist; once the day is closed it is a miss like any other, and
          // two closed-but-unfinished statuses would give the report two answers
          // to one question.
          //
          // completionRate is recomputed the same way submit computes it —
          // DISTINCT logs whose task belongs to this template. Counting raw log
          // rows is the integrity hole this session closes; see
          // api/checklists/[id]/submit/route.ts.
          const taskIds = new Set(c.template.tasks.map((t) => t.id))
          const done = new Set(c.taskLogs.filter((l) => taskIds.has(l.taskId)).map((l) => l.taskId))
          const completionRate = taskIds.size > 0 ? done.size / taskIds.size : 0

          // `closedAt: null` in the filter is the idempotency guard: a second
          // run in the same hour matches nothing and updates nothing. Expected
          // windows are NOT filled in here — a row that has none recorded none
          // (blank offsets, AllDay, no hours, or a row predating Migration B),
          // and writing one now would be inventing a judgement after the fact.
          const updated = await prisma.checklist.updateMany({
            where: { id: c.id, closedAt: null },
            data: { status: "Missed", closedAt: now, completionRate },
          })
          dayResult.markedMissed += updated.count
        }

        // ── Materialise what does not exist ──────────────────────────────────
        // A STORE THAT WAS CLOSED CANNOT MISS A CHECKLIST (plan §3.5). Existing
        // rows for a closed day still close, above; nothing is created for it.
        if (hoursRow?.isClosed) continue

        const haveTemplate = new Set(existing.map((c) => c.templateId))
        for (const t of orgTemplates) {
          if (haveTemplate.has(t.id)) continue
          if (t.appliesTo === "selected" && !t.storeAssignments.some((a) => a.storeId === store.id)) continue

          // DAILY ONLY — the engine-level exclusion, ruled in plan §5.4/§12.8.
          // Template.frequency is read by no generation path, which is DEBT-61:
          // bulk generate already creates a checklist for a Weekly template
          // every day, so an unfiltered job here would file it Missed six days a
          // week. The predicate and the full reasoning live in
          // src/lib/checklist-lifecycle.ts — materializesMisses(). This is a
          // CONTAINMENT, not a fix; the fix is DEBT-61's.
          if (!materializesMisses(t.frequency)) {
            dayResult.frequencySkipped++
            continue
          }

          // The window as it stands at close, frozen onto the row (plan §3.4).
          // A materialised row carries NO task logs and NO sectionsSnapshot: it
          // is a record that nothing happened, and freezing today's section
          // names onto it would make a guess indistinguishable from an
          // as-executed record — plan §12.5's ruling, one row-type further on.
          // See the S3 note on Checklist.sectionsSnapshot in prisma/schema.prisma.
          const w = expectedWindow(t, hoursRow, day, store.timezone)
          try {
            await prisma.checklist.create({
              data: {
                organizationId: store.organizationId,
                storeId: store.id,
                templateId: t.id,
                date,
                status: "Missed",
                closedAt: now,
                completionRate: 0,
                expectedStartAt: w?.start ?? null,
                expectedEndAt: w?.end ?? null,
              },
            })
            dayResult.materialized++
          } catch (e) {
            // Migration B's unique index catching a concurrent create — someone
            // started the checklist in the same second the job materialised it.
            // Their row wins; it is the one with the work in it.
            if (!isUniqueViolation(e)) throw e
            dayResult.raced++
          }
        }
      }

      // A GAP LONGER THAN THE LOOKBACK IS LEFT OPEN ON PURPOSE and reported
      // here, because a silent retroactive sweep across an outage is worse than
      // a visible hole (plan §3.5, §12.11). BOUNDED, and the bound is in the
      // response rather than implied: this probes the STRANDED_PROBE_DAYS days
      // before the lookback window, not all history. Unbounded it would count
      // every unfinished checklist ever created — a number that only grows and
      // therefore signals nothing. On the first runs after deploy it counts
      // pre-deploy rows, which are exactly the rows Migration B leaves alone.
      const oldestDay = days[days.length - 1]
      const probeFrom = shiftDateStr(oldestDay, -STRANDED_PROBE_DAYS)
      const strandedCount = await prisma.checklist.count({
        where: {
          storeId: store.id,
          closedAt: null,
          status: { not: "Completed" },
          date: { gte: dbDate(probeFrom), lt: dbDate(oldestDay) },
        },
      })
      result.strandedOpen = { count: strandedCount, from: probeFrom, to: oldestDay }
      if (strandedCount > 0) {
        console.warn(
          `[cron:checklist-day-close] store=${store.id}: ${strandedCount} open checklists between ${probeFrom} and ${oldestDay} are older than the ${DAY_CLOSE_LOOKBACK_DAYS}-day lookback and were NOT closed`
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "day close failed"
      result.error = msg.slice(0, 200)
      console.error(`[cron:checklist-day-close] store=${store.id}: ${msg}`)
    }
  }

  const markedMissed = results.reduce((n, r) => n + r.days.reduce((m, d) => m + d.markedMissed, 0), 0)
  const materialized = results.reduce((n, r) => n + r.days.reduce((m, d) => m + d.materialized, 0), 0)
  const daysClosed = results.reduce((n, r) => n + r.days.filter((d) => d.outcome === "closed").length, 0)
  const errors = results.filter((r) => r.error).length

  console.log(
    `[cron:checklist-day-close] ${stores.length} stores, ${daysClosed} store-days closed, ${markedMissed} marked missed, ${materialized} materialized, ${errors} errors (grace ${DAY_CLOSE_GRACE_HOURS}h, lookback ${DAY_CLOSE_LOOKBACK_DAYS}d)`
  )

  // THIS BODY IS A PROOF SURFACE. CHK-3 ships no UI, so it and SQL are the only
  // evidence the engine works — see docs/prompts/CHK-3_S3_lifecycle_engine.md
  // Step 4. It never contains the secret.
  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    graceHours: DAY_CLOSE_GRACE_HOURS,
    lookbackDays: DAY_CLOSE_LOOKBACK_DAYS,
    strandedProbeDays: STRANDED_PROBE_DAYS,
    stores: stores.length,
    daysClosed,
    markedMissed,
    materialized,
    errors,
    results,
  })
}
