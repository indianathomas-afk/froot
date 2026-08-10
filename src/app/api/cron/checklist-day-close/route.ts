import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { dbDate, localDateStr } from "@/lib/reports"
import {
  DAY_CLOSE_GRACE_HOURS,
  DAY_CLOSE_LOOKBACK_DAYS,
  dayCloseAppliesTo,
  dayCloseInstant,
  expectedWindow,
  hoursForDate,
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
  // ── CHK-3 DEFECT FIX, 2026-08-10 — FOUR COUNTERS, AND THE NAMES ARE THE FIX ──
  // `frequencySkipped` STOOD HERE AND IS GONE. It counted one thing (non-Daily
  // templates with no row yet, at the materialisation site) and was read as
  // another ("no weekly row was written"). Twenty-four fiction rows were on
  // staging while bodies carried it. Renamed and split so that no field can be
  // read as a claim about a site it never looked at. Every one of the four is
  // now summed into the top-level totals AND the hourly log line, because a
  // counter that only exists inside `results[].days[]` is a counter nobody
  // reads.
  /** Templates NOT materialised by the Daily-only rule (DEBT-61's containment). */
  frequencyExcluded: number
  /** EXISTING non-Daily checklists left OPEN rather than closed — Gary's
   *  2026-08-10 ruling extending the exclusion to the closing site. These rows
   *  keep `closedAt: null` and therefore read `overdue` indefinitely; the count
   *  is surfaced so that trade is visible rather than inferred. */
  frequencyLeftOpen: number
  /** Templates NOT materialised because they did not exist yet on this day —
   *  the `createdAt` floor. Before it, a template created today collected a
   *  Missed row for every lookback day and every applicable store. */
  beforeTemplateCreation: number
  /** Templates that already had a row for this store-day, so neither the
   *  frequency rule nor the floor was ever asked about them. Counted because
   *  its ABSENCE is what made a body showing zeros look like proof: a template
   *  with a row — including a fictional one — used to vanish from every
   *  counter at once. */
  preexisting: number
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
  // ── CHK-4, 2026-08-10 — TWO HARDENING ITEMS CARRIED IN FROM S3's TRIAGE ────
  // RECORDED HERE, NOT IMPLEMENTED HERE. CHK-4's MUST NOT TOUCH covers cron
  // mechanics; its inherited-checks section says these two "land here if the
  // cron file is touched, else as comments at the site". The file was not
  // otherwise opened this session, so they are comments and the handler below
  // is byte-identical in behaviour. Written down because an item that lives
  // only in a session report does not exist (DEBT-37) — and because the first
  // of the two is the exact gap that cost an afternoon
  // (docs/prompts/CRON-DIAG_findings.md).
  //
  // (1) LOG REJECTED REQUESTS. Both refusals below return and log nothing, so a
  //     401 is invisible in the Vercel Runtime Logs and indistinguishable from
  //     the cron never having fired. CRON-DIAG spent an afternoon on a stale
  //     Preview secret with no server-side trace to read. Shape: a
  //     `console.warn` naming WHICH branch was taken — no header present vs
  //     present-and-wrong — and never any part of the value, neither the
  //     expected one nor the supplied one.
  // (2) `.trim()` AND A CONSTANT-TIME COMPARISON. `process.env.CRON_SECRET`
  //     can carry a trailing newline from a paste into the Vercel dashboard,
  //     which fails the `!==` below and reads exactly like a wrong value.
  //     Trim both sides. Separately, `!==` on strings short-circuits at the
  //     first differing byte and is therefore timing-variable; `crypto`'s
  //     `timingSafeEqual` over equal-length buffers is the standard fix. The
  //     timing half is low-severity for this endpoint by the same reasoning
  //     that deferred the rotation (CHK-3's `open` list) — it is idempotent and
  //     Vercel fires it hourly regardless — but the trim is a real, cheap
  //     failure mode and the two belong in one edit.
  // ──────────────────────────────────────────────────────────────────────────
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
      // CHK-3 defect fix, 2026-08-10 — the floor's input. Its absence from this
      // select is the whole of the second defect: the job enumerated
      // store × day × template and never asked when the template began.
      createdAt: true,
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
          frequencyExcluded: 0,
          frequencyLeftOpen: 0,
          beforeTemplateCreation: 0,
          preexisting: 0,
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
            // CHK-3 defect fix, 2026-08-10 — `frequency` joined on so the
            // closing site can ask the same question the materialisation site
            // asks. Under DEBT-61 bulk generate creates a Weekly row every day,
            // so this is where most non-Daily fiction was actually written.
            template: { select: { frequency: true, tasks: { select: { id: true } } } },
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

          // ── DAILY ONLY AT THE CLOSING SITE TOO (Gary, 2026-08-10) ──────────
          // THE LARGER HALF OF THE DEFECT, not belt-and-braces on the smaller
          // one. The materialisation gate only ever protected templates with NO
          // row; under DEBT-61 bulk generate creates a Weekly template's
          // checklist EVERY day, so those rows exist, and this loop swept them
          // to Missed six days a week. The exclusion is worth nothing if it
          // only holds where nothing was generated.
          //
          // THE COST, STATED HERE AND COUNTED IN THE BODY: a non-Daily
          // checklist somebody genuinely started and abandoned is now never
          // closed. It keeps `closedAt: null` and reads `overdue` indefinitely,
          // because overdue is derived and this job writes the only terminal
          // state there is. The refinement that would keep both — close a
          // non-Daily row with task logs or a startedAt, skip one that was only
          // generated — is a RULING, not a default, and it is named in the
          // CHK-3 rider rather than assumed here.
          if (!dayCloseAppliesTo(c.template.frequency)) {
            dayResult.frequencyLeftOpen++
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
          // COUNTED, NOT SILENT (CHK-3 defect fix, 2026-08-10). This guard runs
          // BEFORE every rule below it, so a template with a row for this
          // store-day was never asked about frequency and never asked about its
          // creation date. That is correct behaviour and it was invisible
          // behaviour: a body reading `frequencySkipped: 0, materialized: 0` is
          // exactly what a day with fiction already on disk looks like.
          if (haveTemplate.has(t.id)) {
            dayResult.preexisting++
            continue
          }
          if (t.appliesTo === "selected" && !t.storeAssignments.some((a) => a.storeId === store.id)) continue

          // DAILY ONLY — the engine-level exclusion, ruled in plan §5.4/§12.8.
          // Template.frequency is read by no generation path, which is DEBT-61:
          // bulk generate already creates a checklist for a Weekly template
          // every day, so an unfiltered job here would file it Missed six days a
          // week. The predicate and the full reasoning live in
          // src/lib/checklist-lifecycle.ts — dayCloseAppliesTo() (a POINTER
          // repaired 2026-08-10 when the predicate was renamed; the sentence
          // itself is CHK-3's and unedited). This is a CONTAINMENT, not a fix;
          // the fix is DEBT-61's.
          if (!dayCloseAppliesTo(t.frequency)) {
            dayResult.frequencyExcluded++
            continue
          }

          // The window as it stands at close, frozen onto the row (plan §3.4).
          // A materialised row carries NO task logs and NO sectionsSnapshot: it
          // is a record that nothing happened, and freezing today's section
          // names onto it would make a guess indistinguishable from an
          // as-executed record — plan §12.5's ruling, one row-type further on.
          // See the S3 note on Checklist.sectionsSnapshot in prisma/schema.prisma.
          const w = expectedWindow(t, hoursRow, day, store.timezone)

          // ── THE createdAt FLOOR (Gary, 2026-08-10) ─────────────────────────
          // NO MISSED ROW FOR A DAY THE TEMPLATE DID NOT EXIST FOR. Measured on
          // staging 2026-08-10: a template created 2026-08-09 ~20:00 carried 24
          // Missed rows dated 08-07 and 08-08 — 12 stores × the full lookback,
          // both days preceding its creation. The job enumerated
          // store × day × template and nothing in it had ever asked when the
          // template began. This is INDEPENDENT of the frequency defect and
          // fires for a plain Daily template too: create one today and, before
          // this floor, the next sweep filed two days of misses against it.
          //
          // THE COMPARISON IS AGAINST THE WINDOW'S END, NOT THE DAY'S START.
          // A template created at 06:00 for an 08:00 Opener window was there to
          // be done and a miss is real; one created at 14:00 for that same
          // window never could have been. Falling back to day close when there
          // is no window (`w?.end ?? dc.at`) keeps the AllDay and blank-offset
          // cases on the same rule rather than exempting them.
          //
          // WHAT IT CANNOT COVER, said out loud: the floor keys on the
          // TEMPLATE's age. `TemplateStoreAssignment` has no `createdAt`, and
          // PATCH /api/templates/[id] deletes and recreates every assignment on
          // each edit, so "this store was added yesterday" is not merely
          // unknown, it is unknowable from the schema. A store newly assigned
          // to an OLD template can still collect up to `DAY_CLOSE_LOOKBACK_DAYS`
          // of misses for days it was not on the template.
          if (t.createdAt >= (w?.end ?? dc.at)) {
            dayResult.beforeTemplateCreation++
            continue
          }

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

  // CHK-3 defect fix, 2026-08-10 — one summer over every per-day counter, so
  // adding a counter can never again mean adding one nobody totals.
  const total = (pick: (d: DayResult) => number) =>
    results.reduce((n, r) => n + r.days.reduce((m, d) => m + pick(d), 0), 0)

  const markedMissed = total((d) => d.markedMissed)
  const materialized = total((d) => d.materialized)
  const frequencyExcluded = total((d) => d.frequencyExcluded)
  const frequencyLeftOpen = total((d) => d.frequencyLeftOpen)
  const beforeTemplateCreation = total((d) => d.beforeTemplateCreation)
  const preexisting = total((d) => d.preexisting)
  const raced = total((d) => d.raced)
  const daysClosed = results.reduce((n, r) => n + r.days.filter((d) => d.outcome === "closed").length, 0)
  const errors = results.filter((r) => r.error).length

  // THE LOG LINE CARRIES THE EXCLUSIONS NOW. The old line reported only what
  // was written, so a sweep that wrote nothing and a sweep that excluded
  // everything read identically in the Runtime Logs — and the Runtime Logs are
  // often the only surface anyone looks at.
  console.log(
    `[cron:checklist-day-close] ${stores.length} stores, ${daysClosed} store-days closed, ${markedMissed} marked missed, ${materialized} materialized, ${errors} errors ` +
      `(excluded: ${frequencyExcluded} non-daily new, ${frequencyLeftOpen} non-daily left open, ${beforeTemplateCreation} pre-creation, ${preexisting} already had a row, ${raced} raced; ` +
      `grace ${DAY_CLOSE_GRACE_HOURS}h, lookback ${DAY_CLOSE_LOOKBACK_DAYS}d)`
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
    frequencyExcluded,
    frequencyLeftOpen,
    beforeTemplateCreation,
    preexisting,
    raced,
    errors,
    results,
  })
}
