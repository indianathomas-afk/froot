import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { CheckCircle, Clock, AlertCircle, XCircle, CalendarX, ClipboardList } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getUserStoreScope } from "@/lib/auth"
import { isMissed } from "@/lib/checklist-lifecycle"

async function getReportsData() {
  const { orgId } = await auth()
  if (!orgId) return null
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return null

  const { isAdmin, storeIds } = await getUserStoreScope()
  const storeFilter = isAdmin ? {} : { id: { in: storeIds } }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [checklists, stores] = await Promise.all([
    prisma.checklist.findMany({
      where: {
        organizationId: org.id,
        date: { gte: since },
        ...(isAdmin ? {} : { storeId: { in: storeIds } }),
      },
      include: { store: true },
    }),
    prisma.store.findMany({ where: { organizationId: org.id, isActive: true, ...storeFilter }, orderBy: { name: "asc" } }),
  ])

  // ── DEBT-63, FIXED HERE (CHK-5) ────────────────────────────────────────────
  // THE DEFECT WAS THE HAND-SUMMED DENOMINATOR, NOT A MISSING BUCKET. The tiles
  // read `of ${completed + inProgress + pending} total checklists`, which
  // silently dropped every Non-Compliant row — and would have dropped every
  // Missed row too the moment CHK-3's cron started writing them. The row's own
  // fix shape, preferred over adding another named bucket to the sum: DERIVE THE
  // TOTAL FROM THE ROW COUNT, so the omission cannot be reintroduced by anyone
  // adding a sixth status later.
  //
  // CORRECTION TO THE ROW, MEASURED AT "dc90ff6" 2026-08-10: DEBT-63 states that
  // a Non-Compliant checklist "is counted in NO bucket on /reports". That half
  // is not true and never was — `nonCompliant` and its tile have been here since
  // the original build ("1cfdf76", git log -L on this line). Only the
  // denominator half of the row was live. The row is corrected in ROADMAP.yaml
  // rather than quietly closed.
  //
  // THE BUCKETS ARE A PARTITION, BY CONSTRUCTION. `isMissed` is asked FIRST and
  // the stored status is only consulted for what it leaves — so the five numbers
  // sum to `total` exactly, and the tiles can no longer disagree with the store
  // table below (which always counted `sc.length` and was therefore already
  // right — DEBT-63's CHK-3 rider).
  //
  // MISSED COMES FROM THE PREDICATE, NOT FROM `status === "Missed"`. One
  // definition, in src/lib/checklist-lifecycle.ts (DEBT-26).
  //
  // NON-COMPLIANT IS A LIVE-DAY VERDICT AND MISSED IS CLOSED HISTORY — R1's
  // day-close semantics, and the reconciliation the two tiles need. `submit`
  // writes Non-Compliant when a checklist goes in with critical tasks
  // incomplete; day close then rewrites it to Missed along with everything else
  // unfinished, because once the day is shut a partial submission is a miss like
  // any other and two closed-but-unfinished statuses would give this page two
  // answers to one question. So Non-Compliant trends toward today's rows and
  // Missed accumulates behind it. (A non-Daily row is the exception: day close
  // leaves it open by design, so its Non-Compliant verdict persists — DEBT-61.)
  const missed = checklists.filter((c) => isMissed(c)).length
  const open = checklists.filter((c) => !isMissed(c))
  const completed = open.filter((c) => c.status === "Completed").length
  const inProgress = open.filter((c) => c.status === "In Progress").length
  const pending = open.filter((c) => c.status === "Pending").length
  const nonCompliant = open.filter((c) => c.status === "Non-Compliant").length
  const total = checklists.length

  const storePerf = stores.map((store) => {
    const sc = checklists.filter((c) => c.storeId === store.id)
    const sComp = sc.filter((c) => c.status === "Completed").length
    const sPend = sc.filter((c) => !isMissed(c) && c.status === "Pending").length
    const sMissed = sc.filter((c) => isMissed(c)).length
    const rate = sc.length > 0 ? Math.round((sComp / sc.length) * 100) : 0
    return { store, total: sc.length, completed: sComp, pending: sPend, missed: sMissed, rate }
  })

  return { completed, inProgress, pending, nonCompliant, missed, total, storePerf, inventoryActive: org.activeModules.includes("inventory") }
}

