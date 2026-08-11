"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Archive, CheckCircle, Copy, GraduationCap, LayoutGrid, List, ListChecks, Pencil, Plus, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { badgePreset } from "@/lib/badge-presets"
import { TrainingImportButton } from "./training-import-button"
import { TrainingExportButton } from "./training-export-button"
import { CategoryManagerDialog, type TrainingCategory } from "./category-manager-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type TrainingResource = {
  id: string
  label: string
  fileUrl: string
  contentType: string
  sizeBytes: number
  orderIndex: number
}

type TrainingLesson = {
  id: string
  title: string
  info: string | null
  videoUrl: string | null
  orderIndex: number
  resources: TrainingResource[]
}

type TrainingQuiz = {
  id: string
  passThreshold: number
  questions: unknown[]
}

type TrainingModule = {
  id: string
  title: string
  subject: string | null
  // categoryId is carried for Duplicate's client-composed POST body and for
  // the chip filter; badges render from the joined `category` below, so a
  // rename or recolor shows everywhere on reload.
  categoryId: string | null
  category: { id: string; name: string; colorKey: string } | null
  description: string | null
  appliesTo: string
  isActive: boolean
  isArchived: boolean
  lessons: TrainingLesson[]
  quizzes: TrainingQuiz[]
  storeAssignments: { storeId: string }[]
}

type Tab = "active" | "inactive" | "archived"
type Layout = "card" | "list"

// HR-21 (R-f): the card/list preference, per browser. localStorage outlives
// logout (UX-2's caveat) — accepted on the row: the toggle is cosmetic, and
// this page is unreachable from a shared-device STORE session.
const VIEW_STORAGE_KEY = "froot.hr.training.view"

// Chip-filter sentinel for modules with no category. Category ids are cuids,
// so this cannot collide with a real id.
const UNCATEGORIZED = "uncategorized"

// HR-21 tab semantics (ruled 2026-08-10): three tabs PARTITION the set — the
// old "Active" tab counted !isArchived and silently held deactivated modules
// (DEBT-67's pattern). Archived keeps its exact prior meaning (isArchived,
// regardless of isActive), so nothing visible under Archived moved.
function inTab(m: TrainingModule, tab: Tab): boolean {
  if (tab === "archived") return m.isArchived
  if (tab === "inactive") return !m.isArchived && !m.isActive
  return !m.isArchived && m.isActive
}

const TAB_LABELS: Record<Tab, string> = { active: "Active", inactive: "Inactive", archived: "Archived" }

function CardSkeleton() {
  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5 animate-pulse">
      <div className="h-5 w-2/3 bg-[var(--color-muted)] rounded mb-3" />
      <div className="h-4 w-24 bg-[var(--color-muted)] rounded mb-2" />
      <div className="h-4 w-32 bg-[var(--color-muted)] rounded mb-4" />
      <div className="h-6 w-40 bg-[var(--color-muted)] rounded" />
    </div>
  )
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${isActive ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"}`}>
      {isActive ? "Active" : "Inactive"}
    </span>
  )
}

