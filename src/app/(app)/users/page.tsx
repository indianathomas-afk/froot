import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { format } from "date-fns"

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-orange-100 text-orange-700 border border-orange-200",
  MANAGER: "bg-blue-100 text-blue-700 border border-blue-200",
  STAFF: "bg-gray-100 text-gray-600 border border-gray-200",
  STORE: "bg-purple-100 text-purple-700 border border-purple-200",
}

async function getUsers() {
  const { orgId } = await auth()
  if (!orgId) return []
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return []
  return prisma.user.findMany({
    where: { organizationId: org.id },
    include: { storeAssignments: { include: { store: true } } },
    orderBy: { createdAt: "asc" },
  })
}

export default async function UsersPage() {
  const users = await getUsers()

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">User Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage user accounts and permissions</p>
        </div>
        <Button>
          <Plus className="h-4 w-4" />
          Create User
        </Button>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-medium text-[var(--color-foreground)]">All Users</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">View and manage all user accounts in the system</p>
        </div>
        {users.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No users yet. Invite team members to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["Email", "Name", "Role", "Store", "Created", "Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                    <td className="px-6 py-3 text-sm text-[var(--color-foreground)]">{user.email}</td>
                    <td className="px-6 py-3 text-sm text-[var(--color-foreground)]">{user.name ?? "—"}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[user.role]}`}>
                        {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">
                      {user.storeAssignments.length > 0
                        ? user.storeAssignments[0].store.name
                        : "—"}
                    </td>
                    <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">
                      {format(new Date(user.createdAt), "M/d/yyyy")}
                    </td>
                    <td className="px-6 py-3 text-sm text-[var(--color-primary)] cursor-pointer hover:opacity-80">
                      Edit
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
