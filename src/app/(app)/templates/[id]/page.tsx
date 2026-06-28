import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import Link from "next/link"
import { PrintButton } from "./print-button"

export default async function TemplateViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) return notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return notFound()

  const template = await prisma.template.findFirst({
    where: { id, organizationId: org.id },
    include: { tasks: { orderBy: { orderIndex: "asc" } } },
  })
  if (!template) return notFound()

  // Group tasks by section
  const sections = template.tasks.reduce<Record<string, typeof template.tasks>>((acc, task) => {
    const key = task.sectionName || "General"
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})

  const totalMinutes = template.tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60

  return (
    <div className="max-w-3xl mx-auto">
      {/* Screen-only controls */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link href="/templates" className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          ← Back to Templates
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/templates/${id}/edit`}>
            <button className="text-sm border border-[var(--color-border)] rounded px-3 py-1.5 hover:bg-[var(--color-accent)] transition-colors">
              Edit
            </button>
          </Link>
          <PrintButton templateId={id} />
        </div>
      </div>

      {/* Printable content */}
      <div className="border border-[var(--color-border)] rounded-lg bg-white p-8 print:border-0 print:p-0 print:rounded-none">
        {/* Header */}
        <div className="border-b border-gray-200 pb-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
          {template.description && (
            <p className="text-sm text-gray-500 mt-1">{template.description}</p>
          )}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span>Type: <strong>{template.type}</strong></span>
            <span>Frequency: <strong>{template.frequency}</strong></span>
            {totalMinutes > 0 && (
              <span>Est. Time: <strong>{hours > 0 ? `${hours}h ` : ""}{mins > 0 ? `${mins}m` : ""}</strong></span>
            )}
            <span>Tasks: <strong>{template.tasks.length}</strong></span>
          </div>
        </div>

        {/* Sections */}
        {Object.entries(sections).map(([section, tasks]) => (
          <div key={section} className="mb-6">
            <h2 className="font-semibold text-gray-800 mb-3 text-sm uppercase tracking-wide border-b border-gray-100 pb-1">
              {section}
            </h2>
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 py-2 border-b border-gray-50 last:border-0 ${task.isCritical ? "bg-red-50 px-2 rounded" : ""}`}
                >
                  {/* Physical checkbox for printing */}
                  <div className="mt-0.5 w-4 h-4 border-2 border-gray-400 rounded flex-shrink-0 print:border-gray-600" />
                  <div className="flex-1">
                    <p className={`text-sm ${task.isCritical ? "text-red-600 font-semibold" : "text-gray-800"}`}>
                      {task.description}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.isCritical && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                          <AlertTriangle className="h-3 w-3" /> Critical
                        </span>
                      )}
                      {task.requiresPhoto && (
                        <span className="text-xs text-blue-600">📷 Photo required</span>
                      )}
                      {task.requiresTemp && (
                        <span className="text-xs text-orange-600">🌡 Temp required</span>
                      )}
                      {task.estimatedTimeMinutes && (
                        <span className="text-xs text-gray-400">~{task.estimatedTimeMinutes} min</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400 flex items-center justify-between">
          <span>{template.name}</span>
          <span>Completed by: _________________ Date: _____________</span>
        </div>
      </div>
    </div>
  )
}
