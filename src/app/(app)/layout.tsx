import { Sidebar } from "@/components/layout/sidebar"
import { AppShell } from "@/components/layout/app-shell"
import { auth } from "@clerk/nextjs/server"
import { OrganizationList } from "@clerk/nextjs"
import Image from "next/image"
import { prisma } from "@/lib/prisma"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgId, userId } = await auth()

  if (!orgId) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4"><Image src="/logo.png" alt="Froot" width={64} height={64} /></div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-2">Welcome to Froot</h1>
          <p className="text-[var(--color-muted-foreground)] mb-8">Create or select an organization to get started.</p>
          <OrganizationList
            hidePersonal
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
        </div>
      </div>
    )
  }

  const [dbUser, org] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { clerkUserId: userId } }) : null,
    prisma.organization.findUnique({ where: { clerkOrgId: orgId }, select: { activeModules: true } }),
  ])

  return (
    <div className="flex min-h-screen">
      <Sidebar role={dbUser?.role ?? "STAFF"} activeModules={org?.activeModules ?? []} />
      <AppShell>{children}</AppShell>
    </div>
  )
}
