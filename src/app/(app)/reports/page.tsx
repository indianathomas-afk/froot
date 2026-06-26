import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { CheckCircle, Clock, AlertCircle, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

async function getReportsData() {
  const { orgId } = await auth()
  if (!orgId) return null
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return null

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [checklists, stores] = await Promise.all([
    prisma.checklist.findMany({
      where: { organizationId: org.id, date: { gte: since } },
      include: { store: true },
    }),
    prisma.store.findMany({ where: { organizationId: org.id, isActive: true }, orderBy: { name: "asc" } }),
  ])

  const completed = checklists.filter((c) => c.status === "Completed").length
  const inProgress = checklists.filter((c) => c.status === "In Progress").length
  const pending = checklists.filter((c) => c.status === "Pending").length
  const nonCompliant = checklists.filter((c) => c.status === "Non-Compliant").length

  const storePerf = stores.map((store) => {
    const sc = checklists.filter((c) => c.storeId === store.id)
    const sComp = sc.filter((c) => c.status === "Completed").length
    const sPend = sc.filter((c) => c.status === "Pending").length
    const rate = sc.length > 0 ? Math.round((sComp / sc.length) * 100) : 0
    return { store, total: sc.length, completed: sComp, pending: sPend, rate }
  })

  return { completed, inProgress, pending, nonCompliant, storePerf }
}

export default async function ReportsPage() {
  const data = await getReportsData()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Accountability &amp; Compliance</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Track who completed what, identify missed standards, and review audit-ready records</p>
      </div>

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

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Completed", value: data?.completed ?? 0, sub: `of ${(data?.completed ?? 0) + (data?.inProgress ?? 0) + (data?.pending ?? 0)} total checklists`, icon: CheckCircle, color: "text-[var(--color-success)]", bg: "bg-[var(--color-success-bg)]", border: "border-[var(--color-success-border)]", valColor: "text-[var(--color-success-text)]" },
          { label: "In Progress", value: data?.inProgress ?? 0, sub: "Started but not submitted", icon: Clock, color: "text-[var(--color-info)]", bg: "bg-[var(--color-info-bg)]", border: "border-[var(--color-info-border)]", valColor: "text-[var(--color-info-text)]" },
          { label: "Pending", value: data?.pending ?? 0, sub: "Not started yet", icon: AlertCircle, color: "text-[var(--color-warning)]", bg: "bg-[var(--color-warning-bg)]", border: "border-[var(--color-warning-border)]", valColor: "text-[var(--color-warning-text)]" },
          { label: "Non-Compliant", value: data?.nonCompliant ?? 0, sub: "Missed or incomplete", icon: XCircle, color: "text-[var(--color-destructive)]", bg: "bg-red-50", border: "border-red-200", valColor: "text-[var(--color-destructive)]" },
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
                {["Store", "Total", "Completed", "Pending", "Rate"].map((h) => (
                  <th key={h} className={`text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3 ${h === "Store" ? "text-left" : "text-center"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.storePerf.map(({ store, total, completed, pending, rate }) => (
                <tr key={store.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30">
                  <td className="px-6 py-3 text-sm text-[var(--color-foreground)]">{store.name}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{total}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{completed}</td>
                  <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">{pending}</td>
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
