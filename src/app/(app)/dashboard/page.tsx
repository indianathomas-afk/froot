import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { Store, CheckSquare, CheckCircle, BarChart2, ArrowRight, FileText } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"

async function getDashboardData() {
  const { orgId } = await auth()
  if (!orgId) return null

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    include: {
      stores: { where: { isActive: true } },
      checklists: {
        where: {
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
      },
    },
  })

  if (!org) return null

  const today = org.checklists
  const completed = today.filter((c) => c.status === "Completed").length
  const total = today.length
  const complianceRate = total > 0 ? Math.round((completed / total) * 100) : null

  return {
    activeStores: org.stores.length,
    todayChecklists: total,
    completed,
    complianceRate,
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()

  const kpiCards = [
    {
      title: "Active Stores",
      value: data?.activeStores ?? 0,
      subtitle: "Across all locations",
      icon: Store,
    },
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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Dashboard</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Welcome to your checklist management system</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
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

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4">
        {[
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
          {
            icon: CheckSquare,
            title: "Daily Checklists",
            desc: "View, complete, and track daily checklists across all locations",
            href: "/checklists",
            label: "View Checklists",
          },
        ].map(({ icon: Icon, title, desc, href, label }) => (
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
    </div>
  )
}
