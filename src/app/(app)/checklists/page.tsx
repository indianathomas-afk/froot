import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { businessDayWindow } from "@/lib/reports"
import { isOverdue, isCompletedLate } from "@/lib/checklist-lifecycle"
import { frozenWindow, STATE_BADGES, COMPLETED_LATE_BADGE } from "@/lib/checklist-status-display"
import { CheckSquare } from "lucide-react"
import Link from "next/link"
import { formatCivilDate } from "@/lib/display-time"
import { StoreFilter } from "./store-filter"

// CHK-4: `Missed` JOINS THE MAP, AND THE `?? STATUS_STYLES.Pending` FALLBACK AT
// THE RENDER SITE BELOW STAYS. Those are two separate decisions and both are
// deliberate. DEBT-63 named the fallback as DEBT-37's class — an unmapped status
// renders as "Not Started", the most wrong of the available answers, silently —
// and it became reachable the moment CHK-3 started writing `Missed`. Mapping the
// status is the fix; keeping the fallback is the safety net for the NEXT status
// somebody adds. The regression test is that no status this app writes reaches
// it: `Pending`, `In Progress`, `Completed`, `Non-Compliant`
// (api/checklists/[id]/submit/route.ts) and `Missed`
// (api/cron/checklist-day-close/route.ts) are now all five mapped.
//
// MISSED IS NOT RED-ALARM AND NOT GREY-NEUTRAL. It is a CLOSED FACT (Gary's R1)
// — past tense, nothing to act on — where `Non-Compliant` above is a verdict on
// work someone actually did. The shared vocabulary is in
// src/lib/checklist-status-display.ts so this pill matches the store view, the
// execution page and the print sheet; it is spelled out here rather than
// imported wholesale because the other four entries are STORED statuses, which
// that module deliberately does not own.
const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  Pending: { label: "Not Started", classes: "bg-gray-100 text-gray-600 border border-gray-200" },
  "In Progress": { label: "In Progress", classes: "bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]" },
  Completed: { label: "Completed", classes: "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]" },
  "Non-Compliant": { label: "Non-Compliant", classes: "bg-red-50 text-[var(--color-destructive)] border border-red-200" },
  Missed: { label: STATE_BADGES.missed!.label, classes: STATE_BADGES.missed!.classes },
}

