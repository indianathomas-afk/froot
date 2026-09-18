import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { hoursForDate } from "@/lib/checklist-lifecycle"
import { dueAtFor, nextDueDate, type ProjectableEvent } from "@/lib/calendar"

// GET /api/cron/calendar-materialize — CAL-1. THE ONLY WRITER OF A
// CalendarOccurrence ROW.
//
// Every hour, for each org with the calendar enabled, for each active event and
// each store it applies to: if there is no Open occurrence, work out the next
// date that has come due and create it with `dueAt` frozen.
//
// Registered in vercel.json at "0 * * * *"; Vercel calls it with
// "Authorization: Bearer ${CRON_SECRET}". Shaped on
// api/cron/checklist-day-close/route.ts — same auth, same maxDuration, same
// per-unit try/catch, same summary log, same proof-surface body.
//
// HOURLY, NOT DAILY, for the reason day close is: a daily UTC cron fires at one
// instant for stores across several timezones, and hourly lets each store's
// "today" arrive on its own clock while making a skipped run self-healing.
//
// ── ONE OPEN OCCURRENCE PER EVENT PER STORE (ruling 3) ──────────────────────
// The next occurrence is NOT materialised until the current one is completed.
// So an event with an open row is skipped entirely — it does not accrue a
// backlog, which is exactly the "litter" failure DEBT-61 records for bulk
// generate, where a Weekly template silently gains one Pending row per store
// per day forever. A reminder nobody does stays as ONE overdue row.
//
// ── REMINDERS ARE NEVER AUTO-CLOSED AS MISSED (ruling 4) ────────────────────
// This job never writes a terminal state. It creates and it does nothing else.
// There is no calendar equivalent of day close, and CHK-3's cron does not know
// this table exists.
//
// ── ORG SCOPE — A DELIBERATE DIVERGENCE FROM THE DAY-CLOSE CRON ─────────────
// That job takes NO org scope on the stated principle that inventing an org
// filter "would just be a way to miss a tenant"
// (api/cron/checklist-day-close/route.ts). This one iterates orgs, and the
// difference is real rather than a copy error: `calendarEnabled` is a PRODUCT
// PREDICATE — ruling 9 says an org with the calendar off must have nothing
// written for it — not a scoping habit. Approved by Gary with the CAL-1 plan.
// Every write below is still keyed to the store's own organizationId, exactly
// as day close does it.

export const maxDuration = 300

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002"
}

type OrgResult = {
  organizationId: string
  events: number
  scanned: number
  materialized: number
  skippedOpen: number
  skippedFuture: number
  raced: number
  error?: string
}

