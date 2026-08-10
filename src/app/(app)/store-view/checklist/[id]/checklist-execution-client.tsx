"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, AlertTriangle, Camera, Lock, Play, Printer, User } from "lucide-react"
import Link from "next/link"
import { groupTasksBySection } from "@/lib/sections"
import { checklistState, isCompletedLate } from "@/lib/checklist-lifecycle"
import { frozenWindow, formatWindowTime, COMPLETED_LATE_BADGE } from "@/lib/checklist-status-display"
import { HandoffBanner, HandoffComposer, type HandoffTarget } from "./handoff-notes"

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

  async function logTask(taskId: string, staffId?: string) {
    await fetch(`/api/checklists/${checklist.id}/task-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, completedByStaffId: staffId ?? null }),
    }).catch(() => {})
  }

  const handleTaskClick = useCallback((taskId: string) => {
    // A closed day accepts nothing. The route would 409 anyway; refusing here
    // keeps the checkbox from flickering to done and back.
    if (isClosedFact) return
    if (completed.has(taskId)) {
      // Uncomplete: no staff picker needed
      setCompleted((prev) => { const n = new Set(prev); n.delete(taskId); return n })
      setStaffMap((prev) => { const n = { ...prev }; delete n[taskId]; return n })
      logTask(taskId)
    } else {
      // Show staff picker (or complete directly if no staff)
      if (staff.length > 0) {
        setPickingStaffFor(taskId)
      } else {
        setCompleted((prev) => new Set([...prev, taskId]))
        logTask(taskId)
      }
    }
  }, [completed, staff, isClosedFact])

  async function selectStaff(taskId: string, staffId: string) {
    setPickingStaffFor(null)
    setCompleted((prev) => new Set([...prev, taskId]))
    setStaffMap((prev) => ({ ...prev, [taskId]: staffId }))
    await logTask(taskId, staffId)
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

                      {task.requiresPhoto && !isDone && !isPicking && !isClosedFact && (
                        <div className="mt-2 ml-8">
                          <button className="flex items-center gap-1.5 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity">
                            <Camera className="h-4 w-4" /> Take Photo
                          </button>
                        </div>
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
