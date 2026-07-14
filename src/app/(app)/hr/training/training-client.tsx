"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Archive, CheckCircle, Copy, GraduationCap, ListChecks, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TrainingImportButton } from "./training-import-button"
import { TrainingExportButton } from "./training-export-button"
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
  description: string | null
  appliesTo: string
  isActive: boolean
  isArchived: boolean
  lessons: TrainingLesson[]
  quizzes: TrainingQuiz[]
  storeAssignments: { storeId: string }[]
}

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

export default function TrainingClient() {
  const [modules, setModules] = useState<TrainingModule[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<"active" | "archived">("active")
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

  useEffect(() => { load() }, [])

  const visible = modules.filter((m) => (view === "archived" ? m.isArchived : !m.isArchived))

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
  async function duplicate(m: TrainingModule) {
    const quiz = m.quizzes[0]
    await fetch("/api/hr/training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${m.title} (Copy)`,
        subject: m.subject,
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
          <TrainingExportButton />
          <TrainingImportButton onImported={load} />
          <Link href="/hr/training/new">
            <Button>
              <Plus className="h-4 w-4" />
              Create Module
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        {(["active", "archived"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setView(tab); setSelected(new Set()) }}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === tab ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
          >
            {tab === "active" ? "Active" : "Archived"} ({modules.filter((m) => (tab === "archived" ? m.isArchived : !m.isArchived)).length})
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-[var(--color-muted)]/30 border border-[var(--color-border)]">
          <span className="text-sm font-medium text-[var(--color-foreground)]">{selected.size} modules selected</span>
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
        <div className="grid grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">
            {view === "archived" ? "No archived modules" : "No training modules yet"}
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
        </div>
      ) : (
        <>
          <div className="mb-3">
            <button onClick={toggleAll} className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              {allVisibleSelected ? "Clear" : "Select All"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {visible.map((m) => {
              const quiz = m.quizzes[0]
              return (
                <div key={m.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} />
                      <div className="w-6 h-6 rounded bg-[var(--color-primary)]/10 flex items-center justify-center">
                        <GraduationCap className="h-4 w-4 text-[var(--color-primary)]" />
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.isActive ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"}`}>
                      {m.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <h3 className="font-semibold text-[var(--color-foreground)] mb-2">{m.title}</h3>

                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    {m.subject && (
                      <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-foreground)]">
                        {m.subject}
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-foreground)]">
                      {m.appliesTo === "selected" ? `${m.storeAssignments.length} store${m.storeAssignments.length !== 1 ? "s" : ""}` : "All stores"}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--color-muted-foreground)] mb-3 flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" />
                    {m.lessons.length} lesson{m.lessons.length !== 1 ? "s" : ""}
                    {quiz ? ` · quiz (${(quiz.questions ?? []).length} questions, pass ${quiz.passThreshold}%)` : " · no quiz"}
                  </p>

                  <div className="flex items-center gap-1">
                    <Link href={`/hr/training/${m.id}/edit`}>
                      <button className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    </Link>
                    <button onClick={() => duplicate(m)} className="flex items-center gap-1 text-xs border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-accent)] transition-colors">
                      <Copy className="h-3 w-3" /> Duplicate
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
