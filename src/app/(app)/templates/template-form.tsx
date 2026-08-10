"use client"

import { Fragment, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle, Camera, Pencil, Play, FileText, X, GripVertical, LayoutList, Table2, ChevronUp, ChevronDown, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OPERATIONAL_PHASES, normalizePhase } from "@/lib/phases"
// CHK-4: the grace buffer is quoted in the explainer copy and drives the clamp
// warning below. IMPORTED, never restated — src/lib/checklist-lifecycle.ts is
// the single definition site (DEBT-26), and a hard-coded "3 hours" in this file
// would be a second one that goes stale the day the constant moves.
import { DAY_CLOSE_GRACE_HOURS, endClampsAtDayClose, hoursForDate, type HoursRow } from "@/lib/checklist-lifecycle"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { badgePreset } from "@/lib/badge-presets"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DndContext, PointerSensor, useSensor, useSensors, DragEndEvent, closestCenter } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

interface TaskAttachment {
  id: string
  label: string
  url: string
  contentType: string
}

interface Task {
  id: string
  sectionName: string
  description: string
  estimatedTimeMinutes: number | null
  requiresPhoto: boolean
  requiresTemp: boolean
  isCritical: boolean
  orderIndex: number
  excludedStoreIds: string[]
  videoUrl?: string | null
  attachment?: TaskAttachment | null
}

interface Store {
  id: string
  name: string
  storeNumber: string | null
  // CHK-4 close-out, 2026-08-10 — the hours the clamp warning needs. OPTIONAL
  // on the interface and defaulted at every read: a store list assembled by
  // some future caller that does not join hours must render a form without the
  // warning, not a form that throws. Both real callers (templates/new,
  // templates/[id]/edit) select them.
  timezone?: string
  hours?: HoursRow[]
}

interface TemplateFormProps {
  stores?: Store[]
  initialData?: {
    id: string
    name: string
    description: string | null
    type: string
    typeId: string | null
    frequency: string
    availabilityType: string
    operationalPhase: string | null
    startOffsetHours: number | null
    endOffsetHours: number | null
    appliesTo?: string
    tasks: Task[]
    // CHK-1: the template's Section rows. Optional so /templates/new can omit
    // it — a template being created has none yet, and POST creates them from
    // the names. What this list carries that the task strings cannot is the
    // IDS, which is what turns an edit into a rename rather than a new section
    // (src/app/api/templates/sections.ts).
    sections?: { id: string; name: string; sortOrder: number }[]
    storeAssignments?: { storeId: string }[]
  }
}

// ─── Sections (CHK-1) ─────────────────────────────────────────────────────────
// THE TASK ARRAY IS THE ONE SOURCE OF SECTION ORDER, and every section's tasks
// are kept CONTIGUOUS in it. That single invariant is what replaces the
// adjacency inference this form used to render headings from:
//
//   • one heading per section, always — a template whose stored tasks are
//     non-contiguous is regrouped on load, which is DEBT-36's second defect and
//     the one visible change of this phase;
//   • `sortOrder` is the section's position in that array, which is exactly
//     MIN(orderIndex) — the same rule the CHK-1 migration recovered order with,
//     so the form, the API and the backfill cannot disagree;
//   • reordering a section moves its tasks with it, because moving a section IS
//     moving its block of tasks.
//
// Membership stays a per-task free-text string, deliberately: DEBT-2b ruled
// sections free text and CHK-1 does not overturn that (plan §6.3). Identity —
// name → Section id — is carried alongside in `sectionIds`, so a rename keeps
// the row it renames.

// ─── The clamp warning's inputs (CHK-4 close-out, 2026-08-10) ────────────────

/** Seven consecutive dates whose weekdays are Sun…Sat. 2026-01-04 IS a Sunday.
 *
 *  FIXED, not derived from today, for two reasons. This component is rendered
 *  on the server as well as in the browser, so a `new Date()` here is a
 *  hydration mismatch waiting for midnight; and the question the warning asks
 *  — "does this offset outrun this store's day?" — is about the store's
 *  WEEKDAY hours, which do not depend on which week it is. A winter week also
 *  keeps every arithmetic comparison inside one DST regime, so a store is not
 *  reported as clamping purely because a reference date fell on a changeover.
 */
const CLAMP_REFERENCE_WEEK = [
  "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07",
  "2026-01-08", "2026-01-09", "2026-01-10",
] as const

/** The applicable stores whose day close would cut this window short — on ANY
 *  weekday, since a template applies to the whole week and one clamped Sunday
 *  is still a clamp the operator should hear about.
 *
 *  A store with no hours, or one this list carries without them, is skipped
 *  rather than assumed: there is nothing to compare, and `endClampsAtDayClose`
 *  says the same for a weekday the store is closed. */
function clampingStores(
  stores: Store[],
  template: { availabilityType: string; operationalPhase: string | null; startOffsetHours: number | null; endOffsetHours: number | null }
): Store[] {
  return stores.filter((s) => {
    const hours = s.hours ?? []
    const tz = s.timezone
    if (hours.length === 0 || !tz) return false
    return CLAMP_REFERENCE_WEEK.some((d) => endClampsAtDayClose(template, hoursForDate(hours, d), d, tz))
  })
}

