"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileText, GripVertical, HelpCircle, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { DndContext, PointerSensor, useSensor, useSensors, DragEndEvent, closestCenter } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { uploadHrFileFromBrowser } from "@/lib/hr-upload-client"

export type QuizQuestion = {
  id: string
  type: "boolean" | "single" | "multi" | "written"
  prompt: string
  options?: { id: string; text: string }[]
  correctOptionIds?: string[]
}

interface LessonResource {
  id: string
  label: string
  contentType: string
  sizeBytes: number
}

interface Lesson {
  id: string
  title: string
  info: string
  videoUrl: string
  resources: LessonResource[]
}

interface PendingFile {
  file: File
  label: string
}

interface Store {
  id: string
  name: string
  storeNumber: string | null
}

interface TrainingFormProps {
  stores?: Store[]
  initialData?: {
    id: string
    title: string
    subject: string | null
    description: string | null
    appliesTo: string
    isActive: boolean
    lessons: {
      id: string
      title: string
      info: string | null
      videoUrl: string | null
      resources: LessonResource[]
    }[]
    quiz: { passThreshold: number; questions: QuizQuestion[] } | null
    storeAssignments: { storeId: string }[]
  }
}

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"]
const MAX_RESOURCES = 4
const UPLOAD_URL_ENDPOINT = "/api/hr/training/upload-url"

const QUESTION_TYPES = [
  { value: "boolean", label: "True / False" },
  { value: "single", label: "Single choice" },
  { value: "multi", label: "Multiple choice" },
  { value: "written", label: "Written answer" },
] as const

