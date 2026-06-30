import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

export async function getOrgId(): Promise<string> {
  const { orgId } = await auth()
  if (!orgId) throw new Error("Unauthorized")
  return orgId
}

export async function getOrganization() {
  const orgId = await getOrgId()
  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
  })
  if (!org) throw new Error("Organization not found")
  return org
}

export async function requireModule(module: "inventory" | "nutrition") {
  const org = await getOrganization()
  if (!org.activeModules.includes(module)) {
    throw new Error(`MODULE_NOT_ACTIVE:${module}`)
  }
}

export async function getCurrentUser() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const org = await getOrganization()
  const dbUser = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: { storeAssignments: true },
  })
  return { userId, org, dbUser }
}

export async function requireAdmin() {
  const { dbUser } = await getCurrentUser()
  if (dbUser?.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Admin access required")
  }
  return dbUser
}

export async function requireManagerOrAdmin() {
  const { dbUser } = await getCurrentUser()
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") {
    throw new Error("FORBIDDEN: Manager or Admin access required")
  }
  return dbUser
}