// Renders nothing for an uncategorized module — no empty badge slot, no
// placeholder. Uncategorized is a legal resting state (R-a), and today it is
// every production module's state.
function CategoryBadge({ category }: { category: { name: string; colorKey: string } | null }) {
  if (!category) return null
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgePreset(category.colorKey).badge}`}>
      {category.name}
    </span>
  )
}

// The ONE action cluster, rendered by both views — the parity rule ("a module
// must not differ in available actions between views") holds by construction
// because neither view composes its own.
function ModuleActions({ module, onDuplicate }: { module: TrainingModule; onDuplicate: (m: TrainingModule) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Link href={`/hr/training/${module.id}/edit`}>
        <button className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
          <Pencil className="h-3 w-3" /> Edit
        </button>
      </Link>
      <button onClick={() => onDuplicate(module)} className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
        <Copy className="h-3 w-3" /> Duplicate
      </button>
      {/* HR-22: the Bulk Assign entry point lands here — inside this shared
          cluster, so it appears in card and list views at once. */}
    </div>
  )
}

export default function TrainingClient() {
  const [modules, setModules] = useState<TrainingModule[]>([])
  const [categories, setCategories] = useState<TrainingCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<Tab>("active")
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>("card")
  const [managerOpen, setManagerOpen] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)

  async function load() {
    try {
      const res = await fetch("/api/hr/training")
      const data = await res.json()
      setModules(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  // Promise-callback style rather than try/catch, and NOT a stylistic choice:
  // react-hooks/set-state-in-effect rejects a synchronous setState path inside
  // the mount effect. Same pattern as the types fetch in templates-client.tsx.
  async function loadCategories() {
    await fetch("/api/hr/training/categories")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]))
  }

  useEffect(() => { load(); loadCategories() }, [])

  // R-f: read ONCE on mount. Anything but the two valid values — key absent,
  // value unparseable, storage unavailable entirely — leaves the card-view
  // fallback in place. Deferred to a microtask for the same
  // react-hooks/set-state-in-effect reason as loadCategories above.
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const stored = localStorage.getItem(VIEW_STORAGE_KEY)
        if (stored === "card" || stored === "list") setLayout(stored)
      } catch {
        // storage unavailable — keep the default
      }
    })
  }, [])

  function changeLayout(next: Layout) {
    setLayout(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // best-effort — a blocked write only costs persistence, not the toggle
    }
  }

  // ONE data source: `modules` is the only module state, `visible` its only
  // derivation (tab filter, then chip filter). Both layouts render `visible`
  // and nothing else — the list view never fetches or derives its own data.
  const inView = modules.filter((m) => inTab(m, view))
  const visible = inView.filter((m) =>
    categoryFilter === null
      ? true
      : categoryFilter === UNCATEGORIZED
        ? m.categoryId === null
        : m.categoryId === categoryFilter
  )

  const tabCount = (tab: Tab) => modules.filter((m) => inTab(m, tab)).length
  // Chip counts come from the CURRENT TAB, so a chip's number always matches
  // what clicking it shows — deliberately NOT the manage dialog's count, which
  // is org-wide and archived-inclusive because it governs deletion (TPL-1's
  // "two counts, deliberately different").
  const countFor = (categoryId: string) => inView.filter((m) => m.categoryId === categoryId).length
  const uncategorizedCount = inView.filter((m) => m.categoryId === null).length

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    const visibleIds = visible.map((m) => m.id)
    const allSel = visibleIds.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      visibleIds.forEach((id) => (allSel ? next.delete(id) : next.add(id)))
      return next
    })
  }

  async function bulkAction(patch: { isActive?: boolean; isArchived?: boolean }) {
    setBulkLoading(true)
    try {
      await fetch("/api/hr/training", {
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

  // Duplicate clones lessons + quiz + resource rows; the resource rows point
  // at the same private blobs (never deleted), so no files are re-uploaded.
  // Note: the copy arrives isActive: false, so it lands under the Inactive tab.
  async function duplicate(m: TrainingModule) {
    const quiz = m.quizzes[0]
    await fetch("/api/hr/training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${m.title} (Copy)`,
        subject: m.subject,
        categoryId: m.categoryId,
        description: m.description,
        appliesTo: m.appliesTo,
        storeIds: m.storeAssignments.map((a) => a.storeId),
        isActive: false,
        lessons: m.lessons.map((l) => ({
          title: l.title,
          info: l.info,
          videoUrl: l.videoUrl,
          orderIndex: l.orderIndex,
          resources: l.resources.map((r) => ({
            label: r.label,
            fileUrl: r.fileUrl,
            contentType: r.contentType,
            sizeBytes: r.sizeBytes,
            orderIndex: r.orderIndex,
          })),
        })),
        quiz: quiz ? { passThreshold: quiz.passThreshold, questions: quiz.questions } : null,
      }),
    })
    await load()
  }

  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.id))
  const someSelected = selected.size > 0

  function contentSummary(m: TrainingModule) {
    const quiz = m.quizzes[0]
    return (
      <>
        {m.lessons.length} lesson{m.lessons.length !== 1 ? "s" : ""}
        {quiz ? ` · quiz (${(quiz.questions ?? []).length} questions, pass ${quiz.passThreshold}%)` : " · no quiz"}
      </>
    )
  }

  function appliesToText(m: TrainingModule) {
    return m.appliesTo === "selected"
      ? `${m.storeAssignments.length} store${m.storeAssignments.length !== 1 ? "s" : ""}`
      : "All stores"
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Training Modules</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Build lesson-based training with videos, files, and a quiz
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* HR-21: category management lives here, with the list it
              categorises — no role check on the button; the page's server
              shell already gates this surface ADMIN-only. */}
          <Button variant="outline" onClick={() => setManagerOpen(true)}>
            <Tags className="h-4 w-4" />
            Manage Categories
          </Button>
          <TrainingExportButton />
          <TrainingImportButton onImported={() => { load(); loadCategories() }} />
          <Link href="/hr/training/new">
            <Button>
              <Plus className="h-4 w-4" />
              Create Module
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center gap-2 mb-4">
        {(["active", "inactive", "archived"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setView(tab); setSelected(new Set()) }}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === tab ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
          >
            {TAB_LABELS[tab]} ({tabCount(tab)})
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => changeLayout("card")}
            aria-label="Card view"
            aria-pressed={layout === "card"}
            className={`p-1.5 rounded transition-colors ${layout === "card" ? "bg-[var(--color-muted)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => changeLayout("list")}
            aria-label="List view"
            aria-pressed={layout === "list"}
            className={`p-1.5 rounded transition-colors ${layout === "list" ? "bg-[var(--color-muted)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Category filter chips — composed with the tabs, client-side over the
          already-loaded array; no refetch. Rendered only once the org has
          categories: with none, All and Uncategorized would be the same chip. */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
              categoryFilter === null
                ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-transparent"
                : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            All ({inView.length})
          </button>
          {categories.map((c) => {
            const on = categoryFilter === c.id
            return (
              <button
                key={c.id}
                onClick={() => setCategoryFilter(on ? null : c.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                  on ? badgePreset(c.colorKey).badge : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${badgePreset(c.colorKey).dot}`} />
                {c.name} ({countFor(c.id)})
              </button>
            )
          })}
          {/* The working queue for hand-categorizing the backlog — the state
              every production module is in today. */}
          <button
            onClick={() => setCategoryFilter(categoryFilter === UNCATEGORIZED ? null : UNCATEGORIZED)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
              categoryFilter === UNCATEGORIZED
                ? badgePreset(null).badge
                : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${badgePreset(null).dot}`} />
            Uncategorized ({uncategorizedCount})
          </button>
        </div>
      )}

      {/* Bulk action bar — verbs follow the tab (ruled 2026-08-10): Active
          offers Deactivate + Archive, Inactive offers Activate + Archive,
          Archived offers Unarchive. */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-[var(--color-muted)]/30 border border-[var(--color-border)]">
          <span className="text-sm font-medium text-[var(--color-foreground)]">{selected.size} modules selected</span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
            Clear Selection
          </button>
          <div className="ml-auto flex items-center gap-2">
            {view === "active" && (
              <Button size="sm" variant="outline" onClick={() => bulkAction({ isActive: false })} disabled={bulkLoading}>
                Deactivate
              </Button>
            )}
            {view === "inactive" && (
              <Button size="sm" variant="outline" onClick={() => bulkAction({ isActive: true })} disabled={bulkLoading}>
                <CheckCircle className="h-4 w-4" /> Activate
              </Button>
            )}
            {view !== "archived" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={bulkLoading}>
                    <Archive className="h-4 w-4" /> Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive {selected.size} module{selected.size !== 1 ? "s" : ""}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Archived modules move to the Archived tab and can no longer be assigned. Nothing is deleted — you can unarchive them at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => bulkAction({ isArchived: true })}>
                      Archive
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
        <div className="grid grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          {/* A filtered-to-empty view is NOT "no modules yet" — the old copy
              plus a Create CTA would tell an operator to make a module they
              already have, one chip away (the TPL-1b lesson). */}
          {categoryFilter !== null ? (
            <>
              <p className="font-medium text-[var(--color-foreground)] mb-1">
                {categoryFilter === UNCATEGORIZED
                  ? `No uncategorized ${view} modules`
                  : `No ${view} modules in this category`}
              </p>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Clear the filter to see the rest.</p>
              <Button size="sm" variant="outline" onClick={() => setCategoryFilter(null)}>Show all categories</Button>
            </>
          ) : (
            <>
              <p className="font-medium text-[var(--color-foreground)] mb-1">
                {view === "archived" ? "No archived modules" : view === "inactive" ? "No inactive modules" : "No training modules yet"}
              </p>
              {view === "active" && (
                <>
                  <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
                    Create your first module — add lessons, link videos, attach files, and write a quiz
                  </p>
                  <Link href="/hr/training/new">
                    <Button size="sm"><Plus className="h-4 w-4" /> Create Module</Button>
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
          {layout === "card" ? (
            <div className="grid grid-cols-3 gap-4">
              {visible.map((m) => (
                <div key={m.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} />
                      <div className="w-6 h-6 rounded bg-[var(--color-primary)]/10 flex items-center justify-center">
                        <GraduationCap className="h-4 w-4 text-[var(--color-primary)]" />
                      </div>
                    </div>
                    <StatusBadge isActive={m.isActive} />
                  </div>

                  <h3 className="font-semibold text-[var(--color-foreground)] mb-2">{m.title}</h3>

                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <CategoryBadge category={m.category} />
                    {m.subject && (
                      <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-foreground)]">
                        {m.subject}
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-foreground)]">
                      {appliesToText(m)}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--color-muted-foreground)] mb-3 flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" />
                    {contentSummary(m)}
                  </p>

                  <ModuleActions module={m} onDuplicate={duplicate} />
                </div>
              ))}
            </div>
          ) : (
            /* The list view is a second rendering of the same `visible` array —
               same badge, status, and action set as the cards. The title column
               absorbs remaining width and truncates (w-full max-w-0), every
               other cell is nowrap, so a row cannot overflow a laptop window. */
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted-foreground)]">
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Module</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Stores</th>
                    <th className="px-3 py-2 font-medium">Content</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {visible.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2.5 align-middle">
                        <input type="checkbox" className="rounded" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} />
                      </td>
                      <td className="w-full max-w-0 px-3 py-2.5">
                        <div className="font-medium text-[var(--color-foreground)] truncate">{m.title}</div>
                        {/* Uncategorized renders as an empty Category cell —
                            no dash, no placeholder (CategoryBadge is null). */}
                        {m.subject && (
                          <div className="text-xs text-[var(--color-muted-foreground)] truncate">{m.subject}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <CategoryBadge category={m.category} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--color-muted-foreground)]">
                        {appliesToText(m)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-[var(--color-muted-foreground)]">
                        {contentSummary(m)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusBadge isActive={m.isActive} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <ModuleActions module={m} onDuplicate={duplicate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <CategoryManagerDialog
        open={managerOpen}
        categories={categories}
        onClose={() => setManagerOpen(false)}
        onChanged={async () => {
          await Promise.all([load(), loadCategories()])
        }}
      />
    </div>
  )
}
