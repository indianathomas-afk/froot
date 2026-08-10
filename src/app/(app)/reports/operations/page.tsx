import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { ArrowLeft, Info } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { dbDate, localDateStr } from "@/lib/reports"
import {
  DAY_CLOSE_GRACE_HOURS,
  checklistState,
  dayCloseAppliesTo,
  dayCloseInstant,
  hoursForDate,
  isCompletedLate,
  shiftDateStr,
  type DayCloseSource,
  type HoursRow,
} from "@/lib/checklist-lifecycle"
import { frozenWindow } from "@/lib/checklist-status-display"
import { OperationsFilters } from "./operations-filters"

// ─── The operations report (CHK-5, R4) ───────────────────────────────────────
//
// Missed and completed-late, by store × day × template, across a date range.
// A PURE READ SURFACE — it writes nothing, and it DERIVES nothing.
//
// EVERY STATE ON THIS PAGE COMES FROM src/lib/checklist-lifecycle.ts. There is
// no `status === "Missed"` anywhere below, no re-implementation of "late", and
// no second opinion about which templates are tracked. That is DEBT-26's
// discipline, and CHK-3's defect is the reason it is stated rather than
// assumed: a second definition site does not disagree loudly, it disagrees
// quietly and then gets believed because it has a plausible name.
//
//   missed          → checklistState(...) === "missed"   (closedAt set, not Completed)
//   completed late  → isCompletedLate(row)               (the stored column, written by submit)
//   tracked at all  → dayCloseAppliesTo(template.frequency)
//   window          → frozenWindow(row) — the window the row was JUDGED against,
//                     never a window recomputed from today's hours
//   day close       → dayCloseInstant(...).source — the no-hours fallback signal
//
// THE GATE IS THE LAYOUT'S. reports/layout.tsx already redirects anyone without
// `reports.view` (MANAGE — ADMIN + MANAGER), and this route is a child of it, so
// it inherits that check with no new capability and no permissions.ts edit. A
// second check here could only ever disagree with the first (TPL-1 Q3).
// Store scoping is getUserStoreScope(), the /checklists precedent.

export const dynamic = "force-dynamic"

/** How many days the default range covers, ending on the latest store-local day. */
const DEFAULT_RANGE_DAYS = 7

/** Longest range the page will honour — a guard on the query, not a policy. */
const MAX_RANGE_DAYS = 92

interface Bucket {
  key: string
  label: string
  /** Only set on the by-store view — the day-close provenance column. */
  sub?: string
  total: number
  completed: number
  completedLate: number
  missed: number
  noWindow: number
}

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, total: 0, completed: 0, completedLate: 0, missed: 0, noWindow: 0 }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A "YYYY-MM-DD" from the URL, or null. Never trusted into a query unparsed. */
function cleanDate(value: string | undefined): string | null {
  return value && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : null
}

/** "Mon, Aug 10" for a store-local date string, rendered in UTC so the label
 *  cannot drift a day against `Checklist.date`'s UTC-midnight convention. */
function dayLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateStr}T00:00:00.000Z`))
}

/**
 * WHY A STORE'S DAY ENDED WHEN IT DID, summarised over the range — the second
 * visible fallback signal, handed over by CHK-3 ("the two VISIBLE signals — a
 * note on /stores, a column on the operations report — are CHK-4/CHK-5 surface
 * work, and they read this").
 *
 * It is computed per DATE rather than read off the checklist row because there
 * is no `dayCloseSource` column: the engine exposes the fact queryably through
 * `dayCloseInstant()`, and asking it here is reading the engine, not copying it.
 *
 * The three fallback reasons are kept apart exactly as the lib keeps them apart
 * — "you marked Sunday closed" and "nobody has ever set this store's hours" are
 * different facts, and merging them tells an operator to fix something they
 * already did.
 */
function dayCloseSummary(hours: HoursRow[], dates: string[], timeZone: string): string {
  const counts = new Map<DayCloseSource, number>()
  for (const d of dates) {
    const source = dayCloseInstant(hoursForDate(hours, d), d, timeZone).source
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  const fallbackDays = dates.length - (counts.get("hours") ?? 0)
  if (fallbackDays === 0) return "Store hours"

  const reason = counts.get("no-hours")
    ? "hours not set"
    : counts.get("no-close-time")
      ? "no closing time"
      : "closed days"
  return fallbackDays === dates.length
    ? `Midnight fallback — ${reason}`
    : `Midnight fallback ${fallbackDays}/${dates.length} days — ${reason}`
}

async function getOperationsData(params: { store?: string; from?: string; to?: string; view?: string }) {
  // ONE INSTANT FOR THE WHOLE RENDER (the /checklists precedent) — taking
  // `new Date()` per row would let two rows on one page be judged against
  // different "now"s.
  const now = new Date()

  const { orgId } = await auth()
  if (!orgId) return null
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return null

  const { isAdmin, storeIds } = await getUserStoreScope()

  const stores = await prisma.store.findMany({
    where: isAdmin ? { organizationId: org.id } : { organizationId: org.id, id: { in: storeIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, timezone: true },
  })

  // The requested store is validated against what this user may actually see —
  // never trusted from the URL. A single-store non-admin is hard-locked
  // regardless of the param. Same rule as checklists/page.tsx.
  let effectiveStoreId: string | undefined
  if (!isAdmin) {
    if (storeIds.length === 1) effectiveStoreId = storeIds[0]
    else if (params.store && storeIds.includes(params.store)) effectiveStoreId = params.store
  } else if (params.store && stores.some((s) => s.id === params.store)) {
    effectiveStoreId = params.store
  }
  const scopedStores = effectiveStoreId ? stores.filter((s) => s.id === effectiveStoreId) : stores

  // Default range ends on the LATEST store-local day in scope, so a store whose
  // "today" has already rolled over is never cut off by the server's UTC date.
  const latestLocalDay = scopedStores.reduce<string>(
    (acc, s) => { const d = localDateStr(now, s.timezone); return d > acc ? d : acc },
    localDateStr(now, "UTC")
  )
  let to = cleanDate(params.to) ?? latestLocalDay
  let from = cleanDate(params.from) ?? shiftDateStr(to, -(DEFAULT_RANGE_DAYS - 1))
  if (from > to) [from, to] = [to, from]
  if (dbDate(to).getTime() - dbDate(from).getTime() > MAX_RANGE_DAYS * 86_400_000) {
    from = shiftDateStr(to, -(MAX_RANGE_DAYS - 1))
  }

  const view = ["store", "day", "template"].includes(params.view ?? "") ? params.view! : "store"

  const dates: string[] = []
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) dates.push(d)

  const scopedIds = scopedStores.map((s) => s.id)
  const [checklists, hoursRows] = await Promise.all([
    prisma.checklist.findMany({
      where: {
        organizationId: org.id,
        storeId: { in: scopedIds },
        // Checklist.date is the UTC-midnight stamp of a STORE-LOCAL day
        // (src/lib/reports.ts dbDate/businessDayWindow), so a plain range over
        // the two date strings is timezone-free and needs no per-store OR.
        date: { gte: dbDate(from), lte: dbDate(to) },
      },
      select: {
        id: true,
        date: true,
        status: true,
        closedAt: true,
        completedLate: true,
        expectedStartAt: true,
        expectedEndAt: true,
        storeId: true,
        templateId: true,
        template: { select: { name: true, frequency: true } },
      },
    }),
    prisma.storeHours.findMany({
      where: { storeId: { in: scopedIds } },
      select: { storeId: true, dayOfWeek: true, openingTime: true, closingTime: true, isClosed: true },
    }),
  ])

  const hoursByStore = new Map<string, HoursRow[]>()
  for (const r of hoursRows) hoursByStore.set(r.storeId, [...(hoursByStore.get(r.storeId) ?? []), r])

  const byStore = new Map<string, Bucket>()
  const byDay = new Map<string, Bucket>()
  const byTemplate = new Map<string, Bucket>()
  const totals = emptyBucket("all", "All")

  // Rows the report will NOT judge, counted so the exclusion is a number on the
  // page rather than an absence. DEBT-61 is the open row behind it; the page
  // says so in plain words and never cites the row on screen.
  let excludedNonDaily = 0

  for (const c of checklists) {
    if (!dayCloseAppliesTo(c.template.frequency)) {
      excludedNonDaily++
      continue
    }

    const window = frozenWindow(c)
    const state = checklistState(c, window, now)
    const late = isCompletedLate(c)
    const dayStr = localDateStr(c.date, "UTC")
    const store = scopedStores.find((s) => s.id === c.storeId)

    const targets = [
      totals,
      byStore.get(c.storeId) ?? byStore.set(c.storeId, emptyBucket(c.storeId, store?.name ?? "Unknown store")).get(c.storeId)!,
      byDay.get(dayStr) ?? byDay.set(dayStr, emptyBucket(dayStr, dayLabel(dayStr))).get(dayStr)!,
      byTemplate.get(c.templateId) ?? byTemplate.set(c.templateId, emptyBucket(c.templateId, c.template.name)).get(c.templateId)!,
    ]
    for (const b of targets) {
      b.total++
      if (state === "completed") b.completed++
      if (state === "missed") b.missed++
      if (late) b.completedLate++
      if (window === null) b.noWindow++
    }
  }

  // The day-close provenance column, per store, over the selected range.
  for (const s of scopedStores) {
    const bucket = byStore.get(s.id)
    if (bucket) bucket.sub = dayCloseSummary(hoursByStore.get(s.id) ?? [], dates, s.timezone)
  }

  const rows =
    view === "day"
      ? [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key))
      : view === "template"
        ? [...byTemplate.values()].sort((a, b) => b.missed - a.missed || a.label.localeCompare(b.label))
        : [...byStore.values()].sort((a, b) => b.missed - a.missed || a.label.localeCompare(b.label))

  // Which stores in scope are running on the midnight fallback — the third
  // disclosure, named rather than left for the reader to spot in a column.
  const fallbackStores = scopedStores
    .filter((s) => dayCloseSummary(hoursByStore.get(s.id) ?? [], dates, s.timezone) !== "Store hours")
    .map((s) => s.name)

  return {
    rows,
    totals,
    view,
    from,
    to,
    stores,
    selectedStoreId: effectiveStoreId ?? "all",
    showStorePicker: !(!isAdmin && storeIds.length === 1),
    excludedNonDaily,
    fallbackStores,
  }
}

function rate(b: Bucket): string {
  return b.total > 0 ? `${Math.round((b.completed / b.total) * 100)}%` : "—"
}

export default async function OperationsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; from?: string; to?: string; view?: string }>
}) {
  const params = await searchParams
  const data = await getOperationsData(params)

  if (!data) {
    return <div className="p-8 text-sm text-[var(--color-muted-foreground)]">No organization in context.</div>
  }

  const { rows, totals, view, from, to, stores, selectedStoreId, showStorePicker, excludedNonDaily, fallbackStores } = data
  const firstColumn = view === "day" ? "Day" : view === "template" ? "Template" : "Store"

  return (
    <div>
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Reports
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Operations Report</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Checklists missed and completed late — by store, by day, and by template
        </p>
      </div>

      <OperationsFilters
        stores={stores}
        selectedStoreId={selectedStoreId}
        showStorePicker={showStorePicker}
        from={from}
        to={to}
        view={view}
      />

      {/* Headline numbers for the whole range, so the three views cannot each
          imply a different total. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Missed", value: totals.missed, sub: "Day closed without completion", tone: "text-[var(--color-destructive)]" },
          { label: "Completed late", value: totals.completedLate, sub: "Done, after the expected window", tone: "text-[var(--color-foreground)]" },
          { label: "Completed", value: totals.completed, sub: "On time or late", tone: "text-[var(--color-success-text)]" },
          { label: "Completion rate", value: rate(totals), sub: `of ${totals.total} tracked checklists`, tone: "text-[var(--color-foreground)]" },
        ].map(({ label, value, sub, tone }) => (
          <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5">
            <p className="text-sm text-[var(--color-muted-foreground)]">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${tone}`}>{value}</p>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-[var(--color-foreground)]">{firstColumn} breakdown</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            {from} to {to}
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">
            No tracked checklists in this range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {[firstColumn, "Missed", "Completed late", "Completed", "Total", "No expected window", "Rate"].map((h) => (
                    <th
                      key={h}
                      className={`text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3 ${h === firstColumn ? "text-left" : "text-center"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.key} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30">
                    <td className="px-6 py-3 text-sm text-[var(--color-foreground)]">
                      {b.label}
                      {b.sub && (
                        <span className="block text-xs text-[var(--color-muted-foreground)] mt-0.5">{b.sub}</span>
                      )}
                    </td>
                    <td className={`px-6 py-3 text-sm text-center font-medium ${b.missed > 0 ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"}`}>
                      {b.missed}
                    </td>
                    <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{b.completedLate}</td>
                    <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{b.completed}</td>
                    <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{b.total}</td>
                    <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{b.noWindow}</td>
                    <td className="px-6 py-3 text-sm text-center font-medium text-[var(--color-foreground)]">{rate(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── THE THREE DISCLOSURES (plan §7) ───────────────────────────────────
          Each one is a place a clean-looking number on this page would
          otherwise mislead. They are on the report's own face, in plain words,
          because a reader who has to go and find the caveat has already drawn
          the wrong conclusion. No row ids on screen — DEBT-61 and Migration B
          are the engineering names for these, and an operator should not have
          to know them. */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)] mb-3">
          <Info className="h-4 w-4" /> What this report does not cover
        </p>
        <ul className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
          <li>
            <strong className="text-[var(--color-foreground)]">Only daily checklists are tracked.</strong>{" "}
            Weekly and monthly templates are not yet scheduled or judged, so they are left out of every number above
            {excludedNonDaily > 0 ? ` (${excludedNonDaily} checklist${excludedNonDaily === 1 ? "" : "s"} in this range).` : "."}{" "}
            For those templates, &ldquo;no misses&rdquo; means &ldquo;not tracked yet&rdquo; — not &ldquo;all done&rdquo;.
          </li>
          <li>
            <strong className="text-[var(--color-foreground)]">Tracking started when this feature shipped.</strong>{" "}
            Checklists from before then have no expected window recorded, and neither do all-day templates or ones with
            no start and end times set. They are counted in the &ldquo;No expected window&rdquo; column and are never
            reported as on time or late — nobody set an expectation for them to meet.
          </li>
          <li>
            <strong className="text-[var(--color-foreground)]">
              {fallbackStores.length === 0
                ? "Every store in this range is judged against its own opening hours."
                : `${fallbackStores.length} store${fallbackStores.length === 1 ? " is" : "s are"} judged against midnight, not opening hours.`}
            </strong>{" "}
            {fallbackStores.length === 0
              ? `A store's day closes ${DAY_CLOSE_GRACE_HOURS} hours after it closes.`
              : `${fallbackStores.join(", ")} — no closing time is set for some days, so the day is treated as ending at midnight plus ${DAY_CLOSE_GRACE_HOURS} hours. Set the store's hours to judge it against its real closing time.`}{" "}
            The &ldquo;{firstColumn === "Store" ? "Store" : "By store"}&rdquo; view shows this per store.
          </li>
        </ul>
      </div>
    </div>
  )
}
