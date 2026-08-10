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

  const [userRow, org] = await Promise.all([
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
      select: { id: true, activeModules: true, instagramEnabled: true, instagramAccessToken: true },
    }),
  ])

  // DEBT-55 (first of its 21 sites, fixed 2026-08-04 alongside PERM-5B). This
  // lookup is org-blind — clerkUserId is globally unique, so an identity with
  // memberships in two orgs resolves to the row of whichever org created it,
  // and THIS FILE renders the sidebar every other page inherits. Cross-org, it
  // drew the other org's nav: an ADMIN sidebar whose every destination denies,
  // which is exactly the overpromising sidebar seen during F1 verification.
  //
  // A wrong-org row is treated as ABSENT — the same shape getCurrentUser()
  // uses (src/lib/auth.ts) — so the fallback below serves the STAFF nav rather
  // than a borrowed one. UI only; every gate behind these pages already
  // refused independently via the DEBT-53 guard.
  const dbUser = userRow && org && userRow.organizationId === org.id ? userRow : null

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
  //
  // CHK-4 — CONFIRMED CORRECT FOR MISSED AND DELIBERATELY UNCHANGED. Plan §5.5
  // said to verify rather than assume, so: the filter is an explicit
  // `in: ["Pending", "In Progress"]` allow-list, and `Missed` is a fifth status
  // that matches neither. It drops out with no edit, which is exactly R1 —
  // missed is a closed fact and must never inflate a badge that says "there is
  // work here".
  // THE VISIBLE CONSEQUENCE, NAMED SO IT IS NOT FILED AS A BUG: this count has
  // no date scope, so before CHK-3 it counted every unfinished checklist ever
  // created, and the nav item was effectively always on. Now that day close
  // sweeps rows to `Missed` within two days, a STAFF user with nothing open
  // will see the Checklists item DISAPPEAR. That is the badge becoming truthful,
  // not breaking. Adding a date scope would be a separate behaviour change with
  // no ruling behind it, and this session does not make it.
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
        // PERM-5. NO User ROW → [] → the STAFF-fallback nav renders exactly as
        // it did before this phase. Chosen, not incidental (Gary, 2026-08-04).
        //
        // The fail-closed rule in overridesFrom() is about a column that should
        // have been READ and was not — an unselected field, which would
        // otherwise look identical to "no denials" and hand back the full role
        // baseline. "No row" is a different fact: there is no user to hold
        // denials, so [] is the truthful value rather than a guess. Tightening
        // it here would change real behaviour for zero security gain, because
        // the sidebar is UX and the server guards already deny these sessions.
        deniedCapabilities={dbUser?.deniedCapabilities ?? []}
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
