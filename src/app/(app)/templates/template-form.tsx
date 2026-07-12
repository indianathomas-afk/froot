"use client"

import { Fragment, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle, Camera, Pencil, Play, FileText, X, GripVertical, LayoutList, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
}

interface TemplateFormProps {
  stores?: Store[]
  initialData?: {
    id: string
    name: string
    description: string | null
    type: string
    frequency: string
    availabilityType: string
    operationalPhase: string | null
    startOffsetHours: number | null
    endOffsetHours: number | null
    appliesTo?: string
    tasks: Task[]
    storeAssignments?: { storeId: string }[]
  }
}

const PHASES = [
  { value: "Before Opening", label: "Before Opening" },
  { value: "During the Day", label: "During the Day" },
  { value: "After Closing", label: "After Closing" },
]

function getPhaseDescription(phase: string | null, start: number, end: number, availType: string) {
  if (availType === "AllDay") return "Available all day"
  if (!phase) return ""
  if (phase === "Before Opening") return `Available ${start}h before opening until ${end}h after opening`
  if (phase === "During the Day") return `Available ${start}h after opening until ${end}h before closing`
  if (phase === "After Closing") return `Available ${start}h before closing until ${end}h after closing`
  return ""
}

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

// ─── Table view ───────────────────────────────────────────────────────────────

type BulkField = "estimatedTimeMinutes" | "isCritical" | "requiresPhoto" | "requiresTemp" | "sectionName"

interface TaskTableViewProps {
  tasks: Task[]
  stores: Store[]
  updateTask: (id: string, patch: Partial<Task>) => void
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
    selectedIds.forEach((id) => updateTask(id, patch))
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
                        § {task.sectionName || "No section"}
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
  const [type, setType] = useState(initialData?.type ?? "")
  const [frequency, setFrequency] = useState(initialData?.frequency ?? "Daily")
  const [availType, setAvailType] = useState(initialData?.availabilityType ?? "StoreHours")
  const [phase, setPhase] = useState(initialData?.operationalPhase ?? "Before Opening")
  const [startOffset, setStartOffset] = useState(initialData?.startOffsetHours ?? 1)
  const [endOffset, setEndOffset] = useState(initialData?.endOffsetHours ?? 2)
  const [appliesTo, setAppliesTo] = useState(
    initialData?.storeAssignments?.length ? "selected" : "all"
  )
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    new Set(initialData?.storeAssignments?.map((a) => a.storeId) ?? [])
  )
  const [tasks, setTasks] = useState<Task[]>(
    (initialData?.tasks ?? []).map((t) => ({ ...t, excludedStoreIds: t.excludedStoreIds ?? [], videoUrl: t.videoUrl ?? "" }))
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

  // dnd-kit sensors — distance:8 prevents accidental drags on button clicks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setTasks((items) => {
        const oldIndex = items.findIndex((t) => t.id === active.id)
        const newIndex = items.findIndex((t) => t.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
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
        setTasks((prev) => prev.map((t) => t.id !== taskId ? t : { ...t, ...editDraft, estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null, attachment: att }))
      } else {
        setEditAttachmentError("Upload failed. Please try again.")
        return
      }
    } else if (editExistingAttachment === null) {
      await fetch(`/api/upload/task-attachment/${taskId}`, { method: "DELETE" })
      setTasks((prev) => prev.map((t) => t.id !== taskId ? t : { ...t, ...editDraft, estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null, attachment: null }))
    } else {
      setTasks((prev) => prev.map((t) => t.id !== taskId ? t : { ...t, ...editDraft, estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null }))
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
    setTasks((p) => [...p, task])
    if (newAttachmentFile) {
      setPendingAttachments((p) => ({ ...p, [localId]: { file: newAttachmentFile, label: newAttachmentLabel || newAttachmentFile.name } }))
    }
    setNewTask(emptyTaskFields)
    setNewAttachmentFile(null)
    setNewAttachmentLabel("")
    setNewAttachmentError("")
    setShowAddTask(false)
  }

  const updateTask = (id: string, patch: Partial<Task>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

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
        name, description, type, frequency,
        availabilityType: availType,
        operationalPhase: availType === "StoreHours" ? phase : null,
        startOffsetHours: availType === "StoreHours" ? startOffset : null,
        endOffsetHours: availType === "StoreHours" ? endOffset : null,
        appliesTo,
        storeIds: appliesTo === "selected" ? Array.from(selectedStoreIds) : [],
        tasks: tasks.map((t, i) => ({ ...t, orderIndex: i, estimatedTimeMinutes: t.estimatedTimeMinutes ?? null })),
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
          <Button onClick={handleSave} disabled={saving}>
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
                <Label>When is this checklist available? *</Label>
                <Select value={availType} onValueChange={setAvailType}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="StoreHours">Relative to Store Hours</SelectItem>
                    <SelectItem value="AllDay">All Day</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--color-muted-foreground)]">Availability calculated based on each store&apos;s operating hours</p>
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
                    <p className="text-xs text-[var(--color-muted-foreground)]">When should this checklist be available?</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>{phase === "Before Opening" ? "Starts (hours before opening)" : phase === "During the Day" ? "Starts (hours after opening)" : "Starts (hours before closing)"} *</Label>
                      <Input type="number" value={startOffset} onChange={(e) => setStartOffset(Number(e.target.value))} min={0} max={24} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{phase === "Before Opening" ? "Ends (hours after opening)" : phase === "During the Day" ? "Ends (hours before closing)" : "Ends (hours after closing)"} *</Label>
                      <Input type="number" value={endOffset} onChange={(e) => setEndOffset(Number(e.target.value))} min={0} max={24} />
                    </div>
                  </div>
                  <div className="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 rounded-md p-3 text-sm">
                    <p className="font-medium text-[var(--color-foreground)] mb-1">Preview:</p>
                    <p className="text-[var(--color-muted-foreground)]">{getPhaseDescription(phase, startOffset, endOffset, availType)}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                      {phase === "Before Opening"
                        ? `Example: Store opens 8:00 AM → Available ${String(8 - startOffset).padStart(2, "0")}:00 AM - ${String(8 + endOffset).padStart(2, "0")}:00 AM`
                        : phase === "During the Day"
                        ? `Example: Store opens 8:00 AM, closes 8:00 PM → Available ${String(8 + startOffset).padStart(2, "0")}:00 AM - ${String(20 - endOffset).padStart(2, "0")}:00 PM`
                        : `Example: Store closes 8:00 PM → Available ${String(20 - startOffset).padStart(2, "0")}:00 PM - ${String(20 + endOffset).padStart(2, "0")}:00 PM`}
                    </p>
                  </div>
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
            ) : viewMode === "table" ? (
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
