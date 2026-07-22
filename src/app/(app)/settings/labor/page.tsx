import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, laborModuleAvailable } from "@/lib/auth"
import { LaborSettingsClient } from "./labor-settings-client"

// Labor configuration hub (ADMIN + MANAGER). Both feature gates first: where
// Labor is unavailable or the org toggle is off, this route does not exist
// (notFound). STORE/STAFF are bounced to the dashboard — they get read-only
// cards, never the config. Data is fetched server-side and passed down; the
// client component drives edits through /api/labor/*.

export default async function LaborSettingsPage() {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  const { org, dbUser } = ctx

  // Gate 1 (env availability) + Gate 2 (per-org toggle).
  if (!laborModuleAvailable(org.clerkOrgId) || !org.activeModules.includes("labor")) {
    notFound()
  }
  // RBAC: config is ADMIN + MANAGER only.
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") {
    redirect("/dashboard")
  }

  const isAdmin = dbUser?.role === "ADMIN"
  const [positions, stores] = await Promise.all([
    prisma.laborPosition.findMany({
      where: { organizationId: org.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.store.findMany({
      where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: dbUser?.storeAssignments.map((a) => a.storeId) ?? [] } }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] mb-2"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Weekly Labor Model</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Set the labor-percentage target and rounding, and manage the position rate legend used to
          turn a weekly sales forecast into a schedulable-hours budget.
        </p>
      </div>

      <LaborSettingsClient
        stores={stores}
        initialPositions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          payType: p.payType,
          defaultHourlyRate: Number(p.defaultHourlyRate),
          impliedWeeklyHours: p.impliedWeeklyHours,
          isSupervisory: p.isSupervisory,
          sortOrder: p.sortOrder,
          active: p.active,
        }))}
      />
    </div>
  )
}
