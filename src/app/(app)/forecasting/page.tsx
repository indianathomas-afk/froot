import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can, scope } from "@/lib/permissions"
import { localDateStr } from "@/lib/reports"
import { ForecastingClient } from "./forecasting-client"

// Forecasting (Phase F) — per-store annual sales goals seeded from last year's
// Square sales (weekday-aligned) or an imported budget, scaled by an increase
// %, materialized to daily goals and edited in a 12-month calendar. Admins
// edit; managers read their ASSIGNED locations only (PERM-3 — it was every
// location until then) and see forecast goals for the current and next month
// only. Actual-vs-goal tinting comes from the I-5 sales caches.

export default async function ForecastingPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/sign-in")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  const { storeIds, role } = await getUserStoreScope()
  // Same capability the sidebar entry and every /api/forecasting read ask, so
  // the page can never render for someone its APIs would refuse (PERM-2).
  if (!can({ role }, "forecasting.view")) redirect("/dashboard")
  // PERM-6 Task 5: one `isAdmin = can(forecasting.edit)` used to do both jobs
  // here too — it gated the edit affordances AND decided whether the store
  // picker showed every store or only the caller's. Split, so the picker list
  // matches exactly what requireForecastStore will allow through.
  const canEdit = can({ role }, "forecasting.edit")
  const unscoped = can({ role }, "forecasting.scope.all")

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(unscoped ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, squareLocationId: true, timezone: true },
  })

  // The year selector's bounds come from the window, which is store-local — so
  // resolve each store's "today" here (server-side) and let the client derive
  // the list through the same forecastWindowFrom() the API guards use. Baked at
  // render, so a tab left open across midnight on 31 Dec shows a stale list
  // until reload; harmless, because enforcement is per-request server-side.
  const now = new Date()

  return (
    <ForecastingClient
      stores={stores.map((s) => ({
        id: s.id,
        name: s.name,
        squareLinked: !!s.squareLocationId,
        today: localDateStr(now, s.timezone),
      }))}
      isAdmin={canEdit}
      windowed={scope({ role }, "forecasting.view").access === "window"}
      squareConnected={!!org.squareAccessToken}
      currentYear={now.getFullYear()}
    />
  )
}
