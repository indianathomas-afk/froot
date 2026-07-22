import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { AlertCircle, ArrowLeft, FileSignature, Gauge, RefreshCw, Users, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { getCurrentUser, getUserStoreScope, hrModuleAvailable } from "@/lib/auth"
import { getOrgComplianceRollup } from "@/lib/hr-compliance"
import { ComplianceStaffTable, type ComplianceStaffRow } from "./compliance-staff-table"

// HR-8: the compliance rollup dashboard — who is compliant, who is not, and
// where the gaps are, across handbook acknowledgments and training, rolled up
// per store and per employee. Everything is computed live from existing
// records (src/lib/hr-compliance.ts); nothing is stored. ADMIN sees the whole
// org, MANAGER only their assigned stores; STORE/STAFF get a 404 like every
// other HR management surface. Definitions in docs/DECISIONS.md.

export default async function HrCompliancePage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") notFound()

  const { isAdmin, storeIds } = await getUserStoreScope()
  const rollup = await getOrgComplianceRollup(org.id, { storeIds: isAdmin ? null : storeIds })
  const { totals, agreements } = rollup

  const staffRows: ComplianceStaffRow[] = rollup.staff.map((s) => {
    const docs = s.items.filter((i) => i.kind === "document")
    const training = s.items.filter((i) => i.kind === "training")
    return {
      staffId: s.staffId,
      name: s.displayName,
      storeName: s.primaryStoreName,
      docsDone: docs.filter((i) => i.status === "complete").length,
      docsTotal: docs.length,
      trainingDone: training.filter((i) => i.status === "complete").length,
      trainingTotal: training.length,
      pct: s.pct,
      overdueCount: s.overdueCount,
      needsResignCount: s.needsResignCount,
      inProgressCount: s.inProgressCount,
    }
  })

  const kpis = [
    {
      label: "Overall Compliance",
      value: totals.pct === null ? "—" : `${totals.pct}%`,
      sub: `${totals.completedCount} of ${totals.requiredTotal} required items complete`,
      icon: Gauge,
      color: "text-[var(--color-info)]",
      bg: "bg-[var(--color-info-bg)]",
      border: "border-[var(--color-info-border)]",
      valColor: "text-[var(--color-info-text)]",
    },
    {
      label: "Fully Compliant",
      value: totals.fullyCompliant,
      sub: `of ${totals.staffCount} active staff tracked`,
      icon: Users,
      color: "text-[var(--color-success)]",
      bg: "bg-[var(--color-success-bg)]",
      border: "border-[var(--color-success-border)]",
      valColor: "text-[var(--color-success-text)]",
    },
    {
      label: "Needs Re-sign",
      value: totals.needsResignCount,
      sub: "Signed an older document version",
      icon: RefreshCw,
      color: "text-[var(--color-warning)]",
      bg: "bg-[var(--color-warning-bg)]",
      border: "border-[var(--color-warning-border)]",
      valColor: "text-[var(--color-warning-text)]",
    },
    {
      label: "Overdue Training",
      value: totals.overdueCount,
      sub: "Past due date, not completed",
      icon: XCircle,
      color: "text-[var(--color-destructive)]",
      bg: "bg-red-50",
      border: "border-red-200",
      valColor: "text-[var(--color-destructive)]",
    },
  ]

  return (
    <div>
      <Link
        href="/hr"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        HR
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Compliance</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Handbook acknowledgments and training, rolled up{" "}
          {isAdmin ? "across the organization" : "across your stores"} — live from current records
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map(({ label, value, sub, icon: Icon, color, bg, border, valColor }) => (
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

      {/* Store rollup */}
      {rollup.stores.length > 1 && (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-[var(--color-border)]">
            <h2 className="font-semibold text-[var(--color-foreground)]">By Store</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
              Staff are counted under their primary store
            </p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Store", "Staff", "Items", "Fully Compliant", "Compliance"].map((h) => (
                  <th
                    key={h}
                    className={`text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3 ${
                      h === "Store" ? "text-left" : "text-center"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rollup.stores.map((s) => (
                <tr key={s.storeId ?? "unassigned"} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30">
                  <td className="px-6 py-3 text-sm font-medium text-[var(--color-foreground)]">{s.storeName}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{s.staffCount}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">
                    {s.requiredTotal > 0 ? `${s.completedCount}/${s.requiredTotal}` : "—"}
                  </td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">
                    {s.fullyCompliant} of {s.staffCount}
                  </td>
                  <td className="px-6 py-3 text-sm text-center">
                    {s.pct === null ? (
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                        No requirements
                      </span>
                    ) : s.pct === 100 ? (
                      <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-[#25ba3b]/10 text-[var(--color-success-text,#1d7c2e)]">
                        100%
                      </span>
                    ) : (
                      <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-[#efa201]/10 text-[var(--color-warning-text,#a36a00)]">
                        {s.pct}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-employee table */}
      <div className="mb-8">
        <ComplianceStaffTable rows={staffRows} />
      </div>

      {/* Agreements — deliberately outside the compliance percentage (no
          assignment mechanism says who is SUPPOSED to hold one; see
          docs/DECISIONS.md). Pending countersigns are the actionable gap. */}
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          <div>
            <h2 className="font-semibold text-[var(--color-foreground)]">Agreement Forms</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
              Tracked separately — executions don&apos;t count toward compliance percentages
            </p>
          </div>
        </div>

        {agreements.pending.length > 0 && (
          <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-warning-bg)]/40">
            <p className="text-sm font-semibold text-[var(--color-warning-text)] flex items-center gap-1.5 mb-2">
              <AlertCircle className="h-4 w-4" />
              Awaiting supervisor countersign
            </p>
            <ul className="space-y-1.5">
              {agreements.pending.map((p) => (
                <li key={p.submissionId} className="text-sm text-[var(--color-foreground)]">
                  <Link href={`/staff/${p.staffId}`} className="font-medium hover:text-[var(--color-primary)] hover:underline">
                    {p.staffName}
                  </Link>{" "}
                  · {p.formTitle} · employee signed {format(new Date(p.employeeSignedAt), "MMM d, yyyy")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {agreements.forms.length === 0 ? (
          <p className="px-6 py-6 text-sm text-[var(--color-muted-foreground)]">
            No agreement forms yet — build them under HR → Agreement Forms.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Form", "Executed", "Pending countersign"].map((h) => (
                  <th
                    key={h}
                    className={`text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3 ${
                      h === "Form" ? "text-left" : "text-center"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agreements.forms.map((f) => (
                <tr key={f.documentId} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-6 py-3 text-sm font-medium text-[var(--color-foreground)]">{f.title}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{f.executedCount}</td>
                  <td className="px-6 py-3 text-sm text-center">
                    {f.pendingCount > 0 ? (
                      <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-[#efa201]/10 text-[var(--color-warning-text,#a36a00)]">
                        {f.pendingCount}
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted-foreground)]">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
