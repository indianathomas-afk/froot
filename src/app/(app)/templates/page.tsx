import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Plus, Eye, Pencil, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const TYPE_COLORS: Record<string, string> = {
  Opener: "bg-orange-100 text-orange-700 border-orange-200",
  Closer: "bg-purple-100 text-purple-700 border-purple-200",
  "Mid-Shift": "bg-blue-100 text-blue-700 border-blue-200",
  Cleaning: "bg-green-100 text-green-700 border-green-200",
  Audit: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Management: "bg-red-100 text-red-700 border-red-200",
  Coffee: "bg-amber-100 text-amber-700 border-amber-200",
  Berries: "bg-pink-100 text-pink-700 border-pink-200",
}

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_COLORS[type] ?? "bg-gray-100 text-gray-700 border-gray-200"
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  )
}

async function getTemplates() {
  const { orgId } = await auth()
  if (!orgId) return []
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return []
  return prisma.template.findMany({
    where: { organizationId: org.id },
    include: { tasks: true },
    orderBy: { createdAt: "asc" },
  })
}

export default async function TemplatesPage() {
  const templates = await getTemplates()

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Checklist Templates</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage checklist templates for different brands and shifts</p>
        </div>
        <Link href="/templates/new">
          <Button>
            <Plus className="h-4 w-4" />
            Create Template
          </Button>
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">No templates yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Create your first checklist template to get started</p>
          <Link href="/templates/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Create Template
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <button className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">Select All</button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {templates.map((template) => (
              <div key={template.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="rounded" />
                    <div className="w-6 h-6 rounded bg-[var(--color-muted)] flex items-center justify-center text-xs">📋</div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${template.isActive ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"}`}>
                    {template.isActive ? "Active" : "Inactive"}
                  </span>
                </div>

                <h3 className="font-semibold text-[var(--color-foreground)] mb-2">{template.name}</h3>

                <div className="space-y-1 mb-3">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                    <span>Type:</span>
                    <TypeBadge type={template.type} />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                    <span>When:</span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-[var(--color-muted)] text-[var(--color-foreground)]`}>
                      {template.availabilityType === "StoreHours" ? "Store Hours" : "All Day"}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-[var(--color-muted-foreground)] mb-3">
                  View tasks
                </p>

                <div className="flex items-center gap-1">
                  <Link href={`/templates/${template.id}`}>
                    <button className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
                      <Eye className="h-3 w-3" /> View
                    </button>
                  </Link>
                  <Link href={`/templates/${template.id}/edit`}>
                    <button className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  </Link>
                  <button className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
                    <Copy className="h-3 w-3" /> Duplicate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
