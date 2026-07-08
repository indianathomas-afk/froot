import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { ForecastingClient } from "./forecasting-client"

// Forecasting (Phase F) — per-store annual sales goals seeded from last year's
// Square sales (weekday-aligned) or an imported budget, scaled by an increase
// %, materialized to daily goals and edited in a 12-month calendar. Admins
// edit; managers see every location read-only (v1 decision). Actual-vs-goal
// tinting comes from the I-5 sales caches.

export default async function ForecastingPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/sign-in")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  const { isAdmin, role } = await getUserStoreScope()
  if (role !== "ADMIN" && role !== "MANAGER") redirect("/dashboard")

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, squareLocationId: true },
  })

  return (
    <ForecastingClient
      stores={stores.map((s) => ({ id: s.id, name: s.name, squareLinked: !!s.squareLocationId }))}
      isAdmin={isAdmin}
      squareConnected={!!org.squareAccessToken}
      currentYear={new Date().getFullYear()}
    />
  )
}
