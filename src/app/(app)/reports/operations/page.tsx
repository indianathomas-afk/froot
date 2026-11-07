import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { ArrowLeft, Info } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { dbDate, localDateStr } from "@/lib/reports"
import { DAY_CLOSE_GRACE_HOURS, shiftDateStr } from "@/lib/checklist-lifecycle"
import { completionPct, computeOperationsReport, type OperationsBucket as Bucket } from "@/lib/operations-report"
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
//   tracked at all  → dayCloseJudgesChecklist(dayCloseAppliesTo(frequency),
//                     calendarOccurrenceId) — CAL-2, ruling 4. A scheduled
//                     weekly template IS tracked; an unscheduled one is not.
//   window          → frozenWindow(row) — the window the row was JUDGED against,
//                     never a window recomputed from today's hours
//   day close       → dayCloseInstant(...).source — the no-hours fallback signal
//
// THE GATE IS THE LAYOUT'S. reports/layout.tsx already redirects anyone without
// `reports.view` (MANAGE — ADMIN + MANAGER), and this route is a child of it, so
// it inherits that check with no new capability and no permissions.ts edit. A
// second check here could only ever disagree with the first (TPL-1 Q3).
// Store scoping is getUserStoreScope(), the /checklists precedent.
//
// NOTIFY-4 (F9, Gary 2026-11-06): THE COMPUTATION NOW LIVES IN
// src/lib/operations-report.ts — computeOperationsReport(), moved there
// unchanged so the Tasks and Communication email calls the same definition.
// This page resolves the org, the viewer's scope and the range, then calls it.

export const dynamic = "force-dynamic"

/** How many days the default range covers, ending on the latest store-local day. */
const DEFAULT_RANGE_DAYS = 7

/** Longest range the page will honour — a guard on the query, not a policy. */
const MAX_RANGE_DAYS = 92

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A "YYYY-MM-DD" from the URL, or null. Never trusted into a query unparsed. */
function cleanDate(value: string | undefined): string | null {
  return value && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : null
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

  const report = await computeOperationsReport({ organizationId: org.id, stores: scopedStores, from, to, now })
  const { byStore, byDay, byTemplate, totals, excludedUnscheduled, fallbackStores } = report

  const rows =
    view === "day"
      ? [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key))
      : view === "template"
        ? [...byTemplate.values()].sort((a, b) => b.missed - a.missed || a.label.localeCompare(b.label))
        : [...byStore.values()].sort((a, b) => b.missed - a.missed || a.label.localeCompare(b.label))

  return {
    rows,
    totals,
    view,
    from,
    to,
    stores,
    selectedStoreId: effectiveStoreId ?? "all",
    showStorePicker: !(!isAdmin && storeIds.length === 1),
    excludedUnscheduled,
    fallbackStores,
  }
}

function rate(b: Bucket): string {
  const pct = completionPct(b)
  return pct === null ? "—" : `${pct}%`
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

  const { rows, totals, view, from, to, stores, selectedStoreId, showStorePicker, excludedUnscheduled, fallbackStores } = data
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
            <strong className="text-[var(--color-foreground)]">Only scheduled checklists are tracked.</strong>{" "}
            Daily templates are tracked automatically; weekly and monthly ones are tracked once they are added to the
            calendar. A weekly or monthly template with no calendar entry is left out of every number above
            {excludedUnscheduled > 0
              ? ` (${excludedUnscheduled} checklist${excludedUnscheduled === 1 ? "" : "s"} in this range).`
              : "."}{" "}
            For those, &ldquo;no misses&rdquo; means &ldquo;not scheduled yet&rdquo; — not &ldquo;all done&rdquo;.
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
