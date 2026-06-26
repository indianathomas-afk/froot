import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { CheckSquare } from "lucide-react"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { format } from "date-fns"

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  Pending: { label: "Not Started", classes: "bg-gray-100 text-gray-600 border border-gray-200" },
  "In Progress": { label: "In Progress", classes: "bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]" },
  Completed: { label: "Completed", classes: "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]" },
  "Non-Compliant": { label: "Non-Compliant", classes: "bg-red-50 text-[var(--color-destructive)] border border-red-200" },
}

async function getChecklists() {
  const { orgId } = await auth()
  if (!orgId) return { checklists: [], stores: [] }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { checklists: [], stores: [] }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const [checklists, stores] = await Promise.all([
    prisma.checklist.findMany({
      where: { organizationId: org.id, date: { gte: today, lt: tomorrow } },
      include: { store: true, template: true },
      orderBy: { date: "desc" },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
  ])

  return { checklists, stores }
}

export default async function ChecklistsPage() {
  const { checklists, stores } = await getChecklists()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Daily Checklists</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">View and manage daily checklists across all locations</p>
      </div>

      {/* Filter */}
      <div className="mb-6">
        <Select defaultValue="all">
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {checklists.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <CheckSquare className="h-10 w-10 mx-auto mb-3 text-[var(--color-muted-foreground)] opacity-40" />
          <p className="font-medium text-[var(--color-foreground)] mb-1">No checklists found</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">Generate checklists for your stores using the button in the top right corner</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {checklists.map((checklist) => {
            const statusInfo = STATUS_STYLES[checklist.status] ?? STATUS_STYLES.Pending
            return (
              <div key={checklist.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-[var(--color-primary)]" />
                    <span className="font-semibold text-sm text-[var(--color-foreground)]">{checklist.store.name}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.classes}`}>
                    {statusInfo.label}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs px-2 py-0.5">
                    {checklist.store.brand ?? "Keva Juice"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs px-2 py-0.5">
                    {checklist.template.type}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] mb-4">
                  📅 {format(new Date(checklist.date), "EEE, MMM d")}
                </div>

                <Link
                  href={`/store-view/checklist/${checklist.id}`}
                  className="flex items-center justify-center gap-1.5 w-full border border-[var(--color-border)] rounded-md py-1.5 text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
                >
                  👁 View Checklist
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