export async function GET(req: Request) {
  // ── THE SECRET CHECK, COPIED VERBATIM FROM THE DAY-CLOSE CRON ──────────────
  // Including its two known weaknesses, and that is a RULING rather than an
  // oversight (Gary, 2026-09-17): the comparison below is neither `.trim()`ed
  // nor constant-time. `process.env.CRON_SECRET` can carry a trailing newline
  // from a paste into the Vercel dashboard, which fails `!==` and reads exactly
  // like a wrong value — the failure that cost an afternoon
  // (docs/prompts/CRON-DIAG_findings.md). `!==` on strings is also
  // timing-variable.
  //
  // BOTH ARE FILED AS ONE ROADMAP ROW COVERING EVERY CRON ROUTE, and the
  // instruction is explicit: DO NOT FIX ONE ROUTE IN ISOLATION. Five crons
  // sharing a weakness is a sweep; one fixed and four not is a divergence
  // nobody can see. If you are here to harden this, harden all of them.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()

  const orgs = await prisma.organization.findMany({
    where: { calendarEnabled: true },
    select: { id: true },
  })
  // Counted, not silently absent: a run that materialised nothing because every
  // org has the calendar off and a run that materialised nothing because
  // everything was already open must not read identically in the Runtime Logs.
  // That is the CHK-3 counter lesson applied before it can bite.
  const skippedDisabled = await prisma.organization.count({ where: { calendarEnabled: false } })

  const results: OrgResult[] = []

  for (const org of orgs) {
    const result: OrgResult = {
      organizationId: org.id,
      events: 0,
      scanned: 0,
      materialized: 0,
      skippedOpen: 0,
      skippedFuture: 0,
      raced: 0,
    }
    results.push(result)

    try {
      const stores = await prisma.store.findMany({
        where: { organizationId: org.id, isActive: true },
        select: { id: true, timezone: true, hours: true },
      })
      if (stores.length === 0) continue

      const events = await prisma.calendarEvent.findMany({
        where: { organizationId: org.id, isArchived: false },
        include: { storeAssignments: { select: { storeId: true } } },
      })
      result.events = events.length

      for (const event of events) {
        const projectable: ProjectableEvent = {
          recurrence: event.recurrence,
          startDate: event.startDate.toISOString().slice(0, 10),
          endDate: event.endDate ? event.endDate.toISOString().slice(0, 10) : null,
        }

        // Ruling 2: "all stores" fans out per store, and every occurrence
        // belongs to exactly one store.
        const applicable =
          event.appliesTo === "all"
            ? stores
            : stores.filter((s) => event.storeAssignments.some((a) => a.storeId === s.id))

        for (const store of applicable) {
          result.scanned++

          const open = await prisma.calendarOccurrence.findFirst({
            where: { eventId: event.id, storeId: store.id, status: "Open" },
            select: { id: true },
          })
          if (open) {
            result.skippedOpen++
            continue
          }

          // The last COMPLETED due date is where the next one is counted from.
          // Reading the latest completion rather than counting rows is what
          // lets a PATCH delete the Open row and re-derive without losing the
          // event's place in its own cycle.
          const lastCompleted = await prisma.calendarOccurrence.findFirst({
            where: { eventId: event.id, storeId: store.id, status: "Completed" },
            orderBy: { dueDate: "desc" },
            select: { dueDate: true },
          })
          const afterDate = lastCompleted ? lastCompleted.dueDate.toISOString().slice(0, 10) : null

          const next = nextDueDate(projectable, afterDate)
          if (!next) {
            // Past endDate — the event has finished and will never come due again.
            result.skippedFuture++
            continue
          }

          // TODAY IS THE STORE'S, NOT THE SERVER'S. An occurrence must not
          // appear before its own store's day has reached it.
          const today = localDateStr(now, store.timezone)
          if (next > today) {
            result.skippedFuture++
            continue
          }

          // dueAt IS FROZEN HERE (ruling 8), against the store's hours for that
          // date, with graceHours 0 — a reminder is due when the store shuts,
          // not three hours later like a checklist's day close (R3).
          const dueAt = dueAtFor(store, hoursForDate(store.hours, next), next, event.dueTime)

          try {
            await prisma.calendarOccurrence.create({
              data: {
                organizationId: org.id,
                eventId: event.id,
                storeId: store.id,
                dueDate: new Date(`${next}T00:00:00.000Z`),
                dueAt,
              },
            })
            result.materialized++
          } catch (e) {
            // Read-then-write, guarded by @@unique([eventId, storeId, dueDate]).
            // A concurrent run loses the race and is counted, never failed.
            if (isUniqueViolation(e)) result.raced++
            else throw e
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "calendar materialize failed"
      result.error = msg.slice(0, 200)
      console.error(`[cron:calendar-materialize] org=${org.id}: ${msg}`)
    }
  }

  // One summer over every per-org counter, so adding a counter can never mean
  // adding one nobody totals (the CHK-3 defect fix, applied at birth here).
  const total = (pick: (r: OrgResult) => number) => results.reduce((n, r) => n + pick(r), 0)
  const scanned = total((r) => r.scanned)
  const materialized = total((r) => r.materialized)
  const skippedOpen = total((r) => r.skippedOpen)
  const skippedFuture = total((r) => r.skippedFuture)
  const raced = total((r) => r.raced)
  const events = total((r) => r.events)
  const errors = results.filter((r) => r.error).length

  console.log(
    `[cron:calendar-materialize] ${orgs.length} orgs enabled (${skippedDisabled} disabled), ${events} events, ` +
      `${scanned} event-store pairs scanned, ${materialized} materialized, ${errors} errors ` +
      `(skipped: ${skippedOpen} already open, ${skippedFuture} not yet due or ended; ${raced} raced)`
  )

  // THIS BODY IS A PROOF SURFACE — the cron ships no UI, so it and SQL are the
  // only evidence the engine works. It never contains the secret.
  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    orgs: orgs.length,
    events,
    scanned,
    materialized,
    skippedOpen,
    skippedFuture,
    skippedDisabled,
    raced,
    errors,
    results,
  })
}