function localId() {
  return Math.random().toString(36)
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function validateFile(file: File): string {
  if (!ALLOWED_MIME.includes(file.type)) return "Only PDF, JPG, and PNG files are allowed"
  if (file.size > MAX_FILE_BYTES) return "File must be 10 MB or smaller"
  return ""
}

// Upload one file to the private training store and register it on a lesson.
async function uploadAndRegisterResource(
  lessonId: string,
  { file, label }: PendingFile
): Promise<LessonResource | null> {
  const uploaded = await uploadHrFileFromBrowser(file, UPLOAD_URL_ENDPOINT)
  if (!uploaded.ok) return null
  const res = await fetch(`/api/hr/training/lessons/${lessonId}/resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: uploaded.url, label }),
  })
  if (!res.ok) return null
  return (await res.json()) as LessonResource
}

// ─── Resource editor (shared by new-lesson and edit-lesson forms) ────────────

interface ResourceEditorProps {
  kept: LessonResource[]
  onRemoveKept: (id: string) => void
  pending: PendingFile[]
  setPending: React.Dispatch<React.SetStateAction<PendingFile[]>>
  label: string
  setLabel: (v: string) => void
  error: string
  setError: (v: string) => void
}

function ResourceEditor({ kept, onRemoveKept, pending, setPending, label, setLabel, error, setError }: ResourceEditorProps) {
  const total = kept.length + pending.length
  return (
    <div className="space-y-2 border border-[var(--color-border)] rounded-md p-3 bg-[var(--color-muted)]/10">
      <p className="text-xs font-medium text-[var(--color-foreground)]">
        Files ({total}/{MAX_RESOURCES}) — PDF, JPG, or PNG, 10 MB max
      </p>
      {kept.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-xs text-[var(--color-foreground)] bg-[var(--color-accent)] rounded px-2 py-1.5">
          <FileText className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          <span className="flex-1 truncate">{r.label} ({formatBytes(r.sizeBytes)})</span>
          <button type="button" onClick={() => onRemoveKept(r.id)} className="ml-1 hover:text-[var(--color-destructive)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {pending.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs bg-[var(--color-accent)] rounded px-2 py-1.5">
          <FileText className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          <span className="flex-1 truncate">{p.label} ({formatBytes(p.file.size)}) — uploads on save</span>
          <button type="button" onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-[var(--color-destructive)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {total < MAX_RESOURCES && (
        <div className="space-y-1.5">
          <Input className="h-8 text-sm" placeholder="File Description Name" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input
            className="h-8 text-sm"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              if (!f) return
              const err = validateFile(f)
              if (err) {
                setError(err)
              } else {
                setPending((prev) => [...prev, { file: f, label: label.trim() || f.name }])
                setLabel("")
                setError("")
              }
              e.target.value = ""
            }}
          />
        </div>
      )}
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}

// ─── Sortable lesson row ──────────────────────────────────────────────────────

interface SortableLessonRowProps {
  lesson: Lesson
  idx: number
  isEditing: boolean
  pendingCount: number
  editForm: React.ReactNode
  startEdit: (lesson: Lesson) => void
  removeLesson: (id: string) => void
}

function SortableLessonRow({ lesson, idx, isEditing, pendingCount, editForm, startEdit, removeLesson }: SortableLessonRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? "0 4px 12px rgba(0,0,0,0.15)" : undefined,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  }

  const fileCount = lesson.resources.length + pendingCount

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)]">
      {isEditing ? (
        <div className="p-4">{editForm}</div>
      ) : (
        <div className="p-3">
          <div className="flex items-start gap-2">
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
                <span className="text-sm font-medium text-[var(--color-foreground)]">{lesson.title}</span>
                {lesson.videoUrl && (
                  <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs bg-[var(--color-accent)] text-[var(--color-foreground)] border border-[var(--color-border)] px-1.5 py-0.5 rounded hover:bg-[var(--color-accent)]/80">
                    <Play className="h-3 w-3" /> Video
                  </a>
                )}
                {fileCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-accent)] text-[var(--color-foreground)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
                    <FileText className="h-3 w-3" /> {fileCount} file{fileCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {lesson.info && (
                <p className="text-sm mt-0.5 text-[var(--color-muted-foreground)] line-clamp-2 whitespace-pre-line">{lesson.info}</p>
              )}
              {lesson.resources.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  {lesson.resources.map((r) => (
                    <a
                      key={r.id}
                      href={`/api/hr/training/resources/${r.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] max-w-[160px]"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate underline decoration-dotted underline-offset-2">{r.label}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => startEdit(lesson)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              </button>
              <button onClick={() => removeLesson(lesson.id)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Quiz question editor ─────────────────────────────────────────────────────

interface QuestionCardProps {
  question: QuizQuestion
  idx: number
  update: (id: string, patch: Partial<QuizQuestion>) => void
  remove: (id: string) => void
}

function QuestionCard({ question: q, idx, update, remove }: QuestionCardProps) {
  function changeType(type: QuizQuestion["type"]) {
    if (type === "boolean") {
      update(q.id, { type, options: undefined, correctOptionIds: ["true"] })
    } else if (type === "written") {
      update(q.id, { type, options: undefined, correctOptionIds: undefined })
    } else {
      const options = q.options?.length ? q.options : [{ id: localId(), text: "" }, { id: localId(), text: "" }]
      // Single choice keeps at most one correct answer when switching from multi.
      const correct = (q.correctOptionIds ?? []).filter((cid) => options.some((o) => o.id === cid))
      update(q.id, { type, options, correctOptionIds: type === "single" ? correct.slice(0, 1) : correct })
    }
  }

  function toggleCorrect(optionId: string) {
    const current = q.correctOptionIds ?? []
    if (q.type === "single") {
      update(q.id, { correctOptionIds: [optionId] })
    } else {
      update(q.id, {
        correctOptionIds: current.includes(optionId)
          ? current.filter((cid) => cid !== optionId)
          : [...current, optionId],
      })
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--color-muted-foreground)]">Q{idx + 1}</span>
        <Select value={q.type} onValueChange={(v) => changeType(v as QuizQuestion["type"])}>
          <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QUESTION_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
          </SelectContent>
        </Select>
        <button onClick={() => remove(q.id)} className="ml-auto p-1 rounded hover:bg-[var(--color-accent)]">
          <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        </button>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Question</Label>
        <Textarea className="text-sm" rows={2} placeholder="e.g. How long can cut fruit sit out before it must be discarded?" value={q.prompt} onChange={(e) => update(q.id, { prompt: e.target.value })} />
      </div>

      {q.type === "boolean" && (
        <div className="space-y-1">
          <Label className="text-xs">Correct answer</Label>
          <RadioGroup value={q.correctOptionIds?.[0] ?? "true"} onValueChange={(v) => update(q.id, { correctOptionIds: [v] })}>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="true" id={`${q.id}-true`} />
                <label htmlFor={`${q.id}-true`} className="text-sm cursor-pointer">True</label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="false" id={`${q.id}-false`} />
                <label htmlFor={`${q.id}-false`} className="text-sm cursor-pointer">False</label>
              </div>
            </div>
          </RadioGroup>
        </div>
      )}

      {(q.type === "single" || q.type === "multi") && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            Options — {q.type === "single" ? "select the correct answer" : "check every correct answer"}
          </Label>
          {(q.options ?? []).map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <input
                type={q.type === "single" ? "radio" : "checkbox"}
                name={`correct-${q.id}`}
                className="rounded"
                checked={(q.correctOptionIds ?? []).includes(o.id)}
                onChange={() => toggleCorrect(o.id)}
              />
              <Input
                className="h-8 text-sm"
                placeholder="Option text"
                value={o.text}
                onChange={(e) =>
                  update(q.id, { options: (q.options ?? []).map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })
                }
              />
              <button
                onClick={() =>
                  update(q.id, {
                    options: (q.options ?? []).filter((x) => x.id !== o.id),
                    correctOptionIds: (q.correctOptionIds ?? []).filter((cid) => cid !== o.id),
                  })
                }
                className="p-1 rounded hover:bg-[var(--color-accent)] shrink-0"
              >
                <X className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => update(q.id, { options: [...(q.options ?? []), { id: localId(), text: "" }] })}>
            <Plus className="h-3.5 w-3.5" /> Add Option
          </Button>
        </div>
      )}

      {q.type === "written" && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Written answers have no answer key — a trainer reviews them manually.
        </p>
      )}
    </div>
  )
}

// ─── Main form ────────────────────────────────────────────────────────────────

export function TrainingForm({ initialData, stores = [] }: TrainingFormProps) {
  const router = useRouter()
  const isEdit = !!initialData
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [title, setTitle] = useState(initialData?.title ?? "")
  const [subject, setSubject] = useState(initialData?.subject ?? "")
  const [description, setDescription] = useState(initialData?.description ?? "")
  const [appliesTo, setAppliesTo] = useState(initialData?.storeAssignments?.length ? "selected" : "all")
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    new Set(initialData?.storeAssignments?.map((a) => a.storeId) ?? [])
  )
  const [lessons, setLessons] = useState<Lesson[]>(
    (initialData?.lessons ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      info: l.info ?? "",
      videoUrl: l.videoUrl ?? "",
      resources: l.resources,
    }))
  )
  // Lessons that exist server-side keep their cuid ids; anything else is a
  // local id whose resources wait in pendingResources until the module saves.
  const [serverLessonIds] = useState<Set<string>>(new Set(initialData?.lessons.map((l) => l.id) ?? []))
  const [pendingResources, setPendingResources] = useState<Record<string, PendingFile[]>>({})

  const [questions, setQuestions] = useState<QuizQuestion[]>(initialData?.quiz?.questions ?? [])
  const [passThreshold, setPassThreshold] = useState(initialData?.quiz?.passThreshold ?? 80)

  // New-lesson form state
  const [showAddLesson, setShowAddLesson] = useState(false)
  const [newLesson, setNewLesson] = useState({ title: "", info: "", videoUrl: "" })
  const [newFiles, setNewFiles] = useState<PendingFile[]>([])
  const [newFileLabel, setNewFileLabel] = useState("")
  const [newFileError, setNewFileError] = useState("")

  // Inline lesson edit state
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ title: "", info: "", videoUrl: "" })
  const [editKeptResources, setEditKeptResources] = useState<LessonResource[]>([])
  const [editNewFiles, setEditNewFiles] = useState<PendingFile[]>([])
  const [editFileLabel, setEditFileLabel] = useState("")
  const [editFileError, setEditFileError] = useState("")
  const [savingLesson, setSavingLesson] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setLessons((items) => {
        const oldIndex = items.findIndex((l) => l.id === active.id)
        const newIndex = items.findIndex((l) => l.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  function addLesson() {
    const id = localId()
    setLessons((p) => [...p, { id, ...newLesson, resources: [] }])
    if (newFiles.length) setPendingResources((p) => ({ ...p, [id]: newFiles }))
    setNewLesson({ title: "", info: "", videoUrl: "" })
    setNewFiles([])
    setNewFileLabel("")
    setNewFileError("")
    setShowAddLesson(false)
  }

  function removeLesson(id: string) {
    setLessons((p) => p.filter((l) => l.id !== id))
    setPendingResources((p) => {
      const { [id]: _, ...rest } = p
      return rest
    })
    if (editingLessonId === id) setEditingLessonId(null)
  }

  function startEditLesson(lesson: Lesson) {
    setEditingLessonId(lesson.id)
    setEditDraft({ title: lesson.title, info: lesson.info, videoUrl: lesson.videoUrl })
    setEditKeptResources(lesson.resources)
    setEditNewFiles(pendingResources[lesson.id] ?? [])
    setEditFileLabel("")
    setEditFileError("")
  }

  // Existing lessons apply resource changes immediately (the lesson id is
  // real); new lessons just update the pending map — their files upload after
  // the module saves (two-phase, templates pattern).
  async function saveEditLesson(lessonId: string) {
    const lesson = lessons.find((l) => l.id === lessonId)
    if (!lesson) return
    const isServerLesson = serverLessonIds.has(lessonId)

    if (!isServerLesson) {
      setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, ...editDraft } : l)))
      setPendingResources((p) => ({ ...p, [lessonId]: editNewFiles }))
      setEditingLessonId(null)
      return
    }

    setSavingLesson(true)
    try {
      const removed = lesson.resources.filter((r) => !editKeptResources.some((k) => k.id === r.id))
      await Promise.all(
        removed.map((r) => fetch(`/api/hr/training/resources/${r.id}`, { method: "DELETE" }))
      )

      const resources = [...editKeptResources]
      const failed: string[] = []
      for (const pending of editNewFiles) {
        const created = await uploadAndRegisterResource(lessonId, pending)
        if (created) resources.push(created)
        else failed.push(pending.label)
      }

      setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, ...editDraft, resources } : l)))

      if (failed.length) {
        setEditKeptResources(resources)
        setEditNewFiles(editNewFiles.filter((p) => failed.includes(p.label)))
        setEditFileError(`Upload failed for: ${failed.join(", ")}. Try again or remove the file.`)
        return
      }
      setEditingLessonId(null)
    } finally {
      setSavingLesson(false)
    }
  }

  // ── Quiz helpers ──
  const updateQuestion = (id: string, patch: Partial<QuizQuestion>) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))

  const removeQuestion = (id: string) => setQuestions((prev) => prev.filter((q) => q.id !== id))

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      {
        id: localId(),
        type: "single",
        prompt: "",
        options: [{ id: localId(), text: "" }, { id: localId(), text: "" }],
        correctOptionIds: [],
      },
    ])
  }

  // Validate + normalize questions for persistence. Returns an error string
  // or the cleaned array.
  function buildQuizPayload(): { error: string } | { quiz: { passThreshold: number; questions: QuizQuestion[] } | null } {
    if (!questions.length) return { quiz: null }
    const cleaned: QuizQuestion[] = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const prompt = q.prompt.trim()
      if (!prompt) return { error: `Question ${i + 1} needs a prompt` }
      if (q.type === "written") {
        cleaned.push({ id: q.id, type: q.type, prompt })
        continue
      }
      if (q.type === "boolean") {
        cleaned.push({ id: q.id, type: q.type, prompt, correctOptionIds: [q.correctOptionIds?.[0] ?? "true"] })
        continue
      }
      const options = (q.options ?? []).map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text)
      if (options.length < 2) return { error: `Question ${i + 1} needs at least 2 options` }
      const correct = (q.correctOptionIds ?? []).filter((cid) => options.some((o) => o.id === cid))
      if (!correct.length) return { error: `Question ${i + 1} needs a correct answer` }
      cleaned.push({ id: q.id, type: q.type, prompt, options, correctOptionIds: correct })
    }
    if (passThreshold < 0 || passThreshold > 100) return { error: "Pass threshold must be between 0 and 100" }
    return { quiz: { passThreshold, questions: cleaned } }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/hr/training/${initialData!.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setSaveError(body?.error ?? "Failed to delete module")
        return
      }
      router.push("/hr/training")
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const quizResult = buildQuizPayload()
      if ("error" in quizResult) {
        setSaveError(quizResult.error)
        return
      }

      const payload = {
        title,
        subject: subject || null,
        description: description || null,
        appliesTo,
        storeIds: appliesTo === "selected" ? Array.from(selectedStoreIds) : [],
        lessons: lessons.map((l, i) => ({
          ...(serverLessonIds.has(l.id) ? { id: l.id } : {}),
          title: l.title,
          info: l.info || null,
          videoUrl: l.videoUrl || null,
          orderIndex: i,
        })),
        quiz: quizResult.quiz,
      }

      const res = isEdit
        ? await fetch(`/api/hr/training/${initialData!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/hr/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setSaveError(body?.error ?? "Failed to save module. Please try again.")
        return
      }

      // Two-phase: the API returns lessons ordered by orderIndex (= our array
      // index), so map each new lesson's local id to its real id by position.
      const pendingEntries = Object.entries(pendingResources).filter(([lid, files]) =>
        files.length && lessons.some((l) => l.id === lid)
      )
      const failed: string[] = []
      if (pendingEntries.length) {
        const saved = (await res.json()) as { lessons: { id: string }[] }
        const localIds = lessons.map((l) => l.id)
        for (const [lid, files] of pendingEntries) {
          const realId = saved.lessons[localIds.indexOf(lid)]?.id
          if (!realId) {
            failed.push(...files.map((f) => f.label))
            continue
          }
          for (const pending of files) {
            const created = await uploadAndRegisterResource(realId, pending)
            if (!created) failed.push(pending.label)
          }
        }
      }
      if (failed.length) {
        alert(`The module was saved, but ${failed.length} file${failed.length !== 1 ? "s" : ""} failed to upload: ${failed.join(", ")}. Open the module and re-attach ${failed.length !== 1 ? "them" : "it"}.`)
      }

      router.push("/hr/training")
      router.refresh()
    } catch {
      setSaveError("Failed to save module. Please check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  const totalFiles =
    lessons.reduce((sum, l) => sum + l.resources.length, 0) +
    Object.entries(pendingResources)
      .filter(([lid]) => lessons.some((l) => l.id === lid))
      .reduce((sum, [, files]) => sum + files.length, 0)
  const videoCount = lessons.filter((l) => l.videoUrl).length

  const lessonEditForm = (lessonId: string) => (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Edit Lesson</h3>
      <div className="space-y-1">
        <Label className="text-xs">Lesson Title</Label>
        <Input className="h-8 text-sm" value={editDraft.title} onChange={(e) => setEditDraft((p) => ({ ...p, title: e.target.value }))} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Lesson Content</Label>
        <Textarea className="text-sm" rows={5} placeholder="The substance of the lesson — what the trainee needs to read and learn..." value={editDraft.info} onChange={(e) => setEditDraft((p) => ({ ...p, info: e.target.value }))} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Video URL (optional — YouTube, Vimeo, etc.)</Label>
        <Input className="h-8 text-sm" type="url" placeholder="https://..." value={editDraft.videoUrl} onChange={(e) => setEditDraft((p) => ({ ...p, videoUrl: e.target.value }))} />
      </div>
      <ResourceEditor
        kept={editKeptResources}
        onRemoveKept={(rid) => setEditKeptResources((prev) => prev.filter((r) => r.id !== rid))}
        pending={editNewFiles}
        setPending={setEditNewFiles}
        label={editFileLabel}
        setLabel={setEditFileLabel}
        error={editFileError}
        setError={setEditFileError}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => saveEditLesson(lessonId)} disabled={!editDraft.title || savingLesson}>
          {savingLesson ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditingLessonId(null)} disabled={savingLesson}>Cancel</Button>
      </div>
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/hr/training" className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors">
            <ArrowLeft className="h-5 w-5 text-[var(--color-muted-foreground)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
              {isEdit ? "Edit Training Module" : "Create Training Module"}
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">Build lessons with content, videos, and files, then add a quiz</p>
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
                  <AlertDialogTitle>Delete this module?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the module, its lessons, quiz, and file references. Modules with training records can&apos;t be deleted — archive those instead. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:bg-[var(--color-destructive)]/90"
                  >
                    {deleting ? "Deleting..." : "Yes, Delete Module"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Module"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Module Info */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <h2 className="font-semibold text-[var(--color-foreground)] mb-4">Module Information</h2>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Module Title *</Label>
                <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Food Safety Basics" />
              </div>
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g., Food Safety" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this module covers and who it's for" rows={3} />
              </div>
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
              </div>
            </div>
          </div>

          {/* Lessons */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[var(--color-foreground)]">Lessons ({lessons.length})</h2>
              <Button size="sm" onClick={() => setShowAddLesson(true)}>
                <Plus className="h-4 w-4" />
                Add Lesson
              </Button>
            </div>

            {lessons.length === 0 && !showAddLesson ? (
              <div className="text-center py-8 text-[var(--color-muted-foreground)]">
                <p className="text-sm">No lessons added yet</p>
                <p className="text-xs mt-1">Click &ldquo;Add Lesson&rdquo; to get started</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {lessons.map((lesson, idx) => (
                      <SortableLessonRow
                        key={lesson.id}
                        lesson={lesson}
                        idx={idx}
                        isEditing={editingLessonId === lesson.id}
                        pendingCount={(pendingResources[lesson.id] ?? []).length}
                        editForm={lessonEditForm(lesson.id)}
                        startEdit={startEditLesson}
                        removeLesson={removeLesson}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {showAddLesson && (
              <div className="mt-4 p-4 border border-[var(--color-border)] rounded-md bg-[var(--color-background)] space-y-3">
                <h3 className="text-sm font-medium">New Lesson</h3>
                <div className="space-y-1">
                  <Label className="text-xs">Lesson Title</Label>
                  <Input className="h-8 text-sm" placeholder="e.g. Handwashing & Hygiene" value={newLesson.title} onChange={(e) => setNewLesson((p) => ({ ...p, title: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Lesson Content</Label>
                  <Textarea className="text-sm" rows={5} placeholder="The substance of the lesson — what the trainee needs to read and learn..." value={newLesson.info} onChange={(e) => setNewLesson((p) => ({ ...p, info: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Video URL (optional — YouTube, Vimeo, etc.)</Label>
                  <Input className="h-8 text-sm" type="url" placeholder="https://..." value={newLesson.videoUrl} onChange={(e) => setNewLesson((p) => ({ ...p, videoUrl: e.target.value }))} />
                </div>
                <ResourceEditor
                  kept={[]}
                  onRemoveKept={() => {}}
                  pending={newFiles}
                  setPending={setNewFiles}
                  label={newFileLabel}
                  setLabel={setNewFileLabel}
                  error={newFileError}
                  setError={setNewFileError}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={addLesson} disabled={!newLesson.title}>Add Lesson</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddLesson(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Quiz */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-[var(--color-foreground)]">Quiz ({questions.length} question{questions.length !== 1 ? "s" : ""})</h2>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Trainees take the quiz after finishing the lessons (coming with assignments)</p>
              </div>
              <Button size="sm" onClick={addQuestion}>
                <Plus className="h-4 w-4" />
                Add Question
              </Button>
            </div>

            {questions.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-muted-foreground)]">
                <HelpCircle className="h-5 w-5 mx-auto mb-2" />
                <p className="text-sm">No quiz yet</p>
                <p className="text-xs mt-1">Add true/false, choice, or written questions</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Pass threshold</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 w-20 text-sm"
                    value={passThreshold}
                    onChange={(e) => setPassThreshold(Number(e.target.value))}
                  />
                  <span className="text-sm text-[var(--color-muted-foreground)]">
                    % — {questions.length > 0 ? `${Math.ceil((passThreshold / 100) * questions.length)} of ${questions.length} correct to pass` : ""}
                  </span>
                </div>
                {questions.map((q, idx) => (
                  <QuestionCard key={q.id} question={q} idx={idx} update={updateQuestion} remove={removeQuestion} />
                ))}
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
                { label: "Lessons", value: lessons.length },
                { label: "Video Links", value: videoCount },
                { label: "Files", value: totalFiles },
                { label: "Quiz Questions", value: questions.length },
                { label: "Pass Threshold", value: questions.length ? `${passThreshold}%` : "—" },
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
              <li>• Drag the ⠿ handle to reorder lessons</li>
              <li>• Videos are links (YouTube, Vimeo) — never uploaded</li>
              <li>• Each lesson holds up to 4 files (PDF, JPG, PNG, 10 MB)</li>
              <li>• Files are stored privately — only authorized users can open them</li>
              <li>• Written questions are reviewed by the trainer, not auto-graded</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