async function getChecklists(requestedStoreId: string | undefined) {
  // CHK-4: taken before the early returns so every branch hands back the same
  // shape — the render destructures `now` and an empty branch that omitted it
  // would be a type error rather than a missing badge.
  const now = new Date()
  const { orgId } = await auth()
  if (!orgId) return { checklists: [], stores: [], lockedStoreId: null, selectedStoreId: "all", now }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { checklists: [], stores: [], lockedStoreId: null, selectedStoreId: "all", now }

  const { isAdmin, storeIds } = await getUserStoreScope()

  // Stores visible in the filter dropdown — admins see everything, everyone else
  // only ever sees their own assignments.
  const stores = await prisma.store.findMany({
    where: isAdmin ? { organizationId: org.id } : { organizationId: org.id, id: { in: storeIds } },
    orderBy: { name: "asc" },
  })

  // Validate the requested store against what this user is actually allowed to see.
  // Never trust the URL param directly — a non-admin can't widen their own access
  // by editing ?store=, and a single-store non-admin is hard-locked regardless of the param.
  let effectiveStoreId: string | undefined
  if (!isAdmin) {
    if (storeIds.length === 1) {
      effectiveStoreId = storeIds[0]
    } else if (requestedStoreId && storeIds.includes(requestedStoreId)) {
      effectiveStoreId = requestedStoreId
    }
    // else: multi-store non-admin with no/invalid selection → show all their stores
  } else if (requestedStoreId) {
    effectiveStoreId = requestedStoreId
  }

  // "Today" is each store's local business day (Store.timezone), not the
  // server (UTC) day — stores in different timezones get different windows.
  const scopedStores = effectiveStoreId ? stores.filter((s) => s.id === effectiveStoreId) : stores
  const byTz = new Map<string, string[]>()
  for (const s of scopedStores) byTz.set(s.timezone, [...(byTz.get(s.timezone) ?? []), s.id])

  const where: Record<string, unknown> = {
    organizationId: org.id,
    OR: [...byTz.entries()].map(([tz, ids]) => {
      const w = businessDayWindow(now, tz)
      return { storeId: { in: ids }, date: { gte: w.gte, lt: w.lt } }
    }),
  }

  const checklists = await prisma.checklist.findMany({
    where,
    include: {
      store: true,
      // TPL-2 step (2): the type pill reads the joined row. Reached through
      // `checklist.template`, which is why a grep scoped to the templates
      // directory misses this site (docs/prompts/TYPE-1_AUDIT.md §3.1).
      template: { include: { templateType: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
  })

  return {
    checklists,
    stores,
    lockedStoreId: !isAdmin && storeIds.length === 1 ? storeIds[0] : null,
    selectedStoreId: effectiveStoreId ?? "all",
    // CHK-4: ONE INSTANT FOR THE WHOLE RENDER. The overdue predicate is
    // evaluated per card; taking `new Date()` inside the loop would let two
    // cards on the same page be judged against different "now"s.
    now,
  }
}

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const { store } = await searchParams
  const { checklists, stores, lockedStoreId, selectedStoreId, now } = await getChecklists(store)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Daily Checklists</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          {lockedStoreId
            ? `Viewing checklists for ${stores.find((s) => s.id === lockedStoreId)?.name ?? "your location"}`
            : "View and manage daily checklists across all locations"}
        </p>
      </div>

      {/* Filter — hidden entirely when the user is locked to a single store */}
      {!lockedStoreId && (
        <div className="mb-6">
          <StoreFilter stores={stores.map((s) => ({ id: s.id, name: s.name }))} selected={selectedStoreId ?? "all"} />
        </div>
      )}

      {checklists.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <CheckSquare className="h-10 w-10 mx-auto mb-3 text-[var(--color-muted-foreground)] opacity-40" />
          <p className="font-medium text-[var(--color-foreground)] mb-1">No checklists found</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">Generate checklists for your stores using the button in the top right corner</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {checklists.map((checklist) => {
            const statusInfo = STATUS_STYLES[checklist.status] ?? STATUS_STYLES.Pending
            // CHK-4. THE STORED STATUS AND THE DERIVED STATE ARE TWO DIFFERENT
            // CLAIMS AND THE CARD MAKES BOTH. The pill above says what the
            // RECORD holds; these say what is TRUE RIGHT NOW. Overdue has no
            // column by design (src/lib/checklist-lifecycle.ts) — no surface
            // may re-derive it, so this reads the lib's predicate against the
            // window frozen on the row. They cannot contradict each other:
            // `isOverdue` is false the moment `closedAt` is set, so a Missed
            // row never also reads Overdue.
            const window = frozenWindow(checklist)
            const overdue = isOverdue(checklist, window, now)
            const late = checklist.status === "Completed" && isCompletedLate(checklist)
            return (
              <div key={checklist.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-[var(--color-primary)]" />
                    <span className="font-semibold text-sm text-[var(--color-foreground)]">{checklist.store.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {overdue && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATE_BADGES.overdue!.classes}`}>
                        {STATE_BADGES.overdue!.label}
                      </span>
                    )}
                    {late && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${COMPLETED_LATE_BADGE.classes}`}>
                        {COMPLETED_LATE_BADGE.label}
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.classes}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs px-2 py-0.5">
                    {checklist.store.brand ?? "Keva Juice"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs px-2 py-0.5">
                    {checklist.template.templateType?.name ?? checklist.template.type}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] mb-4">
                  📅 {formatCivilDate(checklist.date, "weekdayMonthDay")}
                </div>

                <Link
                  href={`/store-view/checklist/${checklist.id}`}
                  className="flex items-center justify-center gap-1.5 w-full border border-[var(--color-border)] rounded-md py-1.5 text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
                >
                  👁 View Checklist
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
