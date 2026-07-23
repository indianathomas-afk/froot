import { Sidebar } from "@/components/layout/sidebar"
import { AppShell } from "@/components/layout/app-shell"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { OrganizationList } from "@clerk/nextjs"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { hrModuleAvailable, laborModuleAvailable } from "@/lib/auth"

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
    userId
      ? prisma.user.findUnique({
          where: { clerkUserId: userId },
          include: {
            staffMember: { select: { id: true } },
            storeAssignments: { select: { storeId: true } },
          },
        })
      : null,
    prisma.organization.findUnique({
      where: { clerkOrgId: orgId },
      select: { activeModules: true, instagramEnabled: true, instagramAccessToken: true },
    }),
  ])

  // HR-7: employee logins (STAFF role explicitly linked to a StaffMember by
  // the invite webhook) see only the /my/* portal — never the admin shell.
  // Conditioned on the HR gates so production (HR_MODULE_AVAILABLE unset)
  // stays byte-identical and an org toggling HR off falls back to the plain
  // STAFF view instead of a dead-ended /my. UI lock only: STAFF-role API
  // permissions are unchanged (a permission-level split is the future
  // EMPLOYEE-role phase on the roadmap).
  if (
    dbUser?.role === "STAFF" &&
    dbUser.staffMember &&
    hrModuleAvailable(orgId) &&
    (org?.activeModules ?? []).includes("hr")
  ) {
    redirect("/my")
  }

  // STAFF-1 (F3 store-proxy): a STAFF login sees the Checklists nav item only
  // when an open checklist exists for one of their assigned stores. There is
  // no per-person checklist assignment in the schema — this store-level signal
  // is the honest detection until one exists.
  let staffHasChecklists = false
  if (dbUser?.role === "STAFF") {
    const storeIds = dbUser.storeAssignments.map((a) => a.storeId)
    if (storeIds.length > 0) {
      staffHasChecklists =
        (await prisma.checklist.count({
          where: { storeId: { in: storeIds }, status: { in: ["Pending", "In Progress"] } },
        })) > 0
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        role={dbUser?.role ?? "STAFF"}
        activeModules={org?.activeModules ?? []}
        instagramEnabled={!!org?.instagramEnabled && !!org?.instagramAccessToken}
        hrAvailable={hrModuleAvailable(orgId)}
        laborAvailable={laborModuleAvailable(orgId)}
        staffHasChecklists={staffHasChecklists}
      />
      <AppShell>{children}</AppShell>
    </div>
  )
}
