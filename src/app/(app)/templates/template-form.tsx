"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle, Camera, Pencil, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

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

export function TemplateForm({ initialData, stores = [] }: TemplateFormProps) {
  const router = useRouter()
  const isEdit = !!initialData
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
  const [newTask, setNewTask] = useState(emptyTaskFields)
  const [expandedTaskExclusions, setExpandedTaskExclusions] = useState<Set<string>>(new Set())

  // Inline edit state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({
    ...emptyTaskFields,
    estimatedTimeMinutes: 5,
  })

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
  }

  function saveEditTask(taskId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              ...editDraft,
              estimatedTimeMinutes: editDraft.estimatedTimeMinutes || null,
            }
      )
    )
    setEditingTaskId(null)
  }

  function addTask() {
    const task: Task = {
      id: Math.random().toString(36),
      ...newTask,
      estimatedTimeMinutes: newTask.estimatedTimeMinutes || null,
      orderIndex: tasks.length,
    }
    setTasks((p) => [...p, task])
    setNewTask(emptyTaskFields)
    setShowAddTask(false)
  }

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
        tasks: tasks.map((t, i) => ({
          ...t,
          orderIndex: i,
          estimatedTimeMinutes: t.estimatedTimeMinutes ?? null,
        })),
      }

      const res = isEdit
        ? await fetch(`/api/templates/${initialData!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setSaveError(body?.error ?? "Failed to save template. Please try again.")
        return
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
          {saveError && (
            <p className="text-sm text-[var(--color-destructive)]">{saveError}</p>
          )}
          {isEdit && (
            <Button variant="destructive" size="sm">Delete</Button>
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
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Morning Opening Checklist"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this checklist"
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label>When should this checklist be generated? *</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
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
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
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
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PHASES.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-[var(--color-muted-foreground)]">When should this checklist be available?</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>
                        {phase === "Before Opening" ? "Starts (hours before opening)" : phase === "During the Day" ? "Starts (hours after opening)" : "Starts (hours before closing)"} *
                      </Label>
                      <Input type="number" value={startOffset} onChange={(e) => setStartOffset(Number(e.target.value))} min={0} max={24} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {phase === "Before Opening" ? "Ends (hours after opening)" : phase === "During the Day" ? "Ends (hours before closing)" : "Ends (hours after closing)"} *
                      </Label>
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
              <Button size="sm" onClick={() => setShowAddTask(true)}>
                <Plus className="h-4 w-4" />
                Add Task
              </Button>
            </div>

            {tasks.length === 0 && !showAddTask ? (
              <div className="text-center py-8 text-[var(--color-muted-foreground)]">
                <p className="text-sm">No tasks added yet</p>
                <p className="text-xs mt-1">Click &ldquo;Add Task&rdquo; to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, idx) => (
                  <div key={task.id} className={`rounded-md border ${task.isCritical ? "border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5" : "border-[var(--color-border)] bg-[var(--color-background)]"}`}>
                    {editingTaskId === task.id ? (
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
                                  <input
                                    type="checkbox"
                                    checked={editDraft.excludedStoreIds.includes(s.id)}
                                    onChange={() => toggleEditDraftExclusion(s.id)}
                                  />
                                  {s.storeNumber ? `#${s.storeNumber}` : s.name}
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
                        <div className="flex items-start gap-3">
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
                                <a
                                  href={task.videoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs bg-[var(--color-accent)] text-[var(--color-foreground)] border border-[var(--color-border)] px-1.5 py-0.5 rounded hover:bg-[var(--color-accent)]/80"
                                >
                                  <Play className="h-3 w-3" /> Video
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
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEditTask(task)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                              <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                            </button>
                            <button onClick={() => removeTask(task.id)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                              <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                            </button>
                          </div>
                        </div>
                        {stores.length > 0 && (
                          <div className="mt-2">
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
                                      <input
                                        type="checkbox"
                                        checked={task.excludedStoreIds.includes(s.id)}
                                        onChange={() => toggleTaskExclusion(task.id, s.id)}
                                      />
                                      {s.storeNumber ? `#${s.storeNumber}` : s.name}
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
                ))}
              </div>
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
                          <input
                            type="checkbox"
                            checked={newTask.excludedStoreIds.includes(s.id)}
                            onChange={() => toggleNewTaskExclusion(s.id)}
                          />
                          {s.storeNumber ? `#${s.storeNumber}` : s.name}
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

        {/* Sidebar: Summary + Tips */}
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
              <li>• Drag tasks to reorder them</li>
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
