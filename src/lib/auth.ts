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
