"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ChevronDown, ChevronRight, GraduationCap, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// /staff/[id] Training tab (HR-7 manager side). Server page fetches and
// serializes; this component renders progress and drives the manage APIs.
// Attested capture (route B) is for login-less staff — the routing hint
// steers managers, the APIs allow both.

export type StaffTrainingLesson = {
  id: string
  title: string
  completedAt: string | null
  authMethod: string | null
}

export type StaffTrainingAttempt = {
  id: string
  scorePct: number | null
  status: string
  submittedAt: string
  authMethod: string
}

export type StaffTrainingAssignment = {
  id: string
  moduleTitle: string
  dueDate: string | null
  status: string
  hoursLogged: number | null
  certifiedAt: string | null
  trainerName: string | null
  assignedAt: string
  lessons: StaffTrainingLesson[]
  quiz: { passThreshold: number; questionCount: number } | null
  attempts: StaffTrainingAttempt[]
}

function statusBadge(a: StaffTrainingAssignment) {
  if (a.certifiedAt) return <Badge variant="success">Certified</Badge>
  if (a.status === "Completed") return <Badge variant="success">Completed</Badge>
  if (a.status === "InProgress") return <Badge variant="info">In progress</Badge>
  return <Badge variant="secondary">Not started</Badge>
}

function quizStatus(a: StaffTrainingAssignment): string {
  if (!a.quiz) return "No quiz"
  const passed = a.attempts.find((t) => t.status === "Passed")
  if (passed) return `Passed${passed.scorePct !== null ? ` · ${passed.scorePct}%` : ""}`
  if (a.attempts.some((t) => t.status === "PendingReview")) return "Pending review"
  if (a.attempts.length > 0) return `Failed (${a.attempts.length} attempt${a.attempts.length > 1 ? "s" : ""})`
  return "Not taken"
}