/** "Carson", "Carson and Midtown", "Carson, Midtown and 2 others". */
function storeListLabel(list: Store[]): string {
  const names = list.map((s) => s.name)
  if (names.length <= 2) return names.join(" and ")
  const rest = names.length - 2
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? "" : "s"}`
}

interface SectionGroup {
  name: string
  tasks: Task[]
}

/** Group tasks by section in FIRST-APPEARANCE order. Lossless: a blank section
 *  (transient — Save is gated on it) becomes its own group rather than vanishing. */
function sectionGroupsOf(tasks: Task[]): SectionGroup[] {
  const groups: SectionGroup[] = []
  const byName = new Map<string, SectionGroup>()
  for (const t of tasks) {
    const name = t.sectionName.trim()
    let g = byName.get(name)
    if (!g) {
      g = { name, tasks: [] }
      byName.set(name, g)
      groups.push(g)
    }
    g.tasks.push(t)
  }
  return groups
}

/** Flatten groups back to one array. Applied on load, after every drag and
 *  after a section move, so the contiguity invariant above always holds. */
function regroupTasks(tasks: Task[]): Task[] {
  return sectionGroupsOf(tasks).flatMap((g) => g.tasks)
}

// DEBT-1b: one shared list — the dropdown and every write path agree by
// construction rather than by hand-copied literal.
const PHASES = OPERATIONAL_PHASES.map((value) => ({ value, label: value }))

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"]

const emptyTaskFields = {
  sectionName: "",
  description: "",
  estimatedTimeMinutes: 5,
  requiresPhoto: false,
  requiresTemp: false,
  isCritical: false,
  excludedStoreIds: [] as string[],
  videoUrl: "",
}

interface EditDraft {
  sectionName: string
  description: string
  estimatedTimeMinutes: number
  requiresPhoto: boolean
  requiresTemp: boolean
  isCritical: boolean
  excludedStoreIds: string[]
  videoUrl: string
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Sortable task row ────────────────────────────────────────────────────────

interface SortableTaskRowProps {
  task: Task
  idx: number
  editingTaskId: string | null
  stores: Store[]
  expandedTaskExclusions: Set<string>
  setExpandedTaskExclusions: React.Dispatch<React.SetStateAction<Set<string>>>
  editDraft: EditDraft
  setEditDraft: React.Dispatch<React.SetStateAction<EditDraft>>
  editExistingAttachment: TaskAttachment | null | undefined
  setEditExistingAttachment: React.Dispatch<React.SetStateAction<TaskAttachment | null | undefined>>
  editAttachmentLabel: string
  setEditAttachmentLabel: React.Dispatch<React.SetStateAction<string>>
  editAttachmentFile: File | null
  setEditAttachmentFile: React.Dispatch<React.SetStateAction<File | null>>
  editAttachmentError: string
  setEditAttachmentError: React.Dispatch<React.SetStateAction<string>>
  validateFile: (f: File) => string
  startEditTask: (task: Task) => void
  saveEditTask: (taskId: string) => Promise<void>
  setEditingTaskId: React.Dispatch<React.SetStateAction<string | null>>
  removeTask: (id: string) => void
  toggleTaskExclusion: (taskId: string, storeId: string) => void
  toggleEditDraftExclusion: (storeId: string) => void
}

function SortableTaskRow({
  task, idx, editingTaskId, stores,
  expandedTaskExclusions, setExpandedTaskExclusions,
  editDraft, setEditDraft,
  editExistingAttachment, setEditExistingAttachment,
  editAttachmentLabel, setEditAttachmentLabel,
  editAttachmentFile, setEditAttachmentFile,
  editAttachmentError, setEditAttachmentError,
  validateFile, startEditTask, saveEditTask, setEditingTaskId,
  removeTask, toggleTaskExclusion, toggleEditDraftExclusion,
}: SortableTaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const isEditing = editingTaskId === task.id

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? "0 4px 12px rgba(0,0,0,0.15)" : undefined,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border ${task.isCritical ? "border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5" : "border-[var(--color-border)] bg-[var(--color-background)]"}`}
    >
      {isEditing ? (
        /* ── Inline edit form ── */
        <div className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Edit Task</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Section Name</Label>
              <Input className="h-8 text-sm" value={editDraft.sectionName} onChange={(e) => setEditDraft((p) => ({ ...p, sectionName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Est. Time (min)</Label>
              <Input className="h-8 text-sm" type="number" min={0} step={0.5} value={editDraft.estimatedTimeMinutes} onChange={(e) => setEditDraft((p) => ({ ...p, estimatedTimeMinutes: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Task Description</Label>
            <Textarea className="text-sm" rows={2} value={editDraft.description} onChange={(e) => setEditDraft((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Training Video URL (optional)</Label>
            <Input className="h-8 text-sm" type="url" placeholder="https://..." value={editDraft.videoUrl} onChange={(e) => setEditDraft((p) => ({ ...p, videoUrl: e.target.value }))} />
          </div>
          {/* Attachment section */}
          <div className="space-y-2 border border-[var(--color-border)] rounded-md p-3 bg-[var(--color-muted)]/10">
            <p className="text-xs font-medium text-[var(--color-foreground)]">Document / Image Attachment (optional)</p>
            {editExistingAttachment && !editAttachmentFile && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-foreground)] bg-[var(--color-accent)] rounded px-2 py-1.5">
                {editExistingAttachment.contentType.startsWith("image/")
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={editExistingAttachment.url} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                  : <FileText className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />}
                <span className="flex-1 truncate">{editExistingAttachment.label}</span>
                <button type="button" onClick={() => setEditExistingAttachment(null)} className="ml-1 hover:text-[var(--color-destructive)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {editAttachmentFile ? (
              <div className="flex items-center gap-2 text-xs bg-[var(--color-accent)] rounded px-2 py-1.5">
                <FileText className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <span className="flex-1 truncate">{editAttachmentFile.name} ({formatBytes(editAttachmentFile.size)})</span>
                <button type="button" onClick={() => { setEditAttachmentFile(null); setEditAttachmentError("") }} className="ml-1 hover:text-[var(--color-destructive)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Input className="h-8 text-sm" placeholder="File Description Name" value={editAttachmentLabel} onChange={(e) => setEditAttachmentLabel(e.target.value)} />
                <Input
                  className="h-8 text-sm"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    if (!f) return
                    const err = validateFile(f)
                    if (err) { setEditAttachmentError(err); e.target.value = "" }
                    else { setEditAttachmentFile(f); setEditAttachmentError("") }
                  }}
                />
              </div>
            )}
            {editAttachmentError && <p className="text-xs text-[var(--color-destructive)]">{editAttachmentError}</p>}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={editDraft.requiresPhoto} onChange={(e) => setEditDraft((p) => ({ ...p, requiresPhoto: e.target.checked }))} className="rounded" />
              Requires Photo
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={editDraft.requiresTemp} onChange={(e) => setEditDraft((p) => ({ ...p, requiresTemp: e.target.checked }))} className="rounded" />
              Requires Temp
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={editDraft.isCritical} onChange={(e) => setEditDraft((p) => ({ ...p, isCritical: e.target.checked }))} className="rounded" />
              Critical
            </label>
          </div>
          {stores.length > 0 && (
            <div className="p-3 bg-[var(--color-muted)]/20 rounded-md border border-[var(--color-border)]">
              <p className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">This task does not apply to:</p>
              <div className="grid grid-cols-2 gap-1">
                {stores.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer p-1 rounded hover:bg-[var(--color-accent)]">
                    <input type="checkbox" checked={editDraft.excludedStoreIds.includes(s.id)} onChange={() => toggleEditDraftExclusion(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveEditTask(task.id)} disabled={!editDraft.description || !editDraft.sectionName}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingTaskId(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        /* ── Read-only row ── */
        <div className="p-3">
          <div className="flex items-start gap-2">
            {/* Drag handle */}
            <div
              {...listeners}
              {...attributes}
              className={`mt-0.5 p-1 rounded shrink-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
              style={{ touchAction: "none" }}
            >
              <GripVertical className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-[var(--color-muted-foreground)] w-5">{idx + 1}.</span>
                {task.isCritical && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] px-1.5 py-0.5 rounded">
                    <AlertTriangle className="h-3 w-3" /> CRITICAL
                  </span>
                )}
                {task.requiresPhoto && (
                  <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)] px-1.5 py-0.5 rounded">
                    <Camera className="h-3 w-3" /> Photo
                  </span>
                )}
                {task.videoUrl && (
                  <a href={task.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs bg-[var(--color-accent)] text-[var(--color-foreground)] border border-[var(--color-border)] px-1.5 py-0.5 rounded hover:bg-[var(--color-accent)]/80">
                    <Play className="h-3 w-3" /> Video
                  </a>
                )}
                {task.attachment && (
                  <a href={task.attachment.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs bg-[var(--color-accent)] text-[var(--color-foreground)] border border-[var(--color-border)] px-1.5 py-0.5 rounded hover:bg-[var(--color-accent)]/80 max-w-[140px]">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{task.attachment.label}</span>
                  </a>
                )}
              </div>
              <p className={`text-sm mt-0.5 ${task.isCritical ? "text-[var(--color-destructive)] font-medium" : "text-[var(--color-foreground)]"}`}>
                {task.description}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-[var(--color-muted-foreground)]">§ {task.sectionName}</span>
                {task.estimatedTimeMinutes && (
                  <span className="text-xs text-[var(--color-muted-foreground)]">~{task.estimatedTimeMinutes} min</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => startEditTask(task)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              </button>
              <button onClick={() => removeTask(task.id)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              </button>
            </div>
          </div>
          {stores.length > 0 && (
            <div className="mt-2 ml-7">
              {expandedTaskExclusions.has(task.id) ? (
                <div className="p-3 bg-[var(--color-muted)]/20 rounded-md border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-[var(--color-muted-foreground)]">This task does not apply to:</p>
                    <button
                      onClick={() => setExpandedTaskExclusions((prev) => { const next = new Set(prev); next.delete(task.id); return next })}
                      className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    >Hide</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {stores.map((s) => (
                      <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer p-1 rounded hover:bg-[var(--color-accent)]">
                        <input type="checkbox" checked={task.excludedStoreIds.includes(s.id)} onChange={() => toggleTaskExclusion(task.id, s.id)} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setExpandedTaskExclusions((prev) => new Set([...prev, task.id]))}
                  className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                >
                  {task.excludedStoreIds.length > 0 ? `Excluded from ${task.excludedStoreIds.length} store${task.excludedStoreIds.length !== 1 ? "s" : ""}` : "Exclude from stores ▾"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section manager (CHK-1) ─────────────────────────────────────────────────
// The section-level surface this form never had. Before CHK-1 a section could
// only be "renamed" by editing the same string on every task in it, which is
// not a rename at all — it is a new section that the old one's history does not
// follow. Here the edit happens ONCE, on the section, and every task follows.
//
// The per-task section input is untouched and still does what it did: typing a
// name that exists moves the task into that section, typing a new one creates
// it. That is membership. This panel is identity and order.

interface SectionManagerProps {
  groups: SectionGroup[]
  renameSection: (from: string, to: string) => string | null
  moveSection: (name: string, direction: -1 | 1) => void
}

function SectionManager({ groups, renameSection, moveSection }: SectionManagerProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  // A blank-section group is not a section — it is the unfinished state the
  // Save button already refuses. It gets no row here.
  const named = groups.filter((g) => g.name)
  if (named.length === 0) return null

  function commit(from: string) {
    const to = draft.trim()
    setEditing(null)
    if (!to || to === from) return
    const err = renameSection(from, to)
    setError(err)
  }

  return (
    <div className="mb-4 border border-[var(--color-border)] rounded-md bg-[var(--color-muted)]/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--color-muted-foreground)]">Sections ({named.length})</p>
        {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
      </div>
      <div className="space-y-1">
        {named.map((g, i) => (
          <div key={g.name} className="flex items-center gap-2">
            <div className="flex flex-col shrink-0">
              <button
                type="button"
                aria-label={`Move section ${g.name} up`}
                disabled={i === 0}
                onClick={() => { setError(null); moveSection(g.name, -1) }}
                className="p-0.5 rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-30"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Move section ${g.name} down`}
                disabled={i === named.length - 1}
                onClick={() => { setError(null); moveSection(g.name, 1) }}
                className="p-0.5 rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-30"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            {editing === g.name ? (
              <Input
                autoFocus
                className="h-7 text-sm max-w-xs"
                aria-label={`Rename section ${g.name}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(g.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commit(g.name) }
                  if (e.key === "Escape") { e.preventDefault(); setEditing(null) }
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => { setError(null); setDraft(g.name); setEditing(g.name) }}
                className="flex items-center gap-1.5 text-sm text-left rounded px-1.5 py-0.5 hover:bg-[var(--color-accent)]"
              >
                <span className="font-medium text-[var(--color-foreground)]">§ {g.name}</span>
                <Pencil className="h-3 w-3 text-[var(--color-muted-foreground)]" />
              </button>
            )}
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {g.tasks.length} task{g.tasks.length !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)] mt-2">
        Renaming a section here renames it everywhere on this template. Checklists already
        completed keep the section names they were completed under.
      </p>
    </div>
  )
}

// ─── Table view ───────────────────────────────────────────────────────────────

type BulkField = "estimatedTimeMinutes" | "isCritical" | "requiresPhoto" | "requiresTemp" | "sectionName"

interface TaskTableViewProps {
  tasks: Task[]
  stores: Store[]
  updateTask: (id: string, patch: Partial<Task>, opts?: { regroup?: boolean }) => void
  toggleTaskExclusion: (taskId: string, storeId: string) => void
}

function TaskTableView({ tasks, stores, updateTask, toggleTaskExclusion }: TaskTableViewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkField, setBulkField] = useState<BulkField>("estimatedTimeMinutes")
  const [bulkMinutes, setBulkMinutes] = useState("5")
  const [bulkBool, setBulkBool] = useState<"on" | "off">("on")
  const [bulkSection, setBulkSection] = useState("")

  const sectionNames = [...new Set(tasks.map((t) => t.sectionName).filter(Boolean))]
  const hasExclusions = stores.length > 0
  const colCount = hasExclusions ? 10 : 9
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id))
  const someSelected = tasks.some((t) => selectedIds.has(t.id))

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(tasks.map((t) => t.id)))
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSection(sectionName: string) {
    const ids = tasks.filter((t) => t.sectionName === sectionName).map((t) => t.id)
    const all = ids.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)))
      return next
    })
  }

  function applyBulk() {
    let patch: Partial<Task>
    if (bulkField === "estimatedTimeMinutes") {
      patch = { estimatedTimeMinutes: bulkMinutes === "" ? null : Number(bulkMinutes) }
    } else if (bulkField === "sectionName") {
      if (!bulkSection.trim()) return
      patch = { sectionName: bulkSection.trim() }
    } else {
      patch = { [bulkField]: bulkBool === "on" }
    }
    // CHK-1: a bulk section set is a commit, so it regroups — otherwise moving
    // three scattered tasks into one section would leave that section
    // non-contiguous and render its heading more than once.
    const regroup = bulkField === "sectionName"
    selectedIds.forEach((id) => updateTask(id, patch, { regroup }))
  }

  // Enter / arrow keys move focus down or up the Est. min column, spreadsheet-style
  function estKeyNav(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const dir = e.key === "ArrowUp" ? -1 : 1
    const next = document.querySelector<HTMLInputElement>(`input[data-est-row="${idx + dir}"]`)
    if (next) { next.focus(); next.select() }
  }

  return (
    <div className="space-y-2">
      <datalist id="task-section-options">
        {sectionNames.map((s) => <option key={s} value={s} />)}
      </datalist>

      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-2 flex-wrap p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
          <span className="text-sm font-medium text-[var(--color-foreground)]">{selectedIds.size} selected</span>
          <span className="text-sm text-[var(--color-muted-foreground)]">Set</span>
          <Select value={bulkField} onValueChange={(v) => setBulkField(v as BulkField)}>
            <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="estimatedTimeMinutes">Est. min</SelectItem>
              <SelectItem value="isCritical">Critical</SelectItem>
              <SelectItem value="requiresPhoto">Photo</SelectItem>
              <SelectItem value="requiresTemp">Temp</SelectItem>
              <SelectItem value="sectionName">Section</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
          {bulkField === "estimatedTimeMinutes" ? (
            <Input type="number" min={0} step={0.5} className="h-8 w-20 text-sm" aria-label="Bulk estimated minutes" value={bulkMinutes} onChange={(e) => setBulkMinutes(e.target.value)} />
          ) : bulkField === "sectionName" ? (
            <Input list="task-section-options" className="h-8 w-40 text-sm" placeholder="Section name" aria-label="Bulk section name" value={bulkSection} onChange={(e) => setBulkSection(e.target.value)} />
          ) : (
            <Select value={bulkBool} onValueChange={(v) => setBulkBool(v as "on" | "off")}>
              <SelectTrigger className="h-8 w-20 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on">On</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={applyBulk} disabled={bulkField === "sectionName" && !bulkSection.trim()}>Apply</Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Clear selection</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/20 text-xs text-[var(--color-muted-foreground)]">
              <th className="px-2 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all tasks"
                  className="rounded"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-2 py-2 w-8 text-left font-medium">#</th>
              <th className="px-2 py-2 w-36 text-left font-medium">Section</th>
              <th className="px-2 py-2 text-left font-medium">Task</th>
              <th className="px-2 py-2 w-20 text-left font-medium">Est. min</th>
              <th className="px-2 py-2 w-14 text-center font-medium">Critical</th>
              <th className="px-2 py-2 w-14 text-center font-medium">Photo</th>
              <th className="px-2 py-2 w-14 text-center font-medium">Temp</th>
              {hasExclusions && <th className="px-2 py-2 w-24 text-center font-medium">Exclusions</th>}
              <th className="px-2 py-2 w-12 text-center font-medium">Video</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, idx) => {
              // CHK-1: this adjacency test is UNCHANGED and is now merely a
              // consequence. It used to be the SOURCE of section order and of
              // DEBT-36's double heading; the task array is kept grouped by
              // section (see `regroupTasks`), so "previous row has a different
              // section" now happens exactly once per section.
              const showSectionRow = idx === 0 || tasks[idx - 1].sectionName !== task.sectionName
              const sectionIds = tasks.filter((t) => t.sectionName === task.sectionName)
              const sectionAllSelected = sectionIds.every((t) => selectedIds.has(t.id))
              return (
                <Fragment key={task.id}>
                  {showSectionRow && (
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/30">
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          aria-label={`Select all tasks in ${task.sectionName || "untitled section"}`}
                          className="rounded"
                          checked={sectionAllSelected}
                          onChange={() => toggleSection(task.sectionName)}
                        />
                      </td>
                      <td colSpan={colCount - 1} className="px-2 py-1 text-xs font-medium text-[var(--color-muted-foreground)]">
                        § {task.sectionName || "General"}
                      </td>
                    </tr>
                  )}
                  <tr className={`border-b border-[var(--color-border)] last:border-b-0 ${selectedIds.has(task.id) ? "bg-[var(--color-accent)]/40" : task.isCritical ? "bg-[var(--color-destructive)]/5" : ""}`}>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        aria-label={`Select task ${idx + 1}`}
                        className="rounded"
                        checked={selectedIds.has(task.id)}
                        onChange={() => toggleRow(task.id)}
                      />
                    </td>
                    <td className="px-2 py-1 text-xs text-[var(--color-muted-foreground)]">{idx + 1}</td>
                    <td className="px-2 py-1">
                      <Input
                        list="task-section-options"
                        className="h-7 w-full min-w-[8rem] text-sm"
                        aria-label={`Section for task ${idx + 1}`}
                        value={task.sectionName}
                        onChange={(e) => updateTask(task.id, { sectionName: e.target.value })}
                        // DEBT-2b: trim on blur, not on change — trimming per keystroke
                        // makes a multi-word section name impossible to type.
                        // CHK-1: blur is also where the section change COMMITS, so
                        // this is where the task joins its new section's block.
                        onBlur={(e) => updateTask(task.id, { sectionName: e.target.value.trim() }, { regroup: true })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        className="h-7 w-full min-w-[16rem] text-sm"
                        aria-label={`Description for task ${idx + 1}`}
                        title={task.description}
                        value={task.description}
                        onChange={(e) => updateTask(task.id, { description: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        className="h-7 w-20 text-sm"
                        aria-label={`Estimated minutes for task ${idx + 1}`}
                        data-est-row={idx}
                        value={task.estimatedTimeMinutes ?? ""}
                        onChange={(e) => updateTask(task.id, { estimatedTimeMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                        onKeyDown={(e) => estKeyNav(e, idx)}
                      />
                    </td>
                    {(["isCritical", "requiresPhoto", "requiresTemp"] as const).map((field) => (
                      <td key={field} className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${field === "isCritical" ? "Critical" : field === "requiresPhoto" ? "Requires photo" : "Requires temp"}, task ${idx + 1}`}
                          className="rounded"
                          checked={task[field]}
                          onChange={(e) => updateTask(task.id, { [field]: e.target.checked })}
                        />
                      </td>
                    ))}
                    {hasExclusions && (
                      <td className="px-2 py-1 text-center">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                              {task.excludedStoreIds.length > 0 ? `${task.excludedStoreIds.length} excluded` : "None"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3" align="end">
                            <p className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">This task does not apply to:</p>
                            <div className="space-y-1">
                              {stores.map((s) => (
                                <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer p-1 rounded hover:bg-[var(--color-accent)]">
                                  <input type="checkbox" checked={task.excludedStoreIds.includes(s.id)} onChange={() => toggleTaskExclusion(task.id, s.id)} />
                                  {s.name}
                                </label>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>
                    )}
                    <td className="px-2 py-1 text-center">
                      {task.videoUrl ? (
                        <a href={task.videoUrl} target="_blank" rel="noopener noreferrer" aria-label={`Training video for task ${idx + 1}`} className="inline-flex p-1 rounded text-[var(--color-foreground)] hover:bg-[var(--color-accent)]">
                          <Play className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
                      )}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Order is read-only in table view — switch to Cards to drag-reorder. Press Enter or ↑/↓ in the Est. min column to move between rows. Changes are saved when you click Save Template.
      </p>
    </div>
  )
}

// ─── Main form ────────────────────────────────────────────────────────────────

export function TemplateForm({ initialData, stores = [] }: TemplateFormProps) {
  const router = useRouter()
  const isEdit = !!initialData
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/templates/${initialData!.id}`, { method: "DELETE" })
      router.push("/templates")
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  const [name, setName] = useState(initialData?.name ?? "")
  const [description, setDescription] = useState(initialData?.description ?? "")
  // TPL-1a: was `useState(initialData?.type ?? "")` — a pass-through with no
  // control, whose "" on create is what POST turned into "Mid-Shift". The form
  // now holds the CHOSEN TYPE'S ID and the API writes the name from it, so the
  // string column can never disagree with the row it came from.
  const [typeId, setTypeId] = useState(initialData?.typeId ?? "")
  const [templateTypes, setTemplateTypes] = useState<{ id: string; name: string; colorKey: string }[]>([])
  const [typesLoading, setTypesLoading] = useState(true)
  const [frequency, setFrequency] = useState(initialData?.frequency ?? "Daily")
  const [availType, setAvailType] = useState(initialData?.availabilityType ?? "StoreHours")
  // DEBT-1b: normalised on the way in, so a row written before the backfill
  // opens with a matching dropdown option (and correct offset labels) instead
  // of an empty required field, and cannot be re-persisted on save.
  const [phase, setPhase] = useState(normalizePhase(initialData?.operationalPhase) ?? "Before Opening")
  // DEBT-59: OPTIONAL and BLANK by default. Nothing reads these back — no
  // availability gate exists — so a template that never chose a window must not
  // carry one. `?? null`, never `?? 1`/`?? 2`: the old defaults were invented on
  // create AND RE-INVENTED every time a NULL row was opened for an unrelated
  // edit, so genuine blanks decayed into 1/2 one save at a time.
  // The columns were nullable from the init migration and every write path
  // (POST, PATCH's spread, import) already persisted null faithfully, so this
  // form was the only thing manufacturing a value.
  // DEBT-29's visible-and-labelled decision STANDS: hiding the inputs would not
  // stop the write, only stop the admin seeing it. Its other stated reason for
  // keeping the defaults — that emitting null would break CSV parity with files
  // already on disk — was wrong, and is measured wrong in
  // docs/prompts/DEBT-59_AUDIT.md §2.5: the export already writes "" for null
  // and the import already reads "" back as null, unchanged by this row.
  const [startOffset, setStartOffset] = useState<number | null>(initialData?.startOffsetHours ?? null)
  const [endOffset, setEndOffset] = useState<number | null>(initialData?.endOffsetHours ?? null)
  const [appliesTo, setAppliesTo] = useState(
    initialData?.storeAssignments?.length ? "selected" : "all"
  )
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    new Set(initialData?.storeAssignments?.map((a) => a.storeId) ?? [])
  )
  // CHK-4 close-out, 2026-08-10 — the clamp warning's subject. Derived on every
  // render rather than memoised: it is at most one store list × seven weekdays
  // of pure arithmetic, and this file holds no other useMemo to be consistent
  // with. APPLICABLE stores only, and it tracks the Applies-to radio live —
  // narrowing a template to one store that does not clamp should retract the
  // warning, which is only true if the same list drives both.
  const applicableStores = appliesTo === "selected" ? stores.filter((s) => selectedStoreIds.has(s.id)) : stores
  const clampedStores = clampingStores(applicableStores, {
    availabilityType: availType,
    operationalPhase: phase,
    startOffsetHours: startOffset,
    endOffsetHours: endOffset,
  })
  // CHK-1: REGROUPED ON LOAD. A template whose stored tasks interleave two
  // sections opens with each section's tasks gathered under one heading instead
  // of the section appearing twice — the defect, fixed where the operator can
  // see it happening rather than silently at save time.
  const [tasks, setTasks] = useState<Task[]>(() =>
    regroupTasks(
      (initialData?.tasks ?? []).map((t) => ({ ...t, excludedStoreIds: t.excludedStoreIds ?? [], videoUrl: t.videoUrl ?? "" }))
    )
  )
  // CHK-1: section NAME → Section id, the identity half. Order is not kept here
  // — it comes from the task array (see the block above `sectionGroupsOf`).
  // A name with no entry is a section this edit invented; POST/PATCH create it.
  // An entry whose name is no longer used by any task is simply not sent, and
  // survives here so that retyping the old name re-resolves to the same row.
  const [sectionIds, setSectionIds] = useState<Record<string, string>>(() =>
    Object.fromEntries((initialData?.sections ?? []).map((s) => [s.name, s.id]))
  )
  const [showAddTask, setShowAddTask] = useState(false)
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards")
  const [newTask, setNewTask] = useState(emptyTaskFields)
  const [expandedTaskExclusions, setExpandedTaskExclusions] = useState<Set<string>>(new Set())

  // Inline edit state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({ ...emptyTaskFields, estimatedTimeMinutes: 5 })

  // Attachment state for new-task form
  const [newAttachmentLabel, setNewAttachmentLabel] = useState("")
  const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null)
  const [newAttachmentError, setNewAttachmentError] = useState("")

  // Attachment state for inline edit form
  const [editAttachmentLabel, setEditAttachmentLabel] = useState("")
  const [editAttachmentFile, setEditAttachmentFile] = useState<File | null>(null)
  const [editAttachmentError, setEditAttachmentError] = useState("")
  const [editExistingAttachment, setEditExistingAttachment] = useState<TaskAttachment | null | undefined>(undefined)

  // TPL-1a: the org's template types, for the Type select. Fetched rather than
  // passed as a prop so /templates/new and /templates/[id]/edit stay unchanged
  // — the house "client component fetching data" pattern (CLAUDE.md § Common
  // Patterns). A template whose typeId is null (a CSV import, or a legacy
  // string the backfill could not match) opens with an empty select and cannot
  // be saved until a type is chosen; that is the intended prompt, not a bug.
  useEffect(() => {
    let cancelled = false
    fetch("/api/template-types")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return
        setTemplateTypes(Array.isArray(data) ? data : [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTypesLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // dnd-kit sensors — distance:8 prevents accidental drags on button clicks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setTasks((items) => {
        const oldIndex = items.findIndex((t) => t.id === active.id)
        const newIndex = items.findIndex((t) => t.id === over.id)
        // CHK-1: regrouped after the move, so a drag can reorder a task WITHIN
        // its section but cannot leave a section's tasks scattered. Dropping a
        // task across a section boundary returns it to its own block; changing
        // its section is what the section input is for. Without this the array
        // stops being a valid source of section order and the one-heading
        // invariant only holds until the first drag.
        return regroupTasks(arrayMove(items, oldIndex, newIndex))
      })
    }
  }

  // CHK-1: the two section-level operations. Both are expressed as moves on the
  // task array, because that array is the order (see `sectionGroupsOf`).
  //
  // Returns an error string for the caller to show, or null. A rename onto a
  // name another section already holds is REFUSED rather than merged: merging
  // two sections is a destructive thing to do by typo, and the API refuses it
  // for the same reason (api/templates/sections.ts).
  function renameSection(from: string, to: string): string | null {
    if (tasks.some((t) => t.sectionName.trim() === to)) {
      return `A section named "${to}" already exists on this template.`
    }
    setSectionIds((prev) => {
      const id = prev[from]
      if (!id) return prev
      const next = { ...prev }
      delete next[from]
      next[to] = id
      return next
    })
    setTasks((prev) => prev.map((t) => (t.sectionName.trim() === from ? { ...t, sectionName: to } : t)))
    return null
  }

  function moveSection(name: string, direction: -1 | 1) {
    setTasks((prev) => {
      const groups = sectionGroupsOf(prev)
      const i = groups.findIndex((g) => g.name === name)
      const j = i + direction
      if (i < 0 || j < 0 || j >= groups.length) return prev
      const reordered = [...groups]
      reordered[i] = groups[j]
      reordered[j] = groups[i]
      return reordered.flatMap((g) => g.tasks)
    })
  }

  function validateFile(file: File): string {
    if (!ALLOWED_MIME.includes(file.type)) return "Only PDF, JPG, and PNG files are allowed"
    if (file.size > MAX_FILE_BYTES) return "File must be 10 MB or smaller"
    return ""
  }

  function startEditTask(task: Task) {
    setEditingTaskId(task.id)
    setEditDraft({
      sectionName: task.sectionName,
      description: task.description,
      estimatedTimeMinutes: task.estimatedTimeMinutes ?? 5,
      requiresPhoto: task.requiresPhoto,
      requiresTemp: task.requiresTemp,
      isCritical: task.isCritical,
      excludedStoreIds: task.excludedStoreIds,
      videoUrl: task.videoUrl ?? "",
    })
    setEditExistingAttachment(task.attachment ?? null)
    setEditAttachmentLabel(task.attachment?.label ?? "")
    setEditAttachmentFile(null)
    setEditAttachmentError("")
  }

  async function saveEditTask(taskId: string) {
    if (editAttachmentFile) {
      const form = new FormData()
      form.append("file", editAttachmentFile)
      form.append("taskId", taskId)
      form.append("label", editAttachmentLabel || editAttachmentFile.name)
      const res = await fetch("/api/upload/task-attachment", { method: "POST", body: form })
      if (res.ok) {
        const att = await res.json() as TaskAttachment
        setTasks((prev) => regroupTasks(prev.map((t) => t.id !== taskId ? t : { ...t, ...editDraft, estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null, attachment: att })))
      } else {
        setEditAttachmentError("Upload failed. Please try again.")
        return
      }
    } else if (editExistingAttachment === null) {
      await fetch(`/api/upload/task-attachment/${taskId}`, { method: "DELETE" })
      setTasks((prev) => regroupTasks(prev.map((t) => t.id !== taskId ? t : { ...t, ...editDraft, estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null, attachment: null })))
    } else {
      // CHK-1: the edit drawer can change a task's section, so its save is a
      // commit like the row input's blur — regrouped for the same reason.
      setTasks((prev) => regroupTasks(prev.map((t) => t.id !== taskId ? t : { ...t, ...editDraft, estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null })))
    }
    setEditingTaskId(null)
  }

  const [pendingAttachments, setPendingAttachments] = useState<Record<string, { file: File; label: string }>>({})

  function addTask() {
    const localId = Math.random().toString(36)
    const task: Task = {
      id: localId,
      ...newTask,
      estimatedTimeMinutes: newTask.estimatedTimeMinutes || null,
      orderIndex: tasks.length,
    }
    // CHK-1: regrouped, so adding a task to a section that already exists puts
    // it at the end of THAT section rather than at the end of the list, where
    // it would have split the section in two.
    setTasks((p) => regroupTasks([...p, task]))
    if (newAttachmentFile) {
      setPendingAttachments((p) => ({ ...p, [localId]: { file: newAttachmentFile, label: newAttachmentLabel || newAttachmentFile.name } }))
    }
    setNewTask(emptyTaskFields)
    setNewAttachmentFile(null)
    setNewAttachmentLabel("")
    setNewAttachmentError("")
    setShowAddTask(false)
  }

  // CHK-1: `regroup` is passed by the callers that COMMIT a section change —
  // the row input's onBlur, the bulk-set, Add Task and the edit drawer's Save.
  // Not on every call: regrouping per keystroke would move the row out from
  // under the cursor mid-word, which is the same reason DEBT-2b trims on blur
  // rather than on change.
  const updateTask = (id: string, patch: Partial<Task>, opts?: { regroup?: boolean }) =>
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      return opts?.regroup ? regroupTasks(next) : next
    })

  function toggleTaskExclusion(taskId: string, storeId: string) {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t
      const ids = t.excludedStoreIds.includes(storeId)
        ? t.excludedStoreIds.filter((s) => s !== storeId)
        : [...t.excludedStoreIds, storeId]
      return { ...t, excludedStoreIds: ids }
    }))
  }

  function toggleNewTaskExclusion(storeId: string) {
    setNewTask((prev) => ({
      ...prev,
      excludedStoreIds: prev.excludedStoreIds.includes(storeId)
        ? prev.excludedStoreIds.filter((s) => s !== storeId)
        : [...prev.excludedStoreIds, storeId],
    }))
  }

  function toggleEditDraftExclusion(storeId: string) {
    setEditDraft((prev) => ({
      ...prev,
      excludedStoreIds: prev.excludedStoreIds.includes(storeId)
        ? prev.excludedStoreIds.filter((s) => s !== storeId)
        : [...prev.excludedStoreIds, storeId],
    }))
  }

  function removeTask(id: string) {
    setTasks((p) => p.filter((t) => t.id !== id))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        // TPL-1a: typeId, not type. The API writes the legacy string column
        // from the resolved row's name; the form does not send it at all, so
        // there is no path by which the two can drift apart.
        name, description, typeId, frequency,
        availabilityType: availType,
        operationalPhase: availType === "StoreHours" ? phase : null,
        startOffsetHours: availType === "StoreHours" ? startOffset : null,
        endOffsetHours: availType === "StoreHours" ? endOffset : null,
        appliesTo,
        storeIds: appliesTo === "selected" ? Array.from(selectedStoreIds) : [],
        // DEBT-2b: trim outbound so every form path — row input, bulk set, add
        // task, edit drawer — sends the same shape the API will store.
        tasks: tasks.map((t, i) => ({ ...t, sectionName: t.sectionName.trim(), orderIndex: i, estimatedTimeMinutes: t.estimatedTimeMinutes ?? null })),
        // CHK-1: the section list, WITH IDS. This is the field that makes a
        // rename a rename — without it the API can only resolve by name, and
        // an edited name is indistinguishable from a brand-new section. Order
        // is the task array's grouping, so `sortOrder` here and MIN(orderIndex)
        // on the tasks above are the same number by construction.
        sections: sectionGroupsOf(tasks)
          .filter((g) => g.name)
          .map((g, i) => ({ id: sectionIds[g.name] ?? null, name: g.name, sortOrder: i })),
      }

      const res = isEdit
        ? await fetch(`/api/templates/${initialData!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setSaveError(body?.error ?? "Failed to save template. Please try again.")
        return
      }

      if (Object.keys(pendingAttachments).length > 0) {
        const savedTemplate = await res.json() as { tasks: { id: string }[] }
        const localIds = tasks.map((t) => t.id)
        await Promise.all(
          Object.entries(pendingAttachments).map(([localId, { file, label }]) => {
            const idx = localIds.indexOf(localId)
            const realTaskId = savedTemplate.tasks[idx]?.id
            if (!realTaskId) return Promise.resolve()
            const form = new FormData()
            form.append("file", file)
            form.append("taskId", realTaskId)
            form.append("label", label)
            return fetch("/api/upload/task-attachment", { method: "POST", body: form })
          })
        )
      }

      router.push("/templates")
      router.refresh()
    } catch {
      setSaveError("Failed to save template. Please check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0)
  const sections = new Set(tasks.map((t) => t.sectionName)).size
  // DEBT-2b: the inline per-row section input had no guard, so a cleared cell
  // persisted "". addTask and saveEditTask each gate their own commit action on
  // a non-empty section; this row input's commit action is the form's Save, so
  // that is what gets gated — the same rule, applied at the matching level.
  const blankSectionCount = tasks.filter((t) => !t.sectionName.trim()).length
  const criticalCount = tasks.filter((t) => t.isCritical).length
  const photoCount = tasks.filter((t) => t.requiresPhoto).length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/templates" className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors">
            <ArrowLeft className="h-5 w-5 text-[var(--color-muted-foreground)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
              {isEdit ? "Edit Template" : "Create Template"}
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">Design a checklist template with tasks and time estimates</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saveError && <p className="text-sm text-[var(--color-destructive)]">{saveError}</p>}
          {blankSectionCount > 0 && (
            <p className="text-sm text-[var(--color-destructive)]">
              {blankSectionCount === 1
                ? "One task needs a section name."
                : `${blankSectionCount} tasks need a section name.`}
            </p>
          )}
          {/* TPL-1a: the disabled Save gets a reason, same shape as the blank
              section message beside it. */}
          {!typeId && !typesLoading && templateTypes.length > 0 && (
            <p className="text-sm text-[var(--color-destructive)]">This template needs a type.</p>
          )}
          {isEdit && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this template?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the template and all its tasks. Any checklists already generated from this template will not be affected. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:bg-[var(--color-destructive)]/90"
                  >
                    {deleting ? "Deleting..." : "Yes, Delete Template"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button onClick={handleSave} disabled={saving || blankSectionCount > 0 || !typeId}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Template Info */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <h2 className="font-semibold text-[var(--color-foreground)] mb-4">Template Information</h2>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Checklist Name *</Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Morning Opening Checklist" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this checklist" rows={3} />
              </div>
              {/* TPL-1a: the control this form shipped without. The state and
                  the payload key were always here; only the input was missing,
                  which is why every template made through this page became a
                  "Mid-Shift" (docs/prompts/TYPE-1_AUDIT.md §6). Required, and
                  Save is disabled until it is answered — no fallback value is
                  invented anywhere. */}
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select value={typeId} onValueChange={setTypeId} disabled={typesLoading || templateTypes.length === 0}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={typesLoading ? "Loading types..." : "Select a type"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templateTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${badgePreset(t.colorKey).dot}`} />
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!typesLoading && templateTypes.length === 0 && (
                  <p className="text-xs text-[var(--color-destructive)]">
                    No template types exist for this organization yet. One must be created before a template can be saved.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>When should this checklist be generated? *</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Daily">Daily</SelectItem>
                    <SelectItem value="Weekly">Weekly</SelectItem>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--color-muted-foreground)]">Select how often this checklist should be automatically created</p>
              </div>
              <div className="space-y-1.5">
                {/* CHK-4, 2026-08-10 — PREPENDED, NOTHING BELOW IS EDITED. One
                    clause in the DEBT-29 note that follows is now FALSE and it
                    is left standing because it is the claim this note answers:
                    "no code path joins these values to StoreHours". One does, as
                    of CHK-3 — expectedWindow() in
                    src/lib/checklist-lifecycle.ts anchors the offsets to the
                    store's StoreHours row, and the day-close job and the store
                    view both read it.
                    WHAT DEBT-29 STILL HAS EXACTLY RIGHT, and it is the load-
                    bearing half: THE BOX STILL DOES NOT GATE VISIBILITY. The
                    join exists and it produces an EXPECTATION, never a filter —
                    Gary's R3, and DEBT-48's whole overdue-not-hidden argument.
                    So the sentence that must never appear here is unchanged; it
                    is only the reason it must not appear that moved, from "there
                    is no such code path" to "there is one and it deliberately
                    does not do that". */}
                {/* DEBT-29: this box describes when a checklist is MEANT to be run.
                    It does not gate visibility — no code path joins these values to
                    StoreHours, so the copy must not promise one. */}
                <Label>When is this checklist run? *</Label>
                <Select value={availType} onValueChange={setAvailType}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="StoreHours">Relative to Store Hours</SelectItem>
                    <SelectItem value="AllDay">All Day</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--color-muted-foreground)]">A label for staff — checklists stay visible all day.</p>
              </div>

              {availType === "StoreHours" && (
                <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-muted)]/20 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Operational Phase *</Label>
                    <Select value={phase} onValueChange={setPhase}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PHASES.map((p) => (<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-[var(--color-muted-foreground)]">Orders this checklist in the day and sets which shift hands off to it.</p>
                  </div>
                  {/* CHK-4, 2026-08-10 — PREPENDED, NOTHING BELOW IS EDITED.
                      The DEBT-59 block that follows is preserved per the
                      convention DEBT-59 and DEBT-36 follow. Its statements are
                      still TRUE: no ` *`, still optional, still nothing enforced
                      at save, "" still maps to null. What CHANGED is the reason
                      the fields exist — CHK-3 shipped the engine that reads them
                      and CHK-4 gives them a face, so they are now an EXPECTED
                      WINDOW (Gary's R3) rather than a value recorded for
                      reference. The (i) button beside this label is where that
                      is explained in plain words; the helper sentence at the
                      bottom of this box is the copy that retired. */}
                  {/* DEBT-59: no ` *` — these are optional, and nothing has ever
                      enforced them (handleSave's only guard is blankSectionCount).
                      `?? ""` renders blank, and the empty string maps back to null
                      rather than through Number(""), which is 0 — before this row
                      there was no way to express "blank" through this form at all. */}
                  <div className="flex items-center gap-1.5">
                    <Label>Expected window</Label>
                    {/* CHK-4 — THE (i) EXPLAINER (R3, plan §6.1). A Popover,
                        matching the store-exclusions affordance already in this
                        file, so this is the house pattern rather than a new
                        one. DEBT-29's visible-and-labelled decision is EXTENDED
                        here, not overturned: the fields stay on screen and gain
                        an explanation beside them. */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="What does the expected window do?"
                          className="inline-flex items-center justify-center h-5 w-5 rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-4 space-y-2" align="start">
                        <p className="text-sm font-semibold text-[var(--color-foreground)]">Expected window</p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          These hours describe when this checklist is <em>meant</em> to be done. They
                          never hide it — staff can always open and complete it.
                        </p>
                        <ul className="text-xs text-[var(--color-muted-foreground)] space-y-1 list-disc pl-4">
                          <li><strong>Before the start time</strong> it shows as <em>Upcoming</em>.</li>
                          <li><strong>After the end time</strong> it shows as <em>Overdue</em> — flagged, but still completable.</li>
                          <li>
                            <strong>At the end of the day</strong> (store close plus {DAY_CLOSE_GRACE_HOURS} hours)
                            an overdue checklist is recorded as <em>Missed</em>, and a completed one is recorded
                            as <em>completed late</em>.
                          </li>
                        </ul>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          Leave the end time blank and this checklist can never be overdue — it is only ever
                          completed, or missed at day close. Leave both blank for no expected window at all.
                        </p>
                        {/* Plan §3.5 / §12.10: the clamp is engine behaviour and
                            the explainer states it, so a window that quietly
                            shortens is never a surprise. */}
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          A window can never end after the day does. If the end time lands past day close, it is
                          treated as ending at day close — otherwise a checklist could be recorded as missed while
                          still inside its own window.
                        </p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          A store with no hours set closes its day at midnight plus {DAY_CLOSE_GRACE_HOURS} hours,
                          and has no expected window at all until its hours are filled in.
                        </p>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>{phase === "Before Opening" ? "Starts (hours before opening)" : phase === "During the Day" ? "Starts (hours after opening)" : "Starts (hours before closing)"}</Label>
                      <Input type="number" placeholder="Optional" value={startOffset ?? ""} onChange={(e) => setStartOffset(e.target.value === "" ? null : Number(e.target.value))} min={0} max={24} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{phase === "Before Opening" ? "Ends (hours after opening)" : phase === "During the Day" ? "Ends (hours before closing)" : "Ends (hours after closing)"}</Label>
                      <Input type="number" placeholder="Optional" value={endOffset ?? ""} onChange={(e) => setEndOffset(e.target.value === "" ? null : Number(e.target.value))} min={0} max={24} />
                    </div>
                  </div>

                  {/* CHK-4 CLOSE-OUT, 2026-08-10 — PREPENDED, NOTHING BELOW IS
                      EDITED. The block that follows is the claim this note
                      answers, and its arithmetic is still exactly right; what
                      changed is the premise underneath it.
                      MEASURED ON STAGING (2026-08-09, org
                      org_3G02wO4QlVVSWppi8aqlnSZnsDa / verified-snapper-7):
                      Carson open 07:00-17:00, so its day closed at 20:00 — and
                      a Before Opening template with Ends = 20 saved with NO
                      warning anywhere. Not a bug in the condition below: the
                      condition below cannot see it. `Before Opening` is one of
                      the two phases its own comment names as out of reach.
                      WHAT RETIRED IS THE PREMISE "This is a CLIENT component
                      with no store hours in it". That was true when it was
                      written and is now false — templates/new/page.tsx and
                      templates/[id]/edit/page.tsx join `timezone` and `hours`
                      onto the store list this form already received. Once the
                      hours are here the store-independent shortcut is no longer
                      the only thing available, and the per-store question is
                      the one the operator actually has.
                      SO THE GATE IS NOW `clampingStores`, which asks
                      src/lib/checklist-lifecycle.ts — the engine that does the
                      clamping — whether it would clamp, for each applicable
                      store, on any weekday. That subsumes the After Closing
                      case rather than dropping it: an end offset past the grace
                      buffer clamps at every store with hours, so the condition
                      below fires as part of the general one wherever there is a
                      store to fire about.
                      THE ONE DELIBERATE NARROWING: a template whose applicable
                      stores have NO hours now warns nothing, where the After
                      Closing shortcut warned unconditionally. Ruled that way in
                      this session's prompt and it is the honest reading — a
                      store with no hours has no expected window at all
                      (`expectedWindow` returns null), so there is no window to
                      cut short. The (i) explainer states the clamp
                      unconditionally and that is what covers it.
                      STILL NON-BLOCKING, unchanged and load-bearing: the value
                      saves exactly as typed. */}
                  {/* CHK-4 — THE WINDOW-CLAMP WARNING (plan §3.5, §12.10). The
                      clamp itself shipped with S3's engine; this is the sentence
                      that tells the operator it will fire.
                      NON-BLOCKING BY RULING — a warning, never an error. The
                      value saves exactly as typed and the engine clamps on read;
                      refusing the save would make an offset unexpressible, which
                      is the DEBT-59 mistake in a new place.
                      WHY ONLY "After Closing", stated so the gap is not read as
                      an oversight. This is a CLIENT component with no store
                      hours in it, so it can only warn where the arithmetic is
                      store-independent. After Closing ends at close + endOffset
                      and the day ends at close + GRACE, so the clamp fires for
                      every store the moment endOffset exceeds the buffer — no
                      store data needed. During the Day ends at close − endOffset
                      and can never reach day close. Before Opening ends at
                      open + endOffset, which only passes day close if endOffset
                      exceeds the store's whole open span plus the buffer — a
                      per-store fact this form cannot know, and inventing one
                      store's answer for a template that applies to all of them
                      would be worse than saying nothing. The explainer above
                      states the clamp unconditionally, which is what covers that
                      case. */}
                  {clampedStores.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning-text)]">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        This end time lands after the day closes at {storeListLabel(clampedStores)} — a store&rsquo;s
                        day ends {DAY_CLOSE_GRACE_HOURS} hours after it closes. There the window is treated as
                        ending at day close. Saving is fine — this is a heads-up, not an error.
                      </span>
                    </p>
                  )}
                  {/* DEBT-29: the Preview card that stood here computed concrete clock
                      times ("Store opens 8:00 AM → Available 07:00 AM - 10:00 AM") for a
                      window nothing enforces. No helper text makes a computed clock time
                      honest, so it was removed rather than reworded. */}
                  {/* CHK-4, 2026-08-10 — DEBT-59's COPY IS RETIRED HERE, AND ITS
                      PRESERVATION CLAUSE EXPIRED THE MOMENT THE SENTENCE BECAME
                      FALSE. Prepended, never edited: the DEBT-59 block below is
                      the claim this note answers, and rewriting it would leave
                      the answer without its question.
                      WHAT RETIRED: "Optional. Recorded for reference — not yet
                      used to show or hide checklists. Leave blank if no window
                      has been decided." That was earned honesty when nothing read
                      these columns. CHK-3 shipped the reader
                      (src/lib/checklist-lifecycle.ts) and this session shipped
                      the surfaces, so the sentence is now simply untrue — and a
                      copy change is earned by the phase that makes it true, which
                      is DEBT-59's own argument applied to DEBT-59's own sentence.
                      WHAT THE DEBT-59 BLOCK BELOW STILL GETS RIGHT, and why the
                      new sentence keeps its shape: blank is still not described
                      as "always available". Blank means NO EXPECTED WINDOW — the
                      checklist can never be overdue and is only ever completed,
                      or missed at day close. That is a statement about what the
                      engine does with a null, not a promise about visibility, and
                      R3 is explicit that a window never hides anything. */}
                  {/* DEBT-59: blank must not be described as "always available".
                      Nothing reads these fields, so promising a behaviour for the
                      empty case would re-introduce exactly the claim DEBT-29
                      stripped out of this box. */}
                  <p className="text-xs text-[var(--color-muted-foreground)]">Optional. Sets when this checklist is expected — it never hides it. Leave blank for no expected window.</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Applies to *</Label>
                <RadioGroup value={appliesTo} onValueChange={setAppliesTo}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="all" id="all" />
                    <label htmlFor="all" className="text-sm font-medium cursor-pointer">All stores (default)</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="selected" id="selected" />
                    <label htmlFor="selected" className="text-sm font-medium cursor-pointer">Selected stores</label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {appliesTo === "all" ? "This checklist will be visible to all stores" : "Choose specific stores below"}
                </p>
                {appliesTo === "selected" && stores.length > 0 && (
                  <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                    {stores.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-[var(--color-accent)]">
                        <input
                          type="checkbox"
                          checked={selectedStoreIds.has(s.id)}
                          onChange={() => {
                            setSelectedStoreIds((prev) => {
                              const next = new Set(prev)
                              next.has(s.id) ? next.delete(s.id) : next.add(s.id)
                              return next
                            })
                          }}
                          className="rounded"
                        />
                        {s.storeNumber ? `#${s.storeNumber} — ` : ""}{s.name}
                      </label>
                    ))}
                  </div>
                )}
                {appliesTo === "selected" && selectedStoreIds.size > 0 && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    This checklist will only be visible to {selectedStoreIds.size} selected store{selectedStoreIds.size !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Tasks */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[var(--color-foreground)]">Tasks ({tasks.length})</h2>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border border-[var(--color-border)] overflow-hidden" role="group" aria-label="Task view mode">
                  <button
                    type="button"
                    onClick={() => setViewMode("cards")}
                    aria-pressed={viewMode === "cards"}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "cards" ? "bg-[var(--color-accent)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/50"}`}
                  >
                    <LayoutList className="h-3.5 w-3.5" /> Cards
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("table")}
                    aria-pressed={viewMode === "table"}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-l border-[var(--color-border)] transition-colors ${viewMode === "table" ? "bg-[var(--color-accent)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/50"}`}
                  >
                    <Table2 className="h-3.5 w-3.5" /> Table
                  </button>
                </div>
                <Button size="sm" onClick={() => setShowAddTask(true)}>
                  <Plus className="h-4 w-4" />
                  Add Task
                </Button>
              </div>
            </div>

            {tasks.length === 0 && !showAddTask ? (
              <div className="text-center py-8 text-[var(--color-muted-foreground)]">
                <p className="text-sm">No tasks added yet</p>
                <p className="text-xs mt-1">Click &ldquo;Add Task&rdquo; to get started</p>
              </div>
            ) : (
              <>
                {/* CHK-1: section-level rename and reorder, above both views
                    because it acts on the sections rather than on the rows. */}
                <SectionManager
                  groups={sectionGroupsOf(tasks)}
                  renameSection={renameSection}
                  moveSection={moveSection}
                />
                {viewMode === "table" ? (
              <TaskTableView
                tasks={tasks}
                stores={stores}
                updateTask={updateTask}
                toggleTaskExclusion={toggleTaskExclusion}
              />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {tasks.map((task, idx) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        idx={idx}
                        editingTaskId={editingTaskId}
                        stores={stores}
                        expandedTaskExclusions={expandedTaskExclusions}
                        setExpandedTaskExclusions={setExpandedTaskExclusions}
                        editDraft={editDraft}
                        setEditDraft={setEditDraft}
                        editExistingAttachment={editExistingAttachment}
                        setEditExistingAttachment={setEditExistingAttachment}
                        editAttachmentLabel={editAttachmentLabel}
                        setEditAttachmentLabel={setEditAttachmentLabel}
                        editAttachmentFile={editAttachmentFile}
                        setEditAttachmentFile={setEditAttachmentFile}
                        editAttachmentError={editAttachmentError}
                        setEditAttachmentError={setEditAttachmentError}
                        validateFile={validateFile}
                        startEditTask={startEditTask}
                        saveEditTask={saveEditTask}
                        setEditingTaskId={setEditingTaskId}
                        removeTask={removeTask}
                        toggleTaskExclusion={toggleTaskExclusion}
                        toggleEditDraftExclusion={toggleEditDraftExclusion}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
                )}
              </>
            )}

            {showAddTask && (
              <div className="mt-4 p-4 border border-[var(--color-border)] rounded-md bg-[var(--color-background)] space-y-3">
                <h3 className="text-sm font-medium">New Task</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Section Name</Label>
                    <Input className="h-8 text-sm" placeholder="e.g. Restocking" value={newTask.sectionName} onChange={(e) => setNewTask((p) => ({ ...p, sectionName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Est. Time (min)</Label>
                    <Input className="h-8 text-sm" type="number" min={0} step={0.5} value={newTask.estimatedTimeMinutes} onChange={(e) => setNewTask((p) => ({ ...p, estimatedTimeMinutes: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Task Description</Label>
                  <Textarea className="text-sm" rows={2} placeholder="Describe the task..." value={newTask.description} onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Training Video URL (optional)</Label>
                  <Input className="h-8 text-sm" type="url" placeholder="https://..." value={newTask.videoUrl} onChange={(e) => setNewTask((p) => ({ ...p, videoUrl: e.target.value }))} />
                </div>
                {/* Attachment section — new task form */}
                <div className="space-y-2 border border-[var(--color-border)] rounded-md p-3 bg-[var(--color-muted)]/10">
                  <p className="text-xs font-medium text-[var(--color-foreground)]">Document / Image Attachment (optional)</p>
                  {newAttachmentFile ? (
                    <div className="flex items-center gap-2 text-xs bg-[var(--color-accent)] rounded px-2 py-1.5">
                      <FileText className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="flex-1 truncate">{newAttachmentFile.name} ({formatBytes(newAttachmentFile.size)})</span>
                      <button type="button" onClick={() => { setNewAttachmentFile(null); setNewAttachmentError("") }} className="ml-1 hover:text-[var(--color-destructive)]">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Input className="h-8 text-sm" placeholder="File Description Name" value={newAttachmentLabel} onChange={(e) => setNewAttachmentLabel(e.target.value)} />
                      <Input
                        className="h-8 text-sm"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null
                          if (!f) return
                          const err = validateFile(f)
                          if (err) { setNewAttachmentError(err); e.target.value = "" }
                          else { setNewAttachmentFile(f); setNewAttachmentError("") }
                        }}
                      />
                    </div>
                  )}
                  {newAttachmentError && <p className="text-xs text-[var(--color-destructive)]">{newAttachmentError}</p>}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={newTask.requiresPhoto} onChange={(e) => setNewTask((p) => ({ ...p, requiresPhoto: e.target.checked }))} className="rounded" />
                    Requires Photo
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={newTask.requiresTemp} onChange={(e) => setNewTask((p) => ({ ...p, requiresTemp: e.target.checked }))} className="rounded" />
                    Requires Temp
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={newTask.isCritical} onChange={(e) => setNewTask((p) => ({ ...p, isCritical: e.target.checked }))} className="rounded" />
                    Critical
                  </label>
                </div>
                {stores.length > 0 && (
                  <div className="p-3 bg-[var(--color-muted)]/20 rounded-md border border-[var(--color-border)]">
                    <p className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">This task does not apply to:</p>
                    <div className="grid grid-cols-2 gap-1">
                      {stores.map((s) => (
                        <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer p-1 rounded hover:bg-[var(--color-accent)]">
                          <input type="checkbox" checked={newTask.excludedStoreIds.includes(s.id)} onChange={() => toggleNewTaskExclusion(s.id)} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={addTask} disabled={!newTask.description || !newTask.sectionName}>Add Task</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddTask(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
            <h2 className="font-semibold text-[var(--color-foreground)] mb-4">Summary</h2>
            <div className="space-y-3">
              {[
                { label: "Total Tasks", value: tasks.length },
                { label: "Estimated Time", value: totalMinutes > 0 ? `${Math.floor(Math.round(totalMinutes) / 60) > 0 ? Math.floor(Math.round(totalMinutes) / 60) + "h " : ""}${Math.round(totalMinutes) % 60}m` : "0m" },
                { label: "Critical Tasks", value: criticalCount },
                { label: "Photo Requirements", value: photoCount },
                { label: "Sections", value: sections },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
                  <p className="text-xl font-bold text-[var(--color-foreground)]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
            <h2 className="font-semibold text-[var(--color-foreground)] mb-3">Tips</h2>
            <ul className="space-y-1.5 text-xs text-[var(--color-muted-foreground)]">
              <li>• Drag the ⠿ handle to reorder tasks</li>
              <li>• Group related tasks using section names</li>
              <li>• Mark critical tasks that require extra attention</li>
              <li>• Exclude tasks from specific locations as needed</li>
              <li>• Set realistic time estimates for each task</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
