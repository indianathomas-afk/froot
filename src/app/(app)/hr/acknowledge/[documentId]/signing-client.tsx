"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PenLine,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { HR_ESIGN_CONSENT_TEXT, HR_ESIGN_CONSENT_VERSION } from "@/lib/hr-documents"
import { PdfViewer } from "@/components/hr/pdf-viewer"

interface SigningCheckpoint {
  id: string
  name: string
  type: string
  pageRef: number | null
  attestationText: string | null
  required: boolean
  done: boolean
}

interface SigningDoc {
  id: string
  title: string
  versionNumber: number
  fileHash: string
  fileName: string
}

// HR-11 formal inline signing ceremony (self-serve only — manager-attested
// capture keeps the AcknowledgeClient quick form). Four phases:
//   consent → review (inline PDF, sequential per-page initialing)
//           → finalize (fields, acknowledgments, signature) → done.
// Every interaction saves PROGRESSIVELY through the existing acknowledgments
// API — one entry per moment — so each checkpoint row carries the real
// server-clock time it happened (the Defect-1 fix). Resume state comes from
// the per-cycle `done` flags; nothing here can touch a prior signed record.
export function SigningClient({
  doc,
  checkpoints,
  staff,
  backHref,
  backLabel,
}: {
  doc: SigningDoc
  checkpoints: SigningCheckpoint[]
  staff: { id: string; name: string }
  backHref?: string
  backLabel?: string
}) {
  const router = useRouter()

  type Phase = "consent" | "review" | "finalize" | "done"

  const [phase, setPhase] = useState<Phase>(() =>
    checkpoints.filter((c) => c.required && !c.done).length === 0 ? "done" : "consent"
  )
  const [consented, setConsented] = useState(false)
  const [typedName, setTypedName] = useState("")
  const [initialsText, setInitialsText] = useState("")
  const [completed, setCompleted] = useState<Map<string, Date | null>>(
    // null Date = completed in a previous session (no local time to show).
    () => new Map(checkpoints.filter((c) => c.done).map((c) => [c.id, null]))
  )
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [viewedPages, setViewedPages] = useState<Set<number>>(new Set())
  const [pageCount, setPageCount] = useState(0)
  const [pdfFailed, setPdfFailed] = useState(false)
  const [error, setError] = useState("")
  const submittingRef = useRef(false)

  // ── Checkpoint partitions ──────────────────────────────────────────────────
  const initials = useMemo(
    () =>
      checkpoints
        .filter((c) => c.type === "Initial")
        .sort((a, b) => (a.pageRef ?? Number.MAX_SAFE_INTEGER) - (b.pageRef ?? Number.MAX_SAFE_INTEGER)),
    [checkpoints]
  )
  const fields = useMemo(() => checkpoints.filter((c) => c.type === "Field"), [checkpoints])
  const attestations = useMemo(() => checkpoints.filter((c) => c.type === "Acknowledgment"), [checkpoints])
  const signatures = useMemo(() => checkpoints.filter((c) => c.type === "Signature"), [checkpoints])

  const initialsByPage = useMemo(() => {
    const m = new Map<number, SigningCheckpoint[]>()
    for (const c of initials) {
      if (c.pageRef == null) continue
      m.set(c.pageRef, [...(m.get(c.pageRef) ?? []), c])
    }
    return m
  }, [initials])

  // Sequence pointer: the first REQUIRED initial not yet completed.
  const nextRequiredInitial = initials.find((c) => c.required && !completed.has(c.id)) ?? null

  const initialsDone = initials.filter((c) => c.required).every((c) => completed.has(c.id))
  const allPagesViewed = pdfFailed || (pageCount > 0 && viewedPages.size >= pageCount)
  const canFinalize = initialsDone && allPagesViewed

  const fieldsDone = fields.filter((c) => c.required).every((c) => completed.has(c.id))
  const attestationsDone = attestations.filter((c) => c.required).every((c) => completed.has(c.id))
  const canSign = canFinalize && fieldsDone && attestationsDone

  // ── Progressive save ───────────────────────────────────────────────────────
  async function postEntries(entries: { checkpointId: string; value?: string }[]): Promise<boolean> {
    setError("")
    setSaving((s) => new Set([...s, ...entries.map((e) => e.checkpointId)]))
    try {
      const res = await fetch(`/api/hr/documents/${doc.id}/acknowledgments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, typedName: typedName.trim(), entries }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Couldn't save — check your connection and try again.")
        return false
      }
      const now = new Date()
      setCompleted((m) => {
        const next = new Map(m)
        entries.forEach((e) => next.set(e.checkpointId, now))
        return next
      })
      if (data.complete === true) {
        setPhase("done")
        router.refresh()
      }
      return true
    } catch {
      setError("Couldn't save — check your connection and try again.")
      return false
    } finally {
      setSaving((s) => {
        const next = new Set(s)
        entries.forEach((e) => next.delete(e.checkpointId))
        return next
      })
    }
  }

  async function handleSign() {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      const pending = signatures.filter((c) => !completed.has(c.id))
      if (pending.length === 0) return
      await postEntries(pending.map((c) => ({ checkpointId: c.id })))
    } finally {
      submittingRef.current = false
    }
  }

  // ── Shared chrome ──────────────────────────────────────────────────────────
  const back = (
    <Link
      href={backHref ?? "/hr/documents"}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
    >
      <ArrowLeft className="h-4 w-4" />
      {backLabel ?? "Document Library"}
    </Link>
  )

  const docMeta = (
    <p className="text-xs text-[var(--color-muted-foreground)]">
      Version {doc.versionNumber} ·{" "}
      <span className="font-mono" title={`sha256 ${doc.fileHash}`}>
        sha256 {doc.fileHash.slice(0, 12)}…
      </span>
    </p>
  )

  // ── Phase: done ────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="max-w-2xl mx-auto">
        {back}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-success-bg,#e8f8ea)] flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-[var(--color-success,#25ba3b)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
            {doc.title} — executed
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
            Every required checkpoint of version {doc.versionNumber} is acknowledged. Your signed
            record — including the date and time of each step you completed — is kept permanently.
          </p>
        </div>
      </div>
    )
  }

  // ── Phase: consent ─────────────────────────────────────────────────────────
  if (phase === "consent") {
    const resuming = completed.size > 0
    const needsInitials = initials.some((c) => !completed.has(c.id))
    const canBegin = consented && !!typedName.trim() && (!needsInitials || !!initialsText.trim())
    return (
      <div className="max-w-2xl mx-auto">
        {back}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
          <div className="px-6 py-5 border-b border-[var(--color-border)] bg-[var(--color-accent)]/30">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">
              Document signing
            </p>
            <h1 className="text-xl font-bold text-[var(--color-foreground)]">{doc.title}</h1>
            <div className="mt-1">{docMeta}</div>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
              Signer: <span className="font-medium text-[var(--color-foreground)]">{staff.name}</span>
              {" · "}
              {format(new Date(), "MMMM d, yyyy")}
            </p>
          </div>

          <div className="p-6 space-y-5">
            {resuming && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/30 px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                You have progress on this document — completed steps are kept, and you&apos;ll resume
                where you left off.
              </div>
            )}

            <div className="rounded-lg border border-[var(--color-border)] p-4">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-foreground)] mb-2">
                <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
                Electronic signature consent
              </p>
              <p className="text-sm text-[var(--color-foreground)] leading-relaxed">
                {HR_ESIGN_CONSENT_TEXT}
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-2 font-mono">
                Consent version {HR_ESIGN_CONSENT_VERSION}
              </p>
              <label className="flex items-start gap-3 cursor-pointer mt-3 pt-3 border-t border-[var(--color-border)]">
                <Checkbox checked={consented} onCheckedChange={(v) => setConsented(v === true)} className="mt-0.5" />
                <span className="text-sm font-medium text-[var(--color-foreground)]">
                  I consent to sign this document electronically
                </span>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
              <div className="space-y-1.5">
                <Label>Type your full legal name *</Label>
                <Input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={staff.name}
                  autoComplete="name"
                />
              </div>
              {needsInitials && (
                <div className="space-y-1.5">
                  <Label>Your initials *</Label>
                  <Input
                    value={initialsText}
                    onChange={(e) => setInitialsText(e.target.value.toUpperCase())}
                    placeholder="e.g. TT"
                    maxLength={6}
                    className="uppercase"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Your typed name is your electronic signature. Each step you complete is recorded with
              the date and time it occurred.
            </p>

            <div className="flex justify-end">
              <Button disabled={!canBegin} onClick={() => setPhase("review")} className="min-h-11">
                Agree &amp; review the document
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Phase: review / finalize ───────────────────────────────────────────────
  const reviewProgress = (
    <div className="sticky top-0 z-30 -mx-4 px-4 py-2.5 bg-[var(--color-background)]/95 backdrop-blur border-b border-[var(--color-border)] mb-4">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">{doc.title}</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {pdfFailed
              ? `${initials.filter((c) => completed.has(c.id)).length}/${initials.length} pages initialed`
              : `${Math.min(viewedPages.size, pageCount)}/${pageCount || "…"} pages reviewed · ${
                  initials.filter((c) => completed.has(c.id)).length
                }/${initials.length} initialed`}
          </p>
        </div>
        {phase === "review" ? (
          <Button size="sm" className="min-h-11 shrink-0" disabled={!canFinalize} onClick={() => setPhase("finalize")}>
            Continue
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => setPhase("review")}>
            Back to document
          </Button>
        )}
      </div>
    </div>
  )

  function initialControl(c: SigningCheckpoint) {
    const done = completed.has(c.id)
    const time = completed.get(c.id)
    const isSaving = saving.has(c.id)
    const pageSeen = pdfFailed || c.pageRef == null || viewedPages.has(c.pageRef)
    const isNext = !c.required || nextRequiredInitial?.id === c.id
    const enabled = !done && !isSaving && pageSeen && isNext

    if (done) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-success-bg,#e8f8ea)] border border-[var(--color-success,#25ba3b)]/30 px-3 py-2 text-sm font-medium text-[var(--color-success,#1c8a2e)]">
          <CheckCircle2 className="h-4 w-4" />
          <span className="font-semibold tracking-wide">{initialsText || "Initialed"}</span>
          {time && <span className="text-xs font-normal">{format(time, "h:mm:ss a")}</span>}
        </span>
      )
    }
    return (
      <Button
        size="sm"
        variant={enabled ? "default" : "outline"}
        disabled={!enabled}
        onClick={() => postEntries([{ checkpointId: c.id, value: initialsText.trim().toUpperCase() }])}
        className="min-h-11"
        title={
          !pageSeen
            ? "Scroll this page into view first"
            : !isNext
              ? "Initial the earlier pages first"
              : undefined
        }
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
        {c.name}
        {!c.required && <span className="text-xs font-normal">(optional)</span>}
      </Button>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {back}
      {reviewProgress}
      {error && (
        <p className="text-sm text-[var(--color-destructive)] mb-3" role="alert">
          {error}
        </p>
      )}

      <div className={phase === "review" ? "" : "hidden"}>
        {pdfFailed ? (
          // Fallback when the file can't render inline (e.g. non-PDF upload):
          // the document opens externally; initialing stays sequential.
          <div className="space-y-4">
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
              <p className="text-sm text-[var(--color-foreground)] mb-2">
                This document can&apos;t be displayed inline. Open it, read each page, then initial
                below in order.
              </p>
              <a
                href={`/api/hr/documents/${doc.id}/download`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80"
              >
                <ExternalLink className="h-4 w-4" />
                Read the document ({doc.fileName})
              </a>
            </div>
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-2">
              {initials.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-[var(--color-foreground)]">{c.name}</span>
                  {initialControl(c)}
                </div>
              ))}
              {initials.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No per-page initials for this document — continue when ready.
                </p>
              )}
            </div>
          </div>
        ) : (
          <PdfViewer
            src={`/api/hr/documents/${doc.id}/download?stream=1`}
            onReady={setPageCount}
            onPageViewed={(n) => setViewedPages((s) => (s.has(n) ? s : new Set(s).add(n)))}
            onError={() => setPdfFailed(true)}
            pageOverlay={(pageNumber) => {
              const pageInitials = initialsByPage.get(pageNumber)
              if (!pageInitials?.length) return null
              return (
                <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
                  {pageInitials.map((c) => (
                    <span key={c.id}>{initialControl(c)}</span>
                  ))}
                </div>
              )
            }}
          />
        )}
        <div className="mt-4 flex justify-end">
          <Button disabled={!canFinalize} onClick={() => setPhase("finalize")} className="min-h-11">
            {canFinalize ? "Continue to acknowledgments" : "Review every page to continue"}
          </Button>
        </div>
      </div>

      {phase === "finalize" && (
        <div className="space-y-5">
          {fields.length > 0 && (
            <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Details</h2>
              {fields.map((c) => {
                const done = completed.has(c.id)
                return (
                  <div key={c.id} className="space-y-1.5">
                    <Label>
                      {c.name}
                      {c.required && " *"}
                      {c.pageRef != null && (
                        <span className="text-xs text-[var(--color-muted-foreground)] ml-1">(p. {c.pageRef})</span>
                      )}
                    </Label>
                    <Input
                      value={done ? (fieldValues[c.id] ?? "Saved") : (fieldValues[c.id] ?? "")}
                      disabled={done}
                      onChange={(e) => setFieldValues((s) => ({ ...s, [c.id]: e.target.value }))}
                    />
                  </div>
                )
              })}
              {!fieldsDone && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={
                      fields.some((c) => c.required && !completed.has(c.id) && !fieldValues[c.id]?.trim()) ||
                      fields.some((c) => saving.has(c.id))
                    }
                    onClick={() =>
                      postEntries(
                        fields
                          .filter((c) => !completed.has(c.id) && !!fieldValues[c.id]?.trim())
                          .map((c) => ({ checkpointId: c.id, value: fieldValues[c.id].trim() }))
                      )
                    }
                  >
                    Confirm details
                  </Button>
                </div>
              )}
            </section>
          )}

          {attestations.length > 0 && (
            <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Acknowledgments</h2>
              {attestations.map((c) => {
                const done = completed.has(c.id)
                const time = completed.get(c.id)
                const isSaving = saving.has(c.id)
                return (
                  <label key={c.id} className={`flex items-start gap-3 ${done ? "" : "cursor-pointer"}`}>
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-[var(--color-muted-foreground)]" />
                    ) : (
                      <Checkbox
                        checked={done}
                        disabled={done}
                        onCheckedChange={(v) => {
                          if (v === true && !done) postEntries([{ checkpointId: c.id }])
                        }}
                        className="mt-0.5"
                      />
                    )}
                    <span className="text-sm text-[var(--color-foreground)]">
                      <span className="font-medium">
                        {c.name}
                        {c.required && " *"}
                        {done && time && (
                          <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">
                            {format(time, "h:mm:ss a")}
                          </span>
                        )}
                      </span>
                      {c.attestationText && (
                        <span className="block text-[var(--color-muted-foreground)] mt-0.5">{c.attestationText}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </section>
          )}

          {/* ── Execution block ── */}
          <section className="border-2 border-[var(--color-primary)]/40 rounded-lg bg-[var(--color-card)] p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-3">
              Execute document
            </p>
            <div className="space-y-1 text-sm text-[var(--color-foreground)] mb-4">
              <p>
                Document: <span className="font-medium">{doc.title}</span> — version {doc.versionNumber}
              </p>
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">sha256 {doc.fileHash}</p>
              <p>
                Signer: <span className="font-medium">{staff.name}</span>
              </p>
              <p>{format(new Date(), "MMMM d, yyyy · h:mm a")}</p>
            </div>
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-accent)]/30 px-4 py-3 mb-4">
              <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">{HR_ESIGN_CONSENT_TEXT}</p>
            </div>
            <div className="mb-4">
              <p className="text-xs text-[var(--color-muted-foreground)] mb-1">Signature</p>
              <p
                className="text-2xl text-[var(--color-foreground)] border-b-2 border-[var(--color-foreground)]/60 inline-block pr-8 pb-1"
                style={{ fontFamily: "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive" }}
              >
                {typedName.trim() || staff.name}
              </p>
            </div>
            {signatures.length > 0 ? (
              <Button
                className="w-full min-h-12 text-base"
                disabled={!canSign || signatures.every((c) => completed.has(c.id)) || signatures.some((c) => saving.has(c.id))}
                onClick={handleSign}
              >
                {signatures.some((c) => saving.has(c.id)) ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <PenLine className="h-5 w-5" />
                )}
                Sign document
              </Button>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                This document completes when every acknowledgment above is confirmed.
              </p>
            )}
            {!canSign && (
              <p className="text-xs text-[var(--color-muted-foreground)] mt-2 text-center">
                Complete every required step above to sign.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
