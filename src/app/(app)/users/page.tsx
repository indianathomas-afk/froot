import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { InviteUserButton, EditUserButton, RemoveUserButton, RevokeInviteButton } from "./user-actions"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-orange-100 text-orange-700 border border-orange-200",
  MANAGER: "bg-blue-100 text-blue-700 border border-blue-200",
  STORE: "bg-purple-100 text-purple-700 border border-purple-200",
  STAFF: "bg-gray-100 text-gray-600 border border-gray-200",
}

async function getData() {
  const { orgId } = await auth()
  if (!orgId) return { members: [], pendingInvites: [], stores: [] }

  const clerk = await clerkClient()
  const [memberships, pendingInvitations, org] = await Promise.all([
    clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    clerk.organizations.getOrganizationInvitationList({ organizationId: orgId, status: ["pending"] }),
    prisma.organization.findUnique({ where: { clerkOrgId: orgId } }),
  ])

  if (!org) return { members: [], pendingInvites: [], stores: [] }

  const [dbUsers, stores, pendingInviteRecords] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.pendingInvite.findMany({ where: { organizationId: org.id } }),
  ])
  const storeById = new Map(stores.map((s) => [s.id, s]))
  const pendingByEmail = new Map(pendingInviteRecords.map((p) => [p.email, p]))

  const dbByClerkId = new Map(dbUsers.map((u) => [u.clerkUserId, u]))

  // Auto-sync any Clerk member who has no DB User record yet
  const unsyncedMembers = memberships.data.filter((m) => {
    const uid = m.publicUserData?.userId
    return uid && !dbByClerkId.has(uid)
  })
  if (unsyncedMembers.length > 0) {
    await Promise.all(
      unsyncedMembers.map((m) => {
        const pub = m.publicUserData!
        return prisma.user.upsert({
          where: { clerkUserId: pub.userId! },
          create: {
            clerkUserId: pub.userId!,
            organizationId: org.id,
            email: pub.identifier ?? "",
            name: [pub.firstName, pub.lastName].filter(Boolean).join(" ") || null,
            role: m.role === "org:admin" ? "ADMIN" : "STORE",
          },
          update: {},
        })
      })
    )
    // Re-fetch after sync
    const refreshed = await prisma.user.findMany({
      where: { organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
    })
    refreshed.forEach((u) => dbByClerkId.set(u.clerkUserId, u))
  }

  const members = memberships.data.map((m) => {
    const pub = m.publicUserData
    const dbUser = pub?.userId ? dbByClerkId.get(pub.userId) : null
    return {
      clerkMembershipId: m.id,
      clerkUserId: pub?.userId ?? "",
      email: pub?.identifier ?? "",
      name: [pub?.firstName, pub?.lastName].filter(Boolean).join(" ") || null,
      clerkRole: m.role,
      dbUserId: dbUser?.id ?? null,
      role: dbUser?.role ?? "STORE",
      storeAssignments: dbUser?.storeAssignments ?? [],
      createdAt: new Date(m.createdAt),
    }
  })

  const pendingInvites = pendingInvitations.data.map((inv) => {
    const pendingRecord = pendingByEmail.get(inv.emailAddress)
    return {
      id: inv.id,
      email: inv.emailAddress,
      role: pendingRecord?.role ?? (inv.role === "org:admin" ? "ADMIN" : "STORE"),
      storeNames: (pendingRecord?.storeIds ?? []).map((id) => storeById.get(id)).filter((s): s is NonNullable<typeof s> => !!s),
      createdAt: new Date(inv.createdAt),
    }
  })

  return { members, pendingInvites, stores }
}

export default async function UsersPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/dashboard")
  }

  const { members, pendingInvites, stores } = await getData()

  const storeProps = stores.map((s) => ({ id: s.id, name: s.name, storeNumber: s.storeNumber }))
  const totalCount = members.length + pendingInvites.length

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">User Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Invite users and control which locations they can access</p>
        </div>
        <InviteUserButton stores={storeProps} />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-medium text-[var(--color-foreground)]">Organization Members</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{totalCount} member{totalCount !== 1 ? "s" : ""}{pendingInvites.length > 0 ? ` · ${pendingInvites.length} pending` : ""}</p>
        </div>

        {totalCount === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No users yet. Invite your team to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["User", "Role", "Location Access", "Invited", "Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.clerkMembershipId} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{member.name || member.email}</p>
                      {member.name && <p className="text-xs text-[var(--color-muted-foreground)]">{member.email}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${ROLE_STYLES[member.role] ?? ROLE_STYLES.STAFF}`}>
                        {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {member.role === "ADMIN" ? (
                        <span className="text-xs text-orange-600 font-medium">All locations</span>
                      ) : member.storeAssignments.length === 0 ? (
                        <span className="text-xs text-[var(--color-muted-foreground)]">No locations assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {member.storeAssignments.slice(0, 5).map((a) => (
                            <span key={a.store.id} className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium px-2 py-0.5">
                              {a.store.storeNumber ? `#${a.store.storeNumber}` : a.store.name}
                            </span>
                          ))}
                          {member.storeAssignments.length > 5 && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">+{member.storeAssignments.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {format(member.createdAt, "M/d/yyyy")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <EditUserButton
                          dbUserId={member.dbUserId}
                          currentRole={member.role}
                          currentStoreIds={member.storeAssignments.map((a) => a.storeId)}
                          stores={storeProps}
                          userName={member.name || member.email}
                        />
                        <RemoveUserButton clerkUserId={member.clerkUserId} userName={member.name || member.email} />
                      </div>
                    </td>
                  </tr>
                ))}
                {pendingInvites.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-border)] last:border-0 bg-[var(--color-accent)]/10">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{inv.email}</p>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 border border-yellow-200 mt-1">
                        Pending
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${ROLE_STYLES[inv.role] ?? ROLE_STYLES.STAFF}`}>
                        {inv.role.charAt(0) + inv.role.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {inv.role === "ADMIN" ? (
                        <span className="text-xs text-orange-600 font-medium">All locations</span>
                      ) : inv.storeNames.length === 0 ? (
                        <span className="text-xs text-[var(--color-muted-foreground)]">No locations assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {inv.storeNames.map((s) => (
                            <span key={s.id} className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium px-2 py-0.5">
                              {s.storeNumber ? `#${s.storeNumber}` : s.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {format(inv.createdAt, "M/d/yyyy")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-muted-foreground)] italic">Awaiting acceptance</span>
                        <RevokeInviteButton invitationId={inv.id} email={inv.email} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          <strong className="text-[var(--color-foreground)]">How location access works:</strong>{" "}
          Admins see all locations. Managers and Store users only see the locations you assign to them. Each invited user receives an email to set up their account.
        </p>
      </div>
    </div>
  )
}
