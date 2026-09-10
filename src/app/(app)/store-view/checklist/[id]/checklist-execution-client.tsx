"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, AlertTriangle, Camera, Lock, Play, Printer, User } from "lucide-react"
import Link from "next/link"
import { groupTasksBySection } from "@/lib/sections"
import { checklistState, isCompletedLate } from "@/lib/checklist-lifecycle"
import { frozenWindow, formatWindowTime, COMPLETED_LATE_BADGE } from "@/lib/checklist-status-display"
import { HandoffBanner, HandoffComposer, type HandoffTarget } from "./handoff-notes"

// CHK-7 — iPhone capture, made sendable. ONE canvas re-encode answers two
// separate problems: (1) the iPhone default capture format is HEIC, which most
// DESKTOP browsers cannot render, so an admin reviewing the record could not
// open it; and (2) a raw phone photo is several MB against Vercel's ~4.5 MB
// request cap. Re-encoding to JPEG at a 1600px long edge puts a legible
// fridge-or-thermometer shot at roughly 200-400 KB, which clears both.
//
// DECODING is the platform's job, and iOS decodes HEIC natively — which is why
// the conversion happens on the phone rather than on the server, where it
// would need an image library the project does not carry. If decode or encode
// fails, this throws and the caller falls back to sending the original, which
// the route's allow-list accepts for exactly this case.
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.8

// Mirrors MAX_BYTES in src/app/api/upload/checklist-photo/route.ts. Checked
// here as well so an oversized file is refused with a sentence before it is
// put on the wire, rather than after a slow upload over store wifi.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

async function encodeToJpeg(source: CanvasImageSource, sw: number, sh: number): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("canvas unavailable")
  ctx.drawImage(source, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  )
  if (!blob) throw new Error("encode failed")
  return blob
}

