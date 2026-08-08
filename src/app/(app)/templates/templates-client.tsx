"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Plus, Eye, Pencil, Copy, Archive, CheckCircle, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { normalizePhase } from "@/lib/phases"
import { badgePreset } from "@/lib/badge-presets"
import { TemplateImportButton } from "./template-import-button"
import { TemplateExportButton } from "./template-export-button"
import { TypeManagerDialog, type TemplateType } from "./type-manager-dialog"

// TPL-1b: the hardcoded TYPE_COLORS map that stood here is GONE. It held nine
// keys written to match scripts/import-keva-templates.ts, one of which
// ("Audit") no write path had ever produced — Gary ruled it out of the seed on
// 2026-08-08 (Q1) and it retires with the map. Colours now come from the row.
//
// The grey fallback is KEPT and still matters: a template imported during the
// TPL-1a window carries typeId = null (Gary, Q3: left as-is, no backfill), so
// it has no joined row to read a colour from. It renders its legacy string in
// neutral grey, exactly as an unrecognised type always did.
function TypeBadge({ type, colorKey }: { type: string; colorKey: string | null }) {
  const cls = badgePreset(colorKey).badge
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
  typeId: string | null
  frequency: string
  availabilityType: string
  operationalPhase: string | null
  startOffsetHours: number | null
  endOffsetHours: number | null
  appliesTo: string
  isActive: boolean
  isArchived: boolean
  tasks: TemplateTask[]
  // TPL-1b: joined by GET /api/templates. Null for a template imported during
  // the TPL-1a window, which still renders correctly from `type`.
  templateType: { id: string; name: string; colorKey: string } | null
}

type SortKey = "created" | "name" | "tasks"

export default function TemplatesClient() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [types, setTypes] = useState<TemplateType[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<"active" | "archived">("active")
  const [bulkLoading, setBulkLoading] = useState(false)
  // TPL-1a: id of a template whose Duplicate was refused for want of a type.
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  // TPL-1b: null = All. Filters by typeId, not by the name string, so two types
  // that were once the same word do not collapse into one chip.
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("created")
  const [managerOpen, setManagerOpen] = useState(false)

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

  // Promise-callback style rather than try/catch, and NOT a stylistic choice:
  // react-hooks/set-state-in-effect rejects a `catch { setTypes([]) }` here,
  // because a synchronous throw out of fetch would make that setState run
  // synchronously inside the mount effect. In a .catch() callback it cannot.
  // Same pattern as the types fetch in template-form.tsx.
  async function loadTypes() {
    await fetch("/api/template-types")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTypes(Array.isArray(data) ? data : []))
      .catch(() => setTypes([]))
  }

  useEffect(() => { load(); loadTypes() }, [])

  const visible = templates
    .filter((t) => view === "archived" ? t.isArchived : !t.isArchived)
    .filter((t) => typeFilter === null || t.typeId === typeFilter)
    .slice()
    .sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name)
      if (sortKey === "tasks") return b.tasks.length - a.tasks.length
      return 0 // "created" — the API already returns createdAt asc
    })

  // Counts for the chips are taken from the CURRENT VIEW (active or archived),
  // not from the whole set, so a chip's number always matches what clicking it
  // shows. This is deliberately NOT the same count as the manage dialog's,
  // which is org-wide and archived-inclusive because it governs deletion.
  const inView = templates.filter((t) => view === "archived" ? t.isArchived : !t.isArchived)
  const countFor = (typeId: string) => inView.filter((t) => t.typeId === typeId).length

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

  // TPL-1a: sends typeId, not type — POST resolves it and writes both columns.
  // This path was ALREADY carrying a real type through (it is the only way an
  // operator could make a non-"Mid-Shift" template before the form got its
  // select — docs/prompts/TYPE-1_AUDIT.md §4), so the behaviour is unchanged;
  // what changes is which field carries it. A template whose typeId is null
  // cannot be duplicated until it is opened and given a type, which is the same
  // rule the form enforces rather than a new one.
  async function duplicate(template: Template) {
    if (!template.typeId) {
      setDuplicateError(template.id)
      return
    }
    setDuplicateError(null)
    await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${template.name} (Copy)`,
        typeId: template.typeId,
        frequency: template.frequency,
        availabilityType: template.availabilityType,
        operationalPhase: normalizePhase(template.operationalPhase),
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
          {/* TPL-1b: type management lives here rather than in Settings (Gary,
              2026-08-07), following inventory's precedent of keeping a list's
              settings with the list. No capability check on the button —
              templates/layout.tsx already gates this whole surface on
              templates.manage, which is ADMIN_ONLY. */}
          <Button variant="outline" onClick={() => setManagerOpen(true)}>
            <Tags className="h-4 w-4" />
            Manage Types
          </Button>
          <TemplateExportButton />
          <TemplateImportButton onImported={() => { load(); loadTypes() }} />
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

      {/* TPL-1b: type filter — a genuine filter, composed with the Active /
          Archived tabs above rather than replacing them. Client-side over the
          already-loaded array; no refetch. */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
            typeFilter === null
              ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-transparent"
              : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          All ({inView.length})
        </button>
        {types.map((t) => {
          const on = typeFilter === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTypeFilter(on ? null : t.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                on ? badgePreset(t.colorKey).badge : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${badgePreset(t.colorKey).dot}`} />
              {t.name} ({countFor(t.id)})
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <label htmlFor="template-sort" className="text-xs text-[var(--color-muted-foreground)]">Sort</label>
          <select
            id="template-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-1 bg-[var(--color-card)] text-[var(--color-foreground)]"
          >
            <option value="created">Date created</option>
            <option value="name">Name</option>
            <option value="tasks">Task count</option>
          </select>
        </div>
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
          {/* TPL-1b: a filtered-to-empty view is NOT "no templates yet" — the
              old copy plus a Create CTA would tell an operator to make a
              template they already have, one chip away. */}
          {typeFilter !== null ? (
            <>
              <p className="font-medium text-[var(--color-foreground)] mb-1">
                No {view === "archived" ? "archived " : ""}templates of this type
              </p>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Clear the filter to see the rest.</p>
              <Button size="sm" variant="outline" onClick={() => setTypeFilter(null)}>Show all types</Button>
            </>
          ) : (
            <>
              <p className="font-medium text-[var(--color-foreground)] mb-1">{view === "archived" ? "No archived templates" : "No templates yet"}</p>
              {view === "active" && (
                <>
                  <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Create your first checklist template to get started</p>
                  <Link href="/templates/new">
                    <Button size="sm"><Plus className="h-4 w-4" /> Create Template</Button>
                  </Link>
                </>
              )}
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
                    <TypeBadge type={template.templateType?.name ?? template.type} colorKey={template.templateType?.colorKey ?? null} />
                  </div>
                  {/* DEBT-29: "Run:", not "When:" — availabilityType is a label for
                      staff, not a visibility gate. Matches the template form's field. */}
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                    <span>Run:</span>
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
                {duplicateError === template.id && (
                  <p className="mt-2 text-xs text-[var(--color-destructive)]">
                    Open this template and choose a type before duplicating it.
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <TypeManagerDialog
        open={managerOpen}
        types={types}
        onClose={() => setManagerOpen(false)}
        // Both lists refetch: a rename rewrites Template.type on every template
        // carrying it, and a reassign moves typeId, so the grid is stale in
        // both cases and not only the type list.
        onChanged={async () => { await Promise.all([loadTypes(), load()]) }}
      />
    </div>
  )
}
