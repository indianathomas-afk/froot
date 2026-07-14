"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"

// Per-lesson completion button for /my/training/[assignmentId]. Completing a
// lesson writes TrainingLessonProgress (ClerkSession) and refreshes so the
// progress bar advances.
export function LessonCompleteButton({
  assignmentId,
  lessonId,
}: {
  assignmentId: string
  lessonId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function complete() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/my/training/${assignmentId}/lessons/${lessonId}`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to save")
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        onClick={complete}
        disabled={busy}
        className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-medium disabled:opacity-60"
      >
        <CheckCircle2 className="h-4 w-4" />
        {busy ? "Saving..." : "Mark lesson complete"}
      </button>
      {error && <p className="text-xs text-[var(--color-destructive)] mt-1">{error}</p>}
    </div>
  )
}