async function downscaleToJpeg(file: File): Promise<Blob> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file)
    try {
      return await encodeToJpeg(bitmap, bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("decode failed"))
      el.src = url
    })
    // `return await` and not `return` — the finally below revokes the object
    // URL, and it must not run until the canvas has finished reading the image.
    return await encodeToJpeg(img, img.naturalWidth, img.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// The server's sentence, if it sent one. Every message this file shows a staff
// member comes from here or from a named local case — never a bare status code
// with no words around it.
async function readError(res: Response): Promise<string | null> {
  try {
    const data = await res.json()
    return typeof data?.error === "string" ? data.error : null
  } catch {
    return null
  }
}

interface TaskAttachment {
  id: string
  label: string
  url: string
  contentType: string
}

interface Task {
  id: string
  // CHK-1: `sectionName` is the LEGACY MIRROR and `section` is the entity.
  // Both are declared because both cross the server/client boundary; which one
  // is read is src/lib/sections.ts's decision, not this file's.
  sectionName: string
  sectionId: string | null
  section: { name: string; sortOrder: number } | null
  description: string
  estimatedTimeMinutes: number | null
  requiresPhoto: boolean
  requiresTemp: boolean
  isCritical: boolean
  orderIndex: number
  videoUrl: string | null
  attachment: TaskAttachment | null
}

interface TaskLog {
  taskId: string
  completedAt: Date
  photoUrl: string | null
  completedByStaffId: string | null
}

interface StaffMember {
  id: string
  displayName: string
}

interface Props {
  checklist: {
    id: string
    status: string
    storeId: string
    // CHK-4: the lifecycle columns CHK-3 wrote, read here for the first time.
    // `closedAt` is the closed fact (Missed); the two expectations are the
    // window THIS ROW was judged against — never recomputed from today's hours,
    // because this page renders past days too. The rule and its reasons are in
    // src/lib/checklist-status-display.ts.
    closedAt: Date | null
    completedLate: boolean
    expectedStartAt: Date | null
    expectedEndAt: Date | null
    date: Date
    // CHK-1: the frozen as-executed section names, or null for a checklist
    // started before this phase deployed. Prisma `Json?`, so `unknown` —
    // src/lib/sections.ts parses it and falls back to the live join.
    sectionsSnapshot: unknown
    // TPL-2 step (2): `type` is the LEGACY string and is kept here only as the
    // fallback for a template with no TemplateType. `templateType` is the truth.
    template: {
      name: string
      type: string
      templateType: { name: string } | null
      operationalPhase: string | null
      tasks: Task[]
    }
    store: { name: string; timezone: string }
    taskLogs: TaskLog[]
  }
  staff: StaffMember[]
  handoffTargets: HandoffTarget[]
}

export function ChecklistExecutionClient({ checklist, staff, handoffTargets }: Props) {
  const router = useRouter()
  const tasks = checklist.template.tasks

  const [completed, setCompleted] = useState<Set<string>>(
    () => new Set(checklist.taskLogs.map((l) => l.taskId))
  )
  // Map taskId → staffId who completed it
  const [staffMap, setStaffMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const log of checklist.taskLogs) {
      if (log.completedByStaffId) m[log.taskId] = log.completedByStaffId
    }
    return m
  })
  // Which task is showing the staff picker
  const [pickingStaffFor, setPickingStaffFor] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // CHK-7 — the photo a crew member shoots, keyed by task. A photo is an
  // ATTRIBUTE OF THE COMPLETION, not an event of its own: TaskLog.photoUrl is
  // a column on the log row. So the blob is uploaded on capture and its URL is
  // held here until the task is actually ticked, then written by the same
  // task-log request that records who did it. Seeded from the existing logs so
  // reopening a checklist shows the photos it was completed with.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const log of checklist.taskLogs) {
      if (log.photoUrl) m[log.taskId] = log.photoUrl
    }
    return m
  })
  const [photoBusy, setPhotoBusy] = useState<Set<string>>(new Set())

  // CHK-7 — THE VISIBLE FAILURE, per task. Silent refusal was half this bug:
  // logTask ended in `.catch(() => {})` and never read res.ok, so a 403, a
  // closed-day 409 or a dropped connection left the checkbox showing done and
  // nothing written to the record.
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})

  const setTaskError = useCallback((taskId: string, message: string | null) => {
    setTaskErrors((prev) => {
      if (message === null) {
        if (!(taskId in prev)) return prev
        const n = { ...prev }
        delete n[taskId]
        return n
      }
      return { ...prev, [taskId]: message }
    })
  }, [])

  // DEBT-2b: fall back to "General" for a blank section, matching the template
  // detail page, both print pages and the CSV import's default. This is DISPLAY
  // ONLY — the grouping key is derived here and never written back.
  //
  // CHK-1: the four-line reduce this replaces was one of six independent
  // derivations of the same thing; the "General" fallback it describes now
  // lives in src/lib/sections.ts and is shared with the other five, which is
  // the point of the helper. The snapshot is passed because THIS PAGE RENDERS A
  // RECORD as well as a live surface — reopening a completed checklist here
  // shows the headings it was executed under, agreeing with its print copy
  // instead of contradicting it.
  const sections = groupTasksBySection(tasks, checklist.sectionsSnapshot)

  // CHK-4. THE LIFECYCLE STATE OF THIS ROW, through the lib's predicates and
  // through nothing else. `now` is taken once per render rather than per
  // banner, so the header and the body cannot disagree.
  //
  // READ-ONLY IS NOT A UI OPINION — it MIRRORS a server refusal that already
  // exists. Both POST /api/checklists/[id]/task-log and .../submit return 409
  // when `closedAt` is set and the row is not Completed (CHK-3). Disabling the
  // checkboxes stops a crew member firing a request that was always going to be
  // rejected; it is not the enforcement, and removing it would not open a hole.
  const now = new Date()
  const window = frozenWindow(checklist)
  const state = checklistState(checklist, window, now)
  const isClosedFact = state === "missed"
  const expectedEndLabel = window?.end ? formatWindowTime(window.end, checklist.store.timezone) : null
  const closedOnLabel = checklist.closedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: checklist.store.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(checklist.closedAt)
    : null
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", // Checklist.date is UTC-midnight of the store-local day (src/lib/reports.ts dbDate).
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(checklist.date)

  const totalTasks = tasks.length
  const completedCount = completed.size
  const progress = totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0
  const totalMinutes = Math.round(tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0))

  // CHK-7: carries `photoUrl` — the reason that column existed on this route
  // and was never populated — and RETURNS WHETHER THE WRITE LANDED so callers
  // can put the screen back instead of showing a tick the record does not have.
  async function logTask(taskId: string, staffId?: string, photoUrl?: string | null): Promise<boolean> {
    let res: Response
    try {
      res = await fetch(`/api/checklists/${checklist.id}/task-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, completedByStaffId: staffId ?? null, photoUrl: photoUrl ?? null }),
      })
    } catch {
      setTaskError(taskId, "That did not save — no connection. Check the store's wifi and tap it again.")
      return false
    }
    if (!res.ok) {
      setTaskError(taskId, (await readError(res)) ?? `That did not save (error ${res.status}). Tap it again.`)
      return false
    }
    setTaskError(taskId, null)
    return true
  }

  // CHK-7 — CAPTURE. Downscale on the phone, upload, hold the URL. Every exit
  // that is not success puts a sentence on the task.
  async function handlePhoto(taskId: string, file: File | null | undefined) {
    if (!file) return
    setTaskError(taskId, null)
    setPhotoBusy((prev) => new Set([...prev, taskId]))
    try {
      let upload: Blob = file
      let filename = "photo.jpg"
      try {
        upload = await downscaleToJpeg(file)
      } catch {
        // The browser could not decode or re-encode this image. Send the
        // original rather than dropping the shot — the route accepts HEIC for
        // this case — and let its allow-list rule on it.
        upload = file
        filename = file.name || "photo"
      }
      if (upload.size > MAX_UPLOAD_BYTES) {
        setTaskError(taskId, "That photo is too large to send. Take it with the camera rather than attaching a full-size file.")
        return
      }

      const form = new FormData()
      form.append("file", new File([upload], filename, { type: upload.type || file.type }))
      form.append("checklistId", checklist.id)
      form.append("taskId", taskId)

      let res: Response
      try {
        res = await fetch("/api/upload/checklist-photo", { method: "POST", body: form })
      } catch {
        setTaskError(taskId, "The photo did not send — no connection. Check the store's wifi and try again.")
        return
      }
      if (!res.ok) {
        setTaskError(taskId, (await readError(res)) ?? `The photo did not send (error ${res.status}). Try again.`)
        return
      }
      const { url } = (await res.json()) as { url: string }
      setPhotoUrls((prev) => ({ ...prev, [taskId]: url }))
    } finally {
      setPhotoBusy((prev) => {
        const n = new Set(prev)
        n.delete(taskId)
        return n
      })
    }
  }

  const handleTaskClick = useCallback((taskId: string) => {
    // A closed day accepts nothing. The route would 409 anyway; refusing here
    // keeps the checkbox from flickering to done and back.
    if (isClosedFact) return
    if (completed.has(taskId)) {
      // Uncomplete: no staff picker needed
      const priorStaff = staffMap[taskId]
      setCompleted((prev) => { const n = new Set(prev); n.delete(taskId); return n })
      setStaffMap((prev) => { const n = { ...prev }; delete n[taskId]; return n })
      // CHK-7: on a refusal, put the row back the way the record has it.
      logTask(taskId).then((ok) => {
        if (ok) return
        setCompleted((prev) => new Set([...prev, taskId]))
        if (priorStaff) setStaffMap((prev) => ({ ...prev, [taskId]: priorStaff }))
      })
    } else {
      // Show staff picker (or complete directly if no staff)
      if (staff.length > 0) {
        setPickingStaffFor(taskId)
      } else {
        setCompleted((prev) => new Set([...prev, taskId]))
        logTask(taskId, undefined, photoUrls[taskId]).then((ok) => {
          if (!ok) setCompleted((prev) => { const n = new Set(prev); n.delete(taskId); return n })
        })
      }
    }
  }, [completed, staff, isClosedFact, staffMap, photoUrls])

  async function selectStaff(taskId: string, staffId: string) {
    setPickingStaffFor(null)
    setCompleted((prev) => new Set([...prev, taskId]))
    setStaffMap((prev) => ({ ...prev, [taskId]: staffId }))
    // CHK-7: the photo staged on this task rides along on the completion write.
    const ok = await logTask(taskId, staffId, photoUrls[taskId])
    if (!ok) {
      setCompleted((prev) => { const n = new Set(prev); n.delete(taskId); return n })
      setStaffMap((prev) => { const n = { ...prev }; delete n[taskId]; return n })
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await fetch(`/api/checklists/${checklist.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completedTaskIds: Array.from(completed) }),
      })
      router.push("/store-view")
    } finally {
      setSubmitting(false)
    }
  }

  const staffById = Object.fromEntries(staff.map((s) => [s.id, s.displayName]))

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[var(--color-card)] border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div className="flex items-start gap-3">
            <Link href="/store-view" className="mt-1 p-1 rounded hover:bg-[var(--color-accent)]">
              <ArrowLeft className="h-5 w-5 text-[var(--color-muted-foreground)]" />
            </Link>
            <div>
              <h1 className="font-bold text-[var(--color-foreground)] text-lg leading-tight">Daily Checklist</h1>
              <p className="text-sm text-[var(--color-muted-foreground)]">{checklist.store.name} • {checklist.template.templateType?.name ?? checklist.template.type}</p>
              {totalMinutes > 0 && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Estimated: {Math.floor(totalMinutes / 60) > 0 ? Math.floor(totalMinutes / 60) + "h " : ""}{totalMinutes % 60}min
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/print/checklist/${checklist.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium hover:bg-[var(--color-primary)]/5 transition-colors"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </a>
            <div className="bg-[var(--color-muted)] rounded-lg px-3 py-1.5 text-sm font-semibold text-[var(--color-foreground)] tabular-nums">
              {completedCount} / {totalTasks}
            </div>
          </div>
        </div>
        <div className="h-1 bg-[var(--color-muted)] mx-4 rounded-full overflow-hidden">
          <div className="h-full bg-[var(--color-primary)] transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Sections */}
      <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">
        {/* CHK-4 — THE LIFECYCLE BANNERS. Above the sections, above the handoff
            notes, because "this day is closed" changes what every control below
            it means. Three mutually exclusive states; `active` and `upcoming`
            say nothing, which is the point of R3 — an expectation is not an
            announcement. */}
        {isClosedFact && (
          <div className="border border-gray-300 bg-gray-100 rounded-lg p-4">
            <p className="flex items-center gap-2 font-semibold text-[var(--color-destructive)]">
              <Lock className="h-4 w-4 shrink-0" />
              Missed{closedOnLabel ? ` — the day closed ${closedOnLabel}` : ""}
            </p>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              This checklist is a closed record for {dayLabel} and can no longer be
              edited or submitted. It is kept so the day reads honestly.
            </p>
          </div>
        )}
        {state === "overdue" && (
          <div className="border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] rounded-lg p-4">
            <p className="flex items-center gap-2 font-semibold text-[var(--color-warning-text)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Overdue{expectedEndLabel ? ` — this checklist was expected by ${expectedEndLabel}` : ""}
            </p>
            {/* R3, verbatim in the copy: nothing is hidden and nothing is
                blocked. Every control below this banner stays live. */}
            <p className="text-sm text-[var(--color-warning-text)] mt-1">It can still be completed.</p>
          </div>
        )}
        {state === "completed" && isCompletedLate(checklist) && (
          <div className="border border-[var(--color-border)] bg-[var(--color-muted)]/40 rounded-lg px-4 py-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {COMPLETED_LATE_BADGE.label}
              {expectedEndLabel ? ` — finished after the ${expectedEndLabel} expectation.` : "."}{" "}
              Recorded as a fact, not a fault.
            </p>
          </div>
        )}

        {/* Handoff notes (I-14): what the last shift left for this checklist,
            plus the top copy of the next-shift composer. */}
        <HandoffBanner checklistId={checklist.id} />
        <HandoffComposer
          checklistId={checklist.id}
          targets={handoffTargets}
          sourcePhase={checklist.template.operationalPhase}
        />
        {sections.map((section) => {
          const sectionTasks = section.tasks
          const sectionCompleted = sectionTasks.filter((t) => completed.has(t.id)).length
          return (
            <div key={section.key} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <h2 className="font-semibold text-[var(--color-foreground)]">{section.name}</h2>
                <p className="text-sm text-[var(--color-muted-foreground)]">{sectionCompleted} of {sectionTasks.length} completed</p>
              </div>

              <div className="divide-y divide-[var(--color-border)]">
                {sectionTasks.map((task) => {
                  const isDone = completed.has(task.id)
                  const isPicking = pickingStaffFor === task.id
                  const isPhotoBusy = photoBusy.has(task.id)
                  const completedBy = staffMap[task.id] ? staffById[staffMap[task.id]] : null

                  return (
                    <div key={task.id} className={`px-4 py-3 transition-colors ${task.isCritical ? "bg-red-50/50" : ""}`}>
                      {/* Task row. CHK-4: on a closed day the row stops being a
                          control — no pointer, no button role, no tab stop —
                          rather than staying clickable and silently doing
                          nothing. */}
                      <div
                        className={`flex items-start gap-3 min-h-[44px] ${isClosedFact ? "cursor-default" : "cursor-pointer"} ${isDone ? "opacity-70" : ""}`}
                        onClick={() => !isPicking && handleTaskClick(task.id)}
                        role={isClosedFact ? undefined : "button"}
                        tabIndex={isClosedFact ? undefined : 0}
                        onKeyDown={(e) => e.key === "Enter" && !isPicking && handleTaskClick(task.id)}
                      >
                        <div className={`mt-0.5 w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                          isDone ? "bg-[var(--color-primary)] border-[var(--color-primary)]"
                          : task.isCritical ? "border-[var(--color-destructive)]"
                          : "border-[var(--color-border)]"
                        }`}>
                          {isDone && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm ${task.isCritical ? "text-[var(--color-destructive)] font-medium" : "text-[var(--color-foreground)]"} ${isDone ? "line-through" : ""}`}>
                              {task.description}
                            </span>
                            {task.estimatedTimeMinutes && (
                              <span className="inline-flex items-center text-xs bg-[var(--color-muted)] text-[var(--color-muted-foreground)] px-1.5 py-0.5 rounded">
                                ~{task.estimatedTimeMinutes} min
                              </span>
                            )}
                            {task.isCritical && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] px-2 py-0.5 rounded">
                                <AlertTriangle className="h-3 w-3" /> CRITICAL
                              </span>
                            )}
                          </div>
                          {isDone && completedBy && (
                            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 flex items-center gap-1">
                              <User className="h-3 w-3" /> {completedBy}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Training video link */}
                      {task.videoUrl && (
                        <div className="mt-2 ml-8">
                          <a
                            href={task.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 min-h-[44px] py-2 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors text-sm text-[var(--color-foreground)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Play className="w-4 h-4 shrink-0 text-[var(--color-primary)]" />
                            <span>Watch Training Video →</span>
                          </a>
                        </div>
                      )}

                      {/* Attachment link */}
                      {task.attachment && (
                        <div className="mt-2 ml-8">
                          {task.attachment.contentType.startsWith("image/") ? (
                            <a
                              href={task.attachment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 min-h-[44px] py-2 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors text-sm text-[var(--color-foreground)]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={task.attachment.url} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                              <span>{task.attachment.label} — View Image →</span>
                            </a>
                          ) : (
                            <a
                              href={task.attachment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 min-h-[44px] py-2 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors text-sm text-[var(--color-foreground)]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-base">📄</span>
                              <span>{task.attachment.label} — View Document →</span>
                            </a>
                          )}
                        </div>
                      )}

                      {/* Staff picker */}
                      {isPicking && (
                        <div className="mt-3 ml-8 border border-[var(--color-primary)]/30 rounded-lg bg-blue-50/50 p-3">
                          <p className="text-xs font-medium text-[var(--color-foreground)] mb-2 flex items-center gap-1">
                            <User className="h-3.5 w-3.5" /> Who completed this task?
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              onClick={() => selectStaff(task.id, "manager")}
                              className="text-sm py-2 px-3 bg-white border border-[var(--color-border)] rounded-md hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors text-left"
                            >
                              Team Member
                            </button>
                            <button
                              onClick={() => selectStaff(task.id, "manager")}
                              className="text-sm py-2 px-3 bg-white border border-[var(--color-border)] rounded-md hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors text-left"
                            >
                              Manager
                            </button>
                            {staff.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => selectStaff(task.id, s.id)}
                                className="text-sm py-2 px-3 bg-white border border-[var(--color-border)] rounded-md hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors text-left"
                              >
                                {s.displayName}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => setPickingStaffFor(null)}
                            className="mt-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] w-full text-center"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* CHK-7 — THE PHOTO. What stood here was a <button>
                          with no onClick, unchanged since the first commit: it
                          opened nothing, sent nothing, and told the staff
                          member nothing. The control is a <label> wrapping the
                          input so the tap target IS the file input — no ref
                          and no synthetic click to go wrong on iOS.
                          `capture="environment"` takes iPhone straight to the
                          rear camera; that forgoes the library picker, a
                          tradeoff named on the CHK-7 row. */}
                      {task.requiresPhoto && (photoUrls[task.id] || (!isDone && !isPicking && !isClosedFact)) && (
                        <div className="mt-2 ml-8" onClick={(e) => e.stopPropagation()}>
                          {photoUrls[task.id] && (
                            <a
                              href={photoUrls[task.id]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 min-h-[44px] py-2 px-3 mb-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors text-sm text-[var(--color-foreground)]"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={photoUrls[task.id]} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                              {/* The staged state says so plainly: the photo
                                  is not on the record until the task is
                                  ticked, and a crew member should not have to
                                  infer that. */}
                              <span>{isDone ? "Photo on this record" : "Photo ready — saves when you tick the task"}</span>
                            </a>
                          )}
                          {!isDone && !isPicking && !isClosedFact && (
                            <label
                              className={`flex w-fit items-center gap-1.5 min-h-[44px] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm px-3 py-1.5 rounded-md transition-opacity ${
                                isPhotoBusy ? "opacity-60" : "cursor-pointer hover:opacity-90"
                              }`}
                            >
                              <Camera className="h-4 w-4" />
                              {isPhotoBusy ? "Sending photo..." : photoUrls[task.id] ? "Retake Photo" : "Take Photo"}
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                disabled={isPhotoBusy}
                                className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  // Cleared so retaking the SAME file fires
                                  // change again.
                                  e.target.value = ""
                                  handlePhoto(task.id, file)
                                }}
                              />
                            </label>
                          )}
                        </div>
                      )}

                      {/* CHK-7 — the refusal, in words, at the task it
                          happened on. Whatever the server said. */}
                      {taskErrors[task.id] && (
                        <p className="mt-2 ml-8 text-sm text-[var(--color-warning-text)] bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] rounded-md px-3 py-2">
                          {taskErrors[task.id]}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Bottom copy of the composer — closers reach the end of a long list
            right when they think of tomorrow's note. */}
        <HandoffComposer
          checklistId={checklist.id}
          targets={handoffTargets}
          sourcePhase={checklist.template.operationalPhase}
        />
      </div>

      {/* Sticky submit bar. CHK-4: on a closed day it states the refusal rather
          than offering an action that would 409. */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
        <div className="max-w-2xl mx-auto">
          {isClosedFact ? (
            <p className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-[var(--color-muted-foreground)]">
              <Lock className="h-4 w-4" />
              Closed — recorded as Missed
            </p>
          ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-md text-sm font-medium transition-colors ${
              completedCount === totalTasks
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90"
                : "text-[var(--color-warning)] bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] hover:opacity-90"
            }`}
          >
            {completedCount < totalTasks && <AlertTriangle className="h-4 w-4" />}
            {submitting ? "Submitting..." : completedCount === totalTasks ? "Submit Checklist" : `Submit Partial (${completedCount}/${totalTasks} tasks)`}
          </button>
          )}
        </div>
      </div>
    </div>
  )
}
