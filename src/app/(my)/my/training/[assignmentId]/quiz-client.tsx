"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

// Quiz taking for /my/training/[assignmentId]. The server page strips
// correctOptionIds before these props are serialized — answers never reach
// the client. Grading happens server-side in POST /api/my/training/.../quiz.
export type MyQuizQuestion = {
  id: string
  type: "boolean" | "single" | "multi" | "written"
  prompt: string
  options?: { id: string; text: string }[]
}

export function QuizClient({
  assignmentId,
  passThreshold,
  questions,
}: {
  assignmentId: string
  passThreshold: number
  questions: MyQuizQuestion[]
}) {
  const router = useRouter()
  const [started, setStarted] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ attemptStatus: string; scorePct: number | null } | null>(null)

  function setAnswer(id: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  function toggleMulti(id: string, optionId: string) {
    setAnswers((prev) => {
      const cur = new Set(Array.isArray(prev[id]) ? (prev[id] as string[]) : [])
      cur.has(optionId) ? cur.delete(optionId) : cur.add(optionId)
      return { ...prev, [id]: [...cur] }
    })
  }

  const allAnswered = questions.every((q) => {
    const a = answers[q.id]
    if (a === undefined) return false
    if (typeof a === "string") return a.trim() !== ""
    return a.length > 0
  })

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/my/training/${assignmentId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? "Failed to submit")
        return
      }
      setResult({ attemptStatus: data.attemptStatus, scorePct: data.scorePct })
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 text-center">
        {result.attemptStatus === "Passed" ? (
          <>
            <p className="text-lg font-semibold text-[var(--color-success,#25ba3b)] mb-1">
              Passed{result.scorePct !== null && ` — ${result.scorePct}%`}
            </p>
            <p className="text-sm text-[var(--color-muted-foreground)]">Nice work. Quiz complete.</p>
          </>
        ) : result.attemptStatus === "PendingReview" ? (
          <>
            <p className="text-lg font-semibold text-[var(--color-foreground)] mb-1">Submitted for review</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Your written answers need a trainer&apos;s review — you&apos;ll see the result here once
              it&apos;s graded.
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-[var(--color-destructive)] mb-1">
              Not passed{result.scorePct !== null && ` — ${result.scorePct}%`}
            </p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              You need {passThreshold}% to pass. Review the lessons and try again.
            </p>
            <Button className="mt-3" variant="outline" onClick={() => { setResult(null); setAnswers({}); setStarted(true) }}>
              Retake quiz
            </Button>
          </>
        )}
      </div>
    )
  }

  if (!started) {
    return (
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
        <p className="font-medium text-[var(--color-foreground)] mb-1">Module quiz</p>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          {questions.length} question{questions.length !== 1 ? "s" : ""} · {passThreshold}% to pass
        </p>
        <Button onClick={() => setStarted(true)} className="min-h-11">
          Start quiz
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <div key={q.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <p className="font-medium text-[var(--color-foreground)] mb-3">
            {i + 1}. {q.prompt}
          </p>

          {q.type === "boolean" && (
            <div className="flex gap-2">
              {[
                { id: "true", text: "True" },
                { id: "false", text: "False" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setAnswer(q.id, opt.id)}
                  className={`flex-1 min-h-11 rounded-md border text-sm font-medium ${
                    answers[q.id] === opt.id
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-foreground)]"
                  }`}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}

          {q.type === "single" && (
            <div className="space-y-2">
              {(q.options ?? []).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setAnswer(q.id, opt.id)}
                  className={`w-full min-h-11 px-3 py-2 rounded-md border text-left text-sm ${
                    answers[q.id] === opt.id
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                      : "border-[var(--color-border)] text-[var(--color-foreground)]"
                  }`}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}

          {q.type === "multi" && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-muted-foreground)]">Select all that apply</p>
              {(q.options ?? []).map((opt) => {
                const selected = Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt.id)
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleMulti(q.id, opt.id)}
                    className={`w-full min-h-11 px-3 py-2 rounded-md border text-left text-sm ${
                      selected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                        : "border-[var(--color-border)] text-[var(--color-foreground)]"
                    }`}
                  >
                    {opt.text}
                  </button>
                )
              })}
            </div>
          )}

          {q.type === "written" && (
            <textarea
              value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              rows={3}
              placeholder="Your answer…"
              className="w-full border border-[var(--color-border)] rounded-md bg-transparent px-3 py-2 text-sm text-[var(--color-foreground)]"
            />
          )}
        </div>
      ))}

      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <Button onClick={submit} disabled={!allAnswered || submitting} className="w-full min-h-12">
        {submitting ? "Submitting..." : "Submit quiz"}
      </Button>
      {!allAnswered && (
        <p className="text-xs text-center text-[var(--color-muted-foreground)]">
          Answer every question to submit.
        </p>
      )}
    </div>
  )
}