export function StaffTraining({
  staffId,
  staffActive,
  hasLogin,
  assignments,
  assignableModules,
  trainers,
}: {
  staffId: string
  staffActive: boolean
  hasLogin: boolean
  assignments: StaffTrainingAssignment[]
  assignableModules: { id: string; title: string }[]
  trainers: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Assign dialog state
  const [assignOpen, setAssignOpen] = useState(false)
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set())
  const [trainerUserId, setTrainerUserId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [assigning, setAssigning] = useState(false)

  // Quiz-result dialog state
  const [quizFor, setQuizFor] = useState<StaffTrainingAssignment | null>(null)
  const [score, setScore] = useState("")

  // Hours dialog state
  const [hoursFor, setHoursFor] = useState<StaffTrainingAssignment | null>(null)
  const [hours, setHours] = useState("")

  async function call(path: string, init: RequestInit, busyKey: string) {
    setBusy(busyKey)
    setError(null)
    try {
      const res = await fetch(path, init)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Request failed")
        return false
      }
      router.refresh()
      return true
    } finally {
      setBusy(null)
    }
  }

  async function handleAssign() {
    setAssigning(true)
    setError(null)
    try {
      const res = await fetch("/api/hr/training/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffMemberId: staffId,
          trainingModuleIds: [...selectedModules],
          trainerUserId: trainerUserId || null,
          dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to assign")
        return
      }
      setAssignOpen(false)
      setSelectedModules(new Set())
      setTrainerUserId("")
      setDueDate("")
      router.refresh()
    } finally {
      setAssigning(false)
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {hasLogin
            ? "This team member has a self-service login — lessons and quizzes are expected to be completed in their own portal. Attested capture below is the fallback."
            : "No self-service login — record completions here; they are captured as manager-attested."}
        </p>
        {staffActive && (
          <Button size="sm" onClick={() => setAssignOpen(true)} disabled={assignableModules.length === 0}>
            <Plus className="h-4 w-4 mr-1.5" />
            Assign
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

      {assignments.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
            <GraduationCap className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No training assigned</p>
          <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
            {assignableModules.length === 0
              ? "No active training modules apply to this team member's stores yet."
              : "Assign a module to start tracking lessons, quiz results, and certification."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const total = a.lessons.length
            const done = a.lessons.filter((l) => l.completedAt).length
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const isOpen = expanded.has(a.id)
            const noProgress = done === 0 && a.attempts.length === 0 && !a.certifiedAt
            const quizPassed = a.attempts.some((t) => t.status === "Passed")

            return (
              <div key={a.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
                <button
                  className="w-full flex items-center gap-3 p-4 text-left"
                  onClick={() => toggleExpanded(a.id)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[var(--color-foreground)]">{a.moduleTitle}</span>
                      {statusBadge(a)}
                    </div>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      {done}/{total} lessons · Quiz: {quizStatus(a)}
                      {a.hoursLogged !== null && ` · ${a.hoursLogged}h logged`}
                      {a.trainerName && ` · Trainer: ${a.trainerName}`}
                      {a.dueDate && ` · Due ${format(new Date(a.dueDate), "MMM d, yyyy")}`}
                    </p>
                  </div>
                  <div className="w-28 shrink-0">
                    <div className="h-2 rounded-full bg-[var(--color-muted)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-primary)] transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-right text-[var(--color-muted-foreground)] mt-0.5">{pct}%</p>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--color-border)] p-4 space-y-3">
                    <ul className="space-y-2">
                      {a.lessons.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                          <span
                            className={
                              l.completedAt
                                ? "text-[var(--color-muted-foreground)] line-through"
                                : "text-[var(--color-foreground)]"
                            }
                          >
                            {l.title}
                          </span>
                          {l.completedAt ? (
                            <span className="text-xs text-[var(--color-muted-foreground)]">
                              {format(new Date(l.completedAt), "MMM d")}
                              {l.authMethod === "ManagerAttested" && " · attested"}
                            </span>
                          ) : staffActive ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `${a.id}:${l.id}`}
                              onClick={() =>
                                call(
                                  `/api/hr/training/assignments/${a.id}/lessons/${l.id}`,
                                  { method: "POST" },
                                  `${a.id}:${l.id}`
                                )
                              }
                            >
                              {busy === `${a.id}:${l.id}` ? "Saving..." : "Mark complete"}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {staffActive && a.quiz && !quizPassed && (
                        <Button variant="outline" size="sm" onClick={() => { setQuizFor(a); setScore("") }}>
                          Record quiz result
                        </Button>
                      )}
                      {staffActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setHoursFor(a); setHours(a.hoursLogged?.toString() ?? "") }}
                        >
                          Log hours
                        </Button>
                      )}
                      {noProgress && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-[var(--color-destructive)]">
                              <Trash2 className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this assignment?</AlertDialogTitle>
                              <AlertDialogDescription>
                                “{a.moduleTitle}” has no progress yet, so it can be removed. Assignments with
                                any recorded progress are permanent records.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  call(`/api/hr/training/assignments/${a.id}`, { method: "DELETE" }, a.id)
                                }
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>

                    {a.attempts.length > 0 && (
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {a.attempts.map((t) => (
                          <p key={t.id}>
                            {format(new Date(t.submittedAt), "MMM d, yyyy h:mm a")} — {t.status}
                            {t.scorePct !== null && ` · ${t.scorePct}%`}
                            {t.authMethod === "ManagerAttested" && " · attested"}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign training</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Modules</Label>
              <div className="max-h-48 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                {assignableModules.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedModules.has(m.id)}
                      onChange={() =>
                        setSelectedModules((prev) => {
                          const next = new Set(prev)
                          next.has(m.id) ? next.delete(m.id) : next.add(m.id)
                          return next
                        })
                      }
                    />
                    {m.title}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Trainer (optional)</Label>
              <Select value={trainerUserId} onValueChange={setTrainerUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a trainer" />
                </SelectTrigger>
                <SelectContent>
                  {trainers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Due date (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assigning || selectedModules.size === 0}>
              {assigning ? "Assigning..." : `Assign ${selectedModules.size || ""}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attested quiz-result dialog */}
      <Dialog open={!!quizFor} onOpenChange={(open) => !open && setQuizFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record quiz result</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Enter the score for “{quizFor?.moduleTitle}”. Pass threshold is {quizFor?.quiz?.passThreshold}%.
            This is recorded as manager-attested.
          </p>
          <div className="space-y-1.5">
            <Label>Score %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuizFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={score === "" || busy === "quiz"}
              onClick={async () => {
                const ok = await call(
                  `/api/hr/training/assignments/${quizFor!.id}/quiz-result`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scorePct: Math.round(Number(score)) }),
                  },
                  "quiz"
                )
                if (ok) setQuizFor(null)
              }}
            >
              {busy === "quiz" ? "Saving..." : "Record result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log-hours dialog */}
      <Dialog open={!!hoursFor} onOpenChange={(open) => !open && setHoursFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log training hours</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Total hands-on training hours for “{hoursFor?.moduleTitle}”. Required before certification.
          </p>
          <div className="space-y-1.5">
            <Label>Hours</Label>
            <Input
              type="number"
              min={0}
              step={0.25}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoursFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={hours === "" || busy === "hours"}
              onClick={async () => {
                const ok = await call(
                  `/api/hr/training/assignments/${hoursFor!.id}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ hoursLogged: Number(hours) }),
                  },
                  "hours"
                )
                if (ok) setHoursFor(null)
              }}
            >
              {busy === "hours" ? "Saving..." : "Save hours"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
