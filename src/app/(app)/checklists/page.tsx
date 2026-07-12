import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { businessDayWindow } from "@/lib/reports"
import { CheckSquare } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { StoreFilter } from "./store-filter"

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  Pending: { label: "Not Started", classes: "bg-gray-100 text-gray-600 border border-gray-200" },
  "In Progress": { label: "In Progress", classes: "bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]" },
  Completed: { label: "Completed", classes: "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]" },
  "Non-Compliant": { label: "Non-Compliant", classes: "bg-red-50 text-[var(--color-destructive)] border border-red-200" },
}

async function getChecklists(requestedStoreId: string | undefined) {
  const { orgId } = await auth()
  if (!orgId) return { checklists: [], stores: [], lockedStoreId: null }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { checklists: [], stores: [], lockedStoreId: null }

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
  const now = new Date()
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
    include: { store: true, template: true },
    orderBy: { date: "desc" },
  })

  return {
    checklists,
    stores,
    lockedStoreId: !isAdmin && storeIds.length === 1 ? storeIds[0] : null,
    selectedStoreId: effectiveStoreId ?? "all",
  }
}

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const { store } = await searchParams
  const { checklists, stores, lockedStoreId, selectedStoreId } = await getChecklists(store)

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
            return (
              <div key={checklist.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-[var(--color-primary)]" />
                    <span className="font-semibold text-sm text-[var(--color-foreground)]">{checklist.store.name}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.classes}`}>
                    {statusInfo.label}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs px-2 py-0.5">
                    {checklist.store.brand ?? "Keva Juice"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs px-2 py-0.5">
                    {checklist.template.type}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] mb-4">
                  📅 {format(new Date(checklist.date), "EEE, MMM d")}
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
