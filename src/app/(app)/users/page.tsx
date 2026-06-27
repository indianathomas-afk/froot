import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { InviteUserButton, EditUserButton, RemoveUserButton } from "./user-actions"

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-orange-100 text-orange-700 border border-orange-200",
  MANAGER: "bg-blue-100 text-blue-700 border border-blue-200",
  STORE: "bg-purple-100 text-purple-700 border border-purple-200",
  STAFF: "bg-gray-100 text-gray-600 border border-gray-200",
}

async function getData() {
  const { orgId } = await auth()
  if (!orgId) return { members: [], stores: [] }

  const clerk = await clerkClient()
  const [memberships, org] = await Promise.all([
    clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    prisma.organization.findUnique({ where: { clerkOrgId: orgId } }),
  ])

  if (!org) return { members: [], stores: [] }

  const [dbUsers, stores] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
  ])

  const dbByClerkId = new Map(dbUsers.map((u) => [u.clerkUserId, u]))

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

  return { members, stores }
}

export default async function UsersPage() {
  const { members, stores } = await getData()

  const storeProps = stores.map((s) => ({ id: s.id, name: s.name, storeNumber: s.storeNumber }))

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
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{members.length} member{members.length !== 1 ? "s" : ""}</p>
        </div>

        {members.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No users yet. Invite your team to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["User", "Role", "Location Access", "Joined", "Actions"].map((h) => (
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
