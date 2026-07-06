import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { Store, CheckSquare, CheckCircle, BarChart2, ArrowRight, FileText, ClipboardList } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { BuildInfo } from "@/components/build-info"

async function getDashboardData() {
  const { orgId } = await auth()
  if (!orgId) return null

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return null

  const { isAdmin, storeIds } = await getUserStoreScope()

  // Non-admins only ever see stats for their assigned store(s).
  const checklistWhere: Record<string, unknown> = {
    organizationId: org.id,
    date: {
      gte: new Date(new Date().setHours(0, 0, 0, 0)),
      lt: new Date(new Date().setHours(23, 59, 59, 999)),
    },
  }
  if (!isAdmin) checklistWhere.storeId = { in: storeIds }

  const [activeStoreCount, todayChecklists] = await Promise.all([
    isAdmin
      ? prisma.store.count({ where: { organizationId: org.id, isActive: true } })
      : Promise.resolve(storeIds.length),
    prisma.checklist.findMany({ where: checklistWhere }),
  ])

  const completed = todayChecklists.filter((c) => c.status === "Completed").length
  const total = todayChecklists.length
  const complianceRate = total > 0 ? Math.round((completed / total) * 100) : null

  // Days since last finalized count per store — only when the inventory module
  // is active. A store that has never counted shows "Never counted".
  let countRecency: { storeId: string; storeName: string; days: number | null }[] = []
  if (org.activeModules.includes("inventory")) {
    const stores = await prisma.store.findMany({
      where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
      include: {
        inventoryCounts: {
          where: { status: "Finalized" },
          orderBy: { finalizedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    })
    countRecency = stores.map((s) => {
      const last = s.inventoryCounts[0]?.finalizedAt ?? null
      return {
        storeId: s.id,
        storeName: s.name,
        days: last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null,
      }
    })
  }

  return {
    isAdmin,
    soleStoreId: !isAdmin && storeIds.length === 1 ? storeIds[0] : null,
    activeStores: activeStoreCount,
    todayChecklists: total,
    completed,
    complianceRate,
    countRecency,
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  const isAdmin = data?.isAdmin ?? true

  const kpiCards = [
    ...(isAdmin
      ? [{
          title: "Active Stores",
          value: data?.activeStores ?? 0,
          subtitle: "Across all locations",
          icon: Store,
        }]
      : []),
    {
      title: "Today's Checklists",
      value: data?.todayChecklists ?? 0,
      subtitle: "Generated for today",
      icon: CheckSquare,
    },
    {
      title: "Completed",
      value: data?.completed ?? 0,
      subtitle: data?.todayChecklists === 0 ? "No checklists today" : `Of ${data?.todayChecklists} total`,
      icon: CheckCircle,
    },
    {
      title: "Compliance",
      value: data?.complianceRate != null ? `${data.complianceRate}%` : "N/A",
      subtitle: "Overall compliance",
      icon: BarChart2,
    },
  ]

  const checklistsHref = !isAdmin && data?.soleStoreId ? `/checklists?store=${data.soleStoreId}` : "/checklists"

  const quickActions = [
    ...(isAdmin
      ? [
          {
            icon: Store,
            title: "Manage Stores",
            desc: "Add, edit, or configure your store locations and brand assignments",
            href: "/stores",
            label: "Go to Stores",
          },
          {
            icon: FileText,
            title: "Checklist Templates",
            desc: "Create and manage checklist templates for different brands and shifts",
            href: "/templates",
            label: "Manage Templates",
          },
        ]
      : []),
    {
      icon: CheckSquare,
      title: "Daily Checklists",
      desc: "View, complete, and track daily checklists across all locations",
      href: checklistsHref,
      label: "View Checklists",
    },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Dashboard</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Welcome to your checklist management system</p>
      </div>

      {/* KPI Cards */}
      <div className={`grid gap-4 mb-8 ${isAdmin ? "grid-cols-4" : "grid-cols-3"}`}>
        {kpiCards.map(({ title, value, subtitle, icon: Icon }) => (
          <Card key={title}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-[var(--color-muted-foreground)] mb-2">{title}</p>
                  <p className="text-3xl font-bold text-[var(--color-foreground)]">{value}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{subtitle}</p>
                </div>
                <Icon className="h-5 w-5 text-[var(--color-muted-foreground)]" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Inventory: days since last count */}
      {(data?.countRecency.length ?? 0) > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-3">Days since last inventory count</h2>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            {(data?.countRecency ?? []).map(({ storeId, storeName, days }) => (
              <Link key={storeId} href="/inventory/counts">
                <Card className="hover:shadow-md transition-shadow h-full">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-[var(--color-muted-foreground)] mb-1 truncate">{storeName}</p>
                        <p className="text-2xl font-bold text-[var(--color-foreground)]">
                          {days === null ? "—" : days}
                        </p>
                        <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                          {days === null ? "Never counted" : days === 0 ? "Counted today" : `day${days === 1 ? "" : "s"} since last count`}
                        </p>
                      </div>
                      <ClipboardList className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className={`grid gap-4 ${quickActions.length === 1 ? "grid-cols-1 max-w-sm" : "grid-cols-3"}`}>
        {quickActions.map(({ icon: Icon, title, desc, href, label }) => (
          <Card key={title} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="w-10 h-10 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center mb-4">
                <Icon className="h-5 w-5 text-[var(--color-primary)]" />
              </div>
              <h3 className="font-semibold text-[var(--color-foreground)] mb-2">{title}</h3>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-4">{desc}</p>
              <Link
                href={href}
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
              >
                {label} <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <BuildInfo />
    </div>
  )
}
