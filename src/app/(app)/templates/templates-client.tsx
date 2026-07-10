"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Plus, Eye, Pencil, Copy, Archive, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TemplateImportButton } from "./template-import-button"
import { TemplateExportButton } from "./template-export-button"

const TYPE_COLORS: Record<string, string> = {
  Opener: "bg-orange-100 text-orange-700 border-orange-200",
  Closer: "bg-purple-100 text-purple-700 border-purple-200",
  "Mid-Shift": "bg-blue-100 text-blue-700 border-blue-200",
  Cleaning: "bg-green-100 text-green-700 border-green-200",
  Audit: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Management: "bg-red-100 text-red-700 border-red-200",
  Coffee: "bg-amber-100 text-amber-700 border-amber-200",
  Berries: "bg-pink-100 text-pink-700 border-pink-200",
  "Peet's Coffee": "bg-amber-100 text-amber-700 border-amber-200",
}

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_COLORS[type] ?? "bg-gray-100 text-gray-700 border-gray-200"
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  )
}

type TemplateTask = {
  id: string
  sectionName: string
  description: string
  estimatedTimeMinutes: number | null
  requiresPhoto: boolean
  requiresTemp: boolean
  isCritical: boolean
  orderIndex: number
  excludedStoreIds: string[]
  videoUrl: string | null
}

type Template = {
  id: string
  name: string
  type: string
  frequency: string
  availabilityType: string
  operationalPhase: string | null
  startOffsetHours: number | null
  endOffsetHours: number | null
  appliesTo: string
  isActive: boolean
  isArchived: boolean
  tasks: TemplateTask[]
}

export default function TemplatesClient() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<"active" | "archived">("active")
  const [bulkLoading, setBulkLoading] = useState(false)

  // loading starts true and only reloads keep showing current data — no
  // synchronous setState here so the mount effect stays lint-clean.
  async function load() {
    try {
      const res = await fetch("/api/templates")
      const data = await res.json()
      setTemplates(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const visible = templates.filter((t) => view === "archived" ? t.isArchived : !t.isArchived)

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    const visibleIds = visible.map((t) => t.id)
    const allSel = visibleIds.every((id) => selected.has(id))
    if (allSel) {
      setSelected((prev) => {
        const next = new Set(prev)
        visibleIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        visibleIds.forEach((id) => next.add(id))
        return next
      })
    }
  }

  async function bulkAction(patch: { isActive?: boolean; isArchived?: boolean }) {
    setBulkLoading(true)
    try {
      await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), ...patch }),
      })
      setSelected(new Set())
      await load()
    } finally {
      setBulkLoading(false)
    }
  }

  async function duplicate(template: Template) {
    await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${template.name} (Copy)`,
        type: template.type,
        frequency: template.frequency,
        availabilityType: template.availabilityType,
        operationalPhase: template.operationalPhase,
        startOffsetHours: template.startOffsetHours,
        endOffsetHours: template.endOffsetHours,
        appliesTo: template.appliesTo,
        isActive: false,
        tasks: template.tasks.map((t) => ({
          sectionName: t.sectionName,
          description: t.description,
          estimatedTimeMinutes: t.estimatedTimeMinutes,
          requiresPhoto: t.requiresPhoto,
          requiresTemp: t.requiresTemp,
          isCritical: t.isCritical,
          orderIndex: t.orderIndex,
          excludedStoreIds: t.excludedStoreIds,
          videoUrl: t.videoUrl ?? null,
        })),
      }),
    })
    await load()
  }

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id))
  const someSelected = selected.size > 0

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Checklist Templates</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage checklist templates for different brands and shifts</p>
        </div>
        <div className="flex items-center gap-2">
          <TemplateExportButton />
          <TemplateImportButton onImported={load} />
          <Link href="/templates/new">
            <Button>
              <Plus className="h-4 w-4" />
              Create Template
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => { setView("active"); setSelected(new Set()) }}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === "active" ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
        >
          Active ({templates.filter((t) => !t.isArchived).length})
        </button>
        <button
          onClick={() => { setView("archived"); setSelected(new Set()) }}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === "archived" ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
        >
          Archived ({templates.filter((t) => t.isArchived).length})
        </button>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-[var(--color-muted)]/30 border border-[var(--color-border)]">
          <span className="text-sm font-medium text-[var(--color-foreground)]">{selected.size} templates selected</span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
            Clear Selection
          </button>
          <div className="ml-auto flex items-center gap-2">
            {view === "active" && (
              <>
                <Button size="sm" variant="outline" onClick={() => bulkAction({ isActive: false })} disabled={bulkLoading}>
                  Deactivate
                </Button>
                <Button size="sm" variant="outline" onClick={() => bulkAction({ isActive: true })} disabled={bulkLoading}>
                  <CheckCircle className="h-4 w-4" /> Activate
                </Button>
                <Button size="sm" variant="outline" onClick={() => bulkAction({ isArchived: true })} disabled={bulkLoading}>
                  <Archive className="h-4 w-4" /> Archive
                </Button>
              </>
            )}
            {view === "archived" && (
              <Button size="sm" variant="outline" onClick={() => bulkAction({ isArchived: false })} disabled={bulkLoading}>
                Unarchive
              </Button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading...</p>
      ) : visible.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">{view === "archived" ? "No archived templates" : "No templates yet"}</p>
          {view === "active" && (
            <>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Create your first checklist template to get started</p>
              <Link href="/templates/new">
                <Button size="sm"><Plus className="h-4 w-4" /> Create Template</Button>
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3">
            <button onClick={toggleAll} className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              {allVisibleSelected ? "Clear" : "Select All"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {visible.map((template) => (
              <div key={template.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="rounded" checked={selected.has(template.id)} onChange={() => toggleOne(template.id)} />
                    <div className="w-6 h-6 rounded bg-[var(--color-muted)] flex items-center justify-center">
                      <Image src="/redpaperimage.png" alt="" width={16} height={16} className="object-contain" />
                    </div>
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
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-[var(--color-muted)] text-[var(--color-foreground)]">
                      {template.availabilityType === "StoreHours" ? "Store Hours" : "All Day"}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-[var(--color-muted-foreground)] mb-3">
                  {template.tasks.length} task{template.tasks.length !== 1 ? "s" : ""}
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
                  <button onClick={() => duplicate(template)} className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
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
