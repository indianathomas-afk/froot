import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, laborModuleAvailable } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { canSeeWages } from "@/lib/labor-dashboard"
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
  const { org, dbUser, actor } = ctx

  // Gate 1 (env availability) + Gate 2 (per-org toggle).
  if (!laborModuleAvailable(org.clerkOrgId) || !org.activeModules.includes("labor")) {
    notFound()
  }
  // PERM-5C, and NOT the capability C2's list proposed. The prompt named
  // settings.access for this page because it lives under /settings — but
  // settings.access is ADMIN_ONLY while this check has always been
  // ADMIN||MANAGER, so applying it would have taken /settings/labor away from
  // every MANAGER. That is a restriction, and ruling 3 is explicit that this
  // session changes who enforces and never who is allowed.
  //
  // labor.manage is MANAGE — an exact match — and it is already the capability
  // the sidebar asks for this very link (sidebar.tsx). The nav and the page
  // agreeing is what ruling 2 wants; pointing them at different capabilities
  // would have manufactured the disagreement. Gary's ruling, 2026-08-04.
  //
  // labor.manage stays OUT of the override grid: Labor governance is its own
  // ruling (ruling 5), and /api/labor/* still enforces inline, so a denial
  // would hide this page while those endpoints answered.
  if (!can(actor, "labor.manage")) {
    redirect("/dashboard")
  }

  const isAdmin = dbUser?.role === "ADMIN"

  // AL-3 vision item 10 — the Square team roster on the Positions card.
  //
  // THE DISABLED-STATE GUARANTEE IS STRUCTURAL, NOT A RENDER DIFF: false here
  // means LaborSettingsClient receives showRoster={false}, the segmented control
  // is not mounted, no roster fetch is ever issued, and PositionsCard is the same
  // unmodified component it was before AL-3. With the Advanced Labor toggle off,
  // this page is byte-identical to Phase 2.
  //
  // Gary's Q5 ruling (2026-08-19): a MANAGE viewer denied labor.costs.view sees
  // the roster HIDDEN ENTIRELY rather than name-and-position with the pay column
  // stripped — a roster whose only new information was the pay is not worth
  // rendering without it, and a half-rendered wage table invites "add the pay
  // back" from someone who does not know why it was removed.
  const showRoster = canSeeWages(org, actor)

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
        showRoster={showRoster}
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
