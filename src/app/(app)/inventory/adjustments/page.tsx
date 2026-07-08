import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Scale } from "lucide-react"
import Link from "next/link"
import { ensureDefaultLossReasons } from "@/lib/adjustments"
import { AdjustmentsClient } from "./adjustments-client"

export default async function AdjustmentsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <Scale className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Inventory Adjustments</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Log waste, transfers between stores, comps and prep batches — upgrade to the Inventory add-on to unlock this page.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Plan
          </Link>
        </div>
      </div>
    )
  }

  const dbUser = userId
    ? await prisma.user.findUnique({ where: { clerkUserId: userId }, include: { storeAssignments: true } })
    : null
  const isAdmin = dbUser?.role === "ADMIN"
  const isManager = isAdmin || dbUser?.role === "MANAGER"

  await ensureDefaultLossReasons(org.id)

  const [stores, allStores, ingredients, lossReasons, destinationGroups, prepRecipes] = await Promise.all([
    prisma.store.findMany({
      where: {
        organizationId: org.id,
        isActive: true,
        ...(isAdmin ? {} : { id: { in: dbUser?.storeAssignments.map((a) => a.storeId) ?? [] } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Transfer destinations include stores the user isn't assigned to.
    prisma.store.findMany({
      where: { organizationId: org.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ingredient.findMany({
      where: { organizationId: org.id, deletedAt: null, isArchived: false, isActive: true },
      select: { id: true, brand: true, name: true, reportingUnit: true, costPerReportingUnit: true, kind: true },
      orderBy: { name: "asc" },
    }),
    prisma.lossReason.findMany({
      where: { organizationId: org.id },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.adjustmentGroup.findMany({
      where: { organizationId: org.id, type: "TRANSFER", destinationLabel: { not: null } },
      select: { destinationLabel: true },
      distinct: ["destinationLabel"],
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.recipe.findMany({
      where: { organizationId: org.id, salesItemId: null, preparedIngredient: { isNot: null } },
      select: { id: true, name: true, yieldQty: true, yieldUnit: true },
      orderBy: { name: "asc" },
    }),
  ])

  return (
    <AdjustmentsClient
      stores={stores}
      allStores={allStores}
      ingredients={ingredients.map((i) => ({
        id: i.id,
        displayName: i.brand ? `${i.brand} ${i.name}` : i.name,
        reportingUnit: i.reportingUnit,
        costPerReportingUnit: i.costPerReportingUnit,
        isPrepared: i.kind === "PREPARED",
      }))}
      lossReasons={lossReasons.map((r) => ({ id: r.id, label: r.label }))}
      destinations={destinationGroups.map((g) => g.destinationLabel).filter((d): d is string => !!d)}
      prepRecipes={prepRecipes}
      isManager={isManager}
    />
  )
}
