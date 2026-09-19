import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { hoursForDate } from "@/lib/checklist-lifecycle"
import { dueAtFor, nextDueDate, type ProjectableEvent } from "@/lib/calendar"
import { createChecklistForDate } from "@/app/api/checklists/expectations"

// GET /api/cron/calendar-materialize — CAL-1. THE ONLY WRITER OF A
// CalendarOccurrence ROW.
//
// ── CAL-2: IT IS NOW ALSO A WRITER OF Checklist, AND THAT IS STILL ONE AUTHOR
// RATHER THAN TWO ──────────────────────────────────────────────────────────
// A template-backed occurrence CREATES THE CHECKLIST for (template, store,
// dueDate) in the same transaction as the occurrence itself. That is what
// closes DEBT-61: Template.frequency said Weekly and no generation path read
// it, because a Weekly template needs a day-of-week that nobody collected.
// CalendarEvent.recurrence + startDate collect one, projectDueDates() resolves
// it, and this is where the answer finally becomes a row.
//
// The checklist is made through createChecklistForDate() in
// api/checklists/expectations.ts — THE SAME FUNCTION the single create and the
// bulk loop call, so the CHK-3 expected-window freeze has one implementation
// and this cron is a third CALLER rather than a third COPY.
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
// ── THIS CRON AND checklist-day-close SHARE A MINUTE (CAL-2) ────────────────
// vercel.json schedules both at "0 * * * *" and VERCEL DOES NOT ORDER CRONS.
// Before CAL-2 they shared no table; now they share Checklist. Neither order is
// wrong — day close only closes a row whose day-close instant has PASSED, and a
// row materialised this hour has not reached one — so the pair is safe in
// either direction. Recorded here rather than left to be rediscovered from a
// Runtime Log at an awkward moment.
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
  // ── CAL-2 counters. EVERY ONE OF THESE IS ALSO SUMMED AT THE BOTTOM OF THIS
  // FILE — a counter that only exists inside results[] is a counter nobody
  // reads (the CHK-3 defect fix, obeyed rather than quoted).
  /** Checklists created for a template-backed occurrence. */
  checklistsCreated: number
  /** A checklist already existed for (store, template, date) and was LINKED
   *  instead of duplicated — almost always DEBT-61 litter being adopted. */
  adoptedExisting: number
  /** R4's reversible half: the template is deactivated or archived, so its
   *  event generates nothing. Nothing is archived and nothing is deleted. */
  skippedInactiveTemplate: number
  /** The transaction rolled back — no occurrence, no checklist, retried next
   *  run. Distinct from `raced`, which is a benign lost race. */
  checklistFailed: number
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
      checklistsCreated: 0,
      adoptedExisting: 0,
      skippedInactiveTemplate: 0,
      checklistFailed: 0,
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
        include: {
          storeAssignments: { select: { storeId: true } },
          // CAL-2. Null for a reminder. The five window fields are what
          // freezeWindow() needs (WindowTemplate), loaded here so the inner
          // loop costs no extra round trip — the CHK-3 hoursByStore argument,
          // one level out.
          template: {
            select: {
              id: true,
              isActive: true,
              isArchived: true,
              availabilityType: true,
              operationalPhase: true,
              startOffsetHours: true,
              endOffsetHours: true,
            },
          },
        },
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

        // ── R4 (Gary, 2026-09-18) — DEACTIVATE IS REVERSIBLE, ARCHIVE IS
        // TERMINAL. THIS IS THE REVERSIBLE HALF ───────────────────────────────
        // An inactive or archived template's event is SKIPPED: nothing is
        // archived, nothing is deleted, no occurrence is created, and
        // REACTIVATING THE TEMPLATE RESUMES GENERATION ON THE NEXT RUN with the
        // event, its schedule and its completion history all intact. The
        // terminal half lives in PATCH /api/templates/[id], which cascades the
        // archive onto the events themselves.
        //
        // BOTH FLAGS, NOT JUST isArchived. DEBT-65 measured that at Keva
        // "archiving" is performed with DEACTIVATE — five templates
        // isActive=false and ZERO isArchived=true on dev and staging,
        // 2026-08-10 — and that archiving does not clear isActive, so
        // `isArchived && isActive` is an archived template's normal state. A
        // check on one flag would be correct and inert, which is precisely the
        // mistake that row's first fix made.
        if (event.templateId && (!event.template?.isActive || event.template.isArchived)) {
          result.skippedInactiveTemplate += applicable.length
          continue
        }

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
          // CAL-2 — "Completed OR MISSED" (ruling 4). A template-backed
          // occurrence that day close filed as Missed is TERMINAL, and the
          // cycle must advance past it: reading Completed alone would leave a
          // missed week as the newest terminal row forever, so nextDueDate()
          // would keep returning a date already behind us and the event would
          // never come due again. Safe for reminders by construction — a
          // reminder is never auto-closed as Missed (CAL-1 ruling 4), so no
          // reminder row can carry that status.
          const lastTerminal = await prisma.calendarOccurrence.findFirst({
            where: { eventId: event.id, storeId: store.id, status: { in: ["Completed", "Missed"] } },
            orderBy: { dueDate: "desc" },
            select: { dueDate: true },
          })
          const afterDate = lastTerminal ? lastTerminal.dueDate.toISOString().slice(0, 10) : null

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

          // ── ONE TRANSACTION, SO A HALF-MADE PAIR CANNOT EXIST (CAL-2) ─────
          // Ruling 3 makes the checklist the occurrence's whole point: an
          // occurrence with no checklist is a row whose "Open checklist"
          // control opens nothing, and nobody would find out until they tapped
          // it. If the checklist cannot be made, THE OCCURRENCE IS NOT MADE
          // EITHER and the next hourly run tries again — self-healing, the same
          // property the hourly schedule buys everywhere else in this file.
          //
          // A REMINDER WRITES THE OCCURRENCE ALONE, exactly as it did in CAL-1.
          const tplForChecklist = event.templateId ? event.template : null
          try {
            const outcome = await prisma.$transaction(async (tx) => {
              const occurrence = await tx.calendarOccurrence.create({
                data: {
                  organizationId: org.id,
                  eventId: event.id,
                  storeId: store.id,
                  dueDate: new Date(`${next}T00:00:00.000Z`),
                  dueAt,
                },
              })
              if (!tplForChecklist) return { adopted: false, madeChecklist: false }

              // THE SAME FUNCTION THE TWO api/checklists PATHS CALL. The
              // expected window is frozen here, at materialisation, against
              // THIS store's hours for THIS due date — not today's — which is
              // CHK-3's rule read literally for a date that is not today.
              const { adopted } = await createChecklistForDate(tx, {
                organizationId: org.id,
                storeId: store.id,
                template: tplForChecklist,
                dateStr: next,
                timeZone: store.timezone,
                hours: store.hours,
                calendarOccurrenceId: occurrence.id,
              })
              return { adopted, madeChecklist: true }
            })

            result.materialized++
            if (outcome.madeChecklist) {
              if (outcome.adopted) result.adoptedExisting++
              else result.checklistsCreated++
            }
          } catch (e) {
            // Read-then-write, guarded by @@unique([eventId, storeId, dueDate]).
            // A concurrent run loses the race and is counted, never failed.
            if (isUniqueViolation(e)) {
              result.raced++
            } else {
              // The checklist half failed and the transaction rolled the
              // occurrence back with it. COUNTED AND LOGGED RATHER THAN THROWN:
              // one event-store pair must not abort the whole org's run, and a
              // silent skip would be indistinguishable from "nothing was due".
              result.checklistFailed++
              const msg = e instanceof Error ? e.message : "checklist creation failed"
              console.error(
                `[cron:calendar-materialize] event=${event.id} store=${store.id} date=${next}: ${msg}`
              )
            }
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
  const checklistsCreated = total((r) => r.checklistsCreated)
  const adoptedExisting = total((r) => r.adoptedExisting)
  const skippedInactiveTemplate = total((r) => r.skippedInactiveTemplate)
  const checklistFailed = total((r) => r.checklistFailed)
  const errors = results.filter((r) => r.error).length

  console.log(
    `[cron:calendar-materialize] ${orgs.length} orgs enabled (${skippedDisabled} disabled), ${events} events, ` +
      `${scanned} event-store pairs scanned, ${materialized} materialized, ${errors} errors ` +
      `(skipped: ${skippedOpen} already open, ${skippedFuture} not yet due or ended, ` +
      `${skippedInactiveTemplate} inactive template; ${raced} raced) ` +
      `checklists: ${checklistsCreated} created, ${adoptedExisting} adopted, ${checklistFailed} failed`
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
    skippedInactiveTemplate,
    raced,
    checklistsCreated,
    adoptedExisting,
    checklistFailed,
    errors,
    results,
  })
}