export default async function ReportsPage() {
  const data = await getReportsData()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Accountability &amp; Compliance</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Track who completed what, identify missed standards, and review audit-ready records</p>
      </div>

      {/* CHK-5: the operations report. THE ONLY ADMIN SURFACE THAT REPORTS
          MISSED across days — /checklists and /store-view are both scoped to the
          current business day and day close never closes today, so a missed row
          appears on neither (CHK-4's rider). Linked from here rather than given
          its own sidebar entry: it is a report, the sidebar already asks
          reports.view for this section, and reports/layout.tsx gates the whole
          subtree. */}
      <a
        href="/reports/operations"
        className="flex items-center justify-between mb-6 px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-primary)]/5 hover:bg-[var(--color-primary)]/10 transition-colors"
      >
        <div>
          <p className="text-sm font-semibold text-[var(--color-foreground)]">Operations Report</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">Missed and completed-late checklists by store, by day, and by template, over any date range</p>
        </div>
        <span className="text-sm font-medium text-[var(--color-primary)]">Open →</span>
      </a>

      {data?.inventoryActive && (
        <a
          href="/inventory/reports"
          className="flex items-center justify-between mb-6 px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-primary)]/5 hover:bg-[var(--color-primary)]/10 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--color-foreground)]">Inventory Reports</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">Sales, usage, cost %, valuation, turnover, and vendor spend live under Inventory → Reports</p>
          </div>
          <span className="text-sm font-medium text-[var(--color-primary)]">Open →</span>
        </a>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <Select defaultValue="all">
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
          </SelectContent>
        </Select>
        <Select defaultValue="week">
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Past Week" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Past Week</SelectItem>
            <SelectItem value="month">Past Month</SelectItem>
            <SelectItem value="quarter">Past Quarter</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards — five buckets that partition the range, plus the total they
          are measured against. The denominator is the row count (DEBT-63). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {[
          { label: "Total", value: data?.total ?? 0, sub: "All checklists in this period", icon: ClipboardList, color: "text-[var(--color-muted-foreground)]", bg: "bg-[var(--color-muted)]", border: "border-[var(--color-border)]", valColor: "text-[var(--color-foreground)]" },
          { label: "Completed", value: data?.completed ?? 0, sub: `of ${data?.total ?? 0} total checklists`, icon: CheckCircle, color: "text-[var(--color-success)]", bg: "bg-[var(--color-success-bg)]", border: "border-[var(--color-success-border)]", valColor: "text-[var(--color-success-text)]" },
          { label: "In Progress", value: data?.inProgress ?? 0, sub: "Started but not submitted", icon: Clock, color: "text-[var(--color-info)]", bg: "bg-[var(--color-info-bg)]", border: "border-[var(--color-info-border)]", valColor: "text-[var(--color-info-text)]" },
          { label: "Pending", value: data?.pending ?? 0, sub: "Not started yet", icon: AlertCircle, color: "text-[var(--color-warning)]", bg: "bg-[var(--color-warning-bg)]", border: "border-[var(--color-warning-border)]", valColor: "text-[var(--color-warning-text)]" },
          { label: "Non-Compliant", value: data?.nonCompliant ?? 0, sub: "Submitted with critical tasks incomplete", icon: XCircle, color: "text-[var(--color-destructive)]", bg: "bg-red-50", border: "border-red-200", valColor: "text-[var(--color-destructive)]" },
          { label: "Missed", value: data?.missed ?? 0, sub: "Day closed without completion", icon: CalendarX, color: "text-[var(--color-destructive)]", bg: "bg-gray-100", border: "border-gray-300", valColor: "text-[var(--color-destructive)]" },
        ].map(({ label, value, sub, icon: Icon, color, bg, border, valColor }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--color-muted-foreground)]">{label}</span>
                <div className={`w-7 h-7 rounded-full ${bg} border ${border} flex items-center justify-center`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
              </div>
              <p className={`text-3xl font-bold ${valColor}`}>{value}</p>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Store Performance Table */}
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-[var(--color-foreground)]">Store Performance</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Completion rates and metrics by location</p>
        </div>
        {!data || data.storePerf.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">No data for this period.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Store", "Total", "Completed", "Pending", "Missed", "Rate"].map((h) => (
                  <th key={h} className={`text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3 ${h === "Store" ? "text-left" : "text-center"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.storePerf.map(({ store, total, completed, pending, missed, rate }) => (
                <tr key={store.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30">
                  <td className="px-6 py-3 text-sm text-[var(--color-foreground)]">{store.name}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{total}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{completed}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{pending}</td>
                  <td className={`px-6 py-3 text-sm text-center ${missed > 0 ? "font-medium text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"}`}>{missed}</td>
                  <td className="px-6 py-3 text-sm text-center font-medium text-[var(--color-destructive)]">{rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
