"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, AlertTriangle, Camera, User } from "lucide-react"
import Link from "next/link"

interface Task {
  id: string
  sectionName: string
  description: string
  estimatedTimeMinutes: number | null
  requiresPhoto: boolean
  requiresTemp: boolean
  isCritical: boolean
  orderIndex: number
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
    template: { name: string; type: string; tasks: Task[] }
    store: { name: string }
    taskLogs: TaskLog[]
  }
  staff: StaffMember[]
}

export function ChecklistExecutionClient({ checklist, staff }: Props) {
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

  const sections = tasks.reduce<Map<string, Task[]>>((acc, task) => {
    if (!acc.has(task.sectionName)) acc.set(task.sectionName, [])
    acc.get(task.sectionName)!.push(task)
    return acc
  }, new Map())

  const totalTasks = tasks.length
  const completedCount = completed.size
  const progress = totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0
  const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0)

  async function logTask(taskId: string, staffId?: string) {
    await fetch(`/api/checklists/${checklist.id}/task-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, completedByStaffId: staffId ?? null }),
    }).catch(() => {})
  }

  const handleTaskClick = useCallback((taskId: string) => {
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
  }, [completed, staff])

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
              <p className="text-sm text-[var(--color-muted-foreground)]">{checklist.store.name} • {checklist.template.type}</p>
              {totalMinutes > 0 && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Estimated: {Math.floor(totalMinutes / 60) > 0 ? Math.floor(totalMinutes / 60) + "h " : ""}{totalMinutes % 60}min
                </p>
              )}
            </div>
          </div>
          <div className="bg-[var(--color-muted)] rounded-lg px-3 py-1.5 text-sm font-semibold text-[var(--color-foreground)] tabular-nums">
            {completedCount} / {totalTasks}
          </div>
        </div>
        <div className="h-1 bg-[var(--color-muted)] mx-4 rounded-full overflow-hidden">
          <div className="h-full bg-[var(--color-primary)] transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Sections */}
      <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">
        {Array.from(sections.entries()).map(([sectionName, sectionTasks]) => {
          const sectionCompleted = sectionTasks.filter((t) => completed.has(t.id)).length
          return (
            <div key={sectionName} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <h2 className="font-semibold text-[var(--color-foreground)]">{sectionName}</h2>
                <p className="text-sm text-[var(--color-muted-foreground)]">{sectionCompleted} of {sectionTasks.length} completed</p>
              </div>

              <div className="divide-y divide-[var(--color-border)]">
                {sectionTasks.map((task) => {
                  const isDone = completed.has(task.id)
                  const isPicking = pickingStaffFor === task.id
                  const completedBy = staffMap[task.id] ? staffById[staffMap[task.id]] : null

                  return (
                    <div key={task.id} className={`px-4 py-3 transition-colors ${task.isCritical ? "bg-red-50/50" : ""}`}>
                      {/* Task row */}
                      <div
                        className={`flex items-start gap-3 cursor-pointer min-h-[44px] ${isDone ? "opacity-70" : ""}`}
                        onClick={() => !isPicking && handleTaskClick(task.id)}
                        role="button"
                        tabIndex={0}
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

                      {task.requiresPhoto && !isDone && !isPicking && (
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
      </div>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
        <div className="max-w-2xl mx-auto">
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
        </div>
      </div>
    </div>
  )
}
