import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { AddStaffButton, ImportStaffButton, DeleteStaffButton } from "./staff-buttons"

async function getStaffData() {
  const { orgId } = await auth()
  if (!orgId) return { staff: [], stores: [] }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { staff: [], stores: [] }

  const [staff, stores] = await Promise.all([
    prisma.staffMember.findMany({
      where: { organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
      orderBy: { displayName: "asc" },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
  ])

  return { staff, stores }
}

export default async function StaffPage() {
  const { staff, stores } = await getStaffData()

  const byStore = new Map<string, typeof staff>()
  const unassigned: typeof staff = []

  for (const member of staff) {
    if (member.storeAssignments.length === 0) {
      unassigned.push(member)
    } else {
      const primaryStore = member.storeAssignments[0].store
      if (!byStore.has(primaryStore.id)) byStore.set(primaryStore.id, [])
      byStore.get(primaryStore.id)!.push(member)
    }
  }

  const storeProps = stores.map((s) => ({ id: s.id, name: s.name, storeNumber: s.storeNumber }))

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Staff Members</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage team members for each store location</p>
        </div>
        <div className="flex gap-2">
          <ImportStaffButton stores={storeProps} />
          <AddStaffButton stores={storeProps} />
        </div>
      </div>

      {staff.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-2xl">👥</div>
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No Staff Members</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Add team members to track who completes each task.</p>
          <div className="flex gap-2 justify-center">
            <ImportStaffButton stores={storeProps} />
            <AddStaffButton stores={storeProps} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(byStore.entries()).map(([storeId, members]) => {
            const store = stores.find((s) => s.id === storeId)
            return (
              <div key={storeId} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
                <div className="px-6 py-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🏪</span>
                    <div>
                      <h3 className="font-semibold text-[var(--color-foreground)]">
                        {store?.storeNumber ? `#${store.storeNumber} - ` : ""}{store?.name}
                      </h3>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{members.length} team member{members.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Display Name</th>
                      <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Full Name</th>
                      <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Locations</th>
                      <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="px-6 py-3 text-sm font-medium text-[var(--color-foreground)]">{member.displayName}</td>
                        <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">{member.fullName ?? "—"}</td>
                        <td className="px-6 py-3">
                          <div className="flex flex-wrap gap-1">
                            {member.storeAssignments.slice(0, 8).map((a) => (
                              <span key={a.store.id} className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium px-2 py-0.5">
                                #{a.store.storeNumber ?? a.store.name.slice(0, 4)}
                              </span>
                            ))}
                            {member.storeAssignments.length > 8 && (
                              <span className="text-xs text-[var(--color-muted-foreground)]">+{member.storeAssignments.length - 8}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <DeleteStaffButton staffId={member.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
          {unassigned.length > 0 && (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--color-border)]">
                <p className="font-semibold text-[var(--color-foreground)]">Unassigned</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{unassigned.length} member{unassigned.length !== 1 ? "s" : ""}</p>
              </div>
              <table className="w-full">
                <tbody>
                  {unassigned.map((member) => (
                    <tr key={member.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-6 py-3 text-sm font-medium text-[var(--color-foreground)]">{member.displayName}</td>
                      <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">{member.fullName ?? "—"}</td>
                      <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">—</td>
                      <td className="px-6 py-3 text-right">
                        <DeleteStaffButton staffId={member.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
