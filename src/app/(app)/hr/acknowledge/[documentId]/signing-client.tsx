"use client"

import { useMemo, useState } from "react"
import type { ReactNode } from "react"
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
import { HR_RECORD_MISSING_SIGNER_COPY } from "@/lib/hr-completion"
import { PdfViewer } from "@/components/hr/pdf-viewer"
import { SigningUnavailable } from "@/components/hr/signing-unavailable"

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
//
// R1 (Gary, 2026-08-15): RESUME STATE COMES FROM THE `done` FLAGS, COMPLETION
// DOES NOT. Those two sentences used to be one, and that is A5 in the audit:
// the opening phase was "done" whenever every required checkpoint carried a
// flag, so the signer in the reproduction re-opened the document and was shown
// the executed screen — "your signed record is kept permanently" — with no
// record in existence. `hasSignedRecord` is now the only thing that opens that
// screen, and it is server-supplied because this component cannot see a record.
export function SigningClient({
  doc,
  checkpoints,
  hasSignedRecord,
  staff,
  anchors = [],
  backHref,
  backLabel,
}: {
  doc: SigningDoc
  checkpoints: SigningCheckpoint[]
  /**
   * An HrSignedRecord exists for (current version, this signer, current cycle).
   * The ONLY input that may produce the executed screen.
   */
  hasSignedRecord: boolean
  // name = the LEGAL Full Name on file (read-only context; the signer types
  // their own signature). stores = the signer's assigned stores for the
  // select-from-assigned store picker.
  staff: {
    id: string
    name: string
    // DEBT-9: hides the store picker. UX ONLY — the server ignores any storeId
    // a corporate signer's client submits (acknowledgments/route.ts:170-186).
    isCorporate: boolean
    stores: { id: string; name: string; isPrimary: boolean }[]
  }
  // Confirmed anchors for the current version — coordinates let the ceremony
  // place affordances (Item 2) and read-only identity chips (Item 1) AT the
  // line, not corner-docked. Empty for docs that were never anchor-detected
  // (falls back to the corner dock).
  anchors?: {
    page: number
    x: number
    y: number
    width: number | null
    placement: string
    markType: string
    generatedCheckpointId: string | null
  }[]
  backHref?: string
  backLabel?: string
}) {
  const router = useRouter()

  // "unavailable" — HR-11d 2b layer (c) refused to mint after the last capture.
  // Only reachable when layer (b) was bypassed (a stale tab, a hand-rolled
  // POST): the page itself refuses this state before the ceremony starts.
  //
  // "record-missing" — R1. Every required checkpoint is captured and no record
  // exists, for a reason this client cannot distinguish (the mint threw for
  // something other than unconfirmed anchors, or it never ran). The signer has
  // nothing left to do, so this is not "consent" — and nothing was executed, so
  // it is emphatically not "done".
  type Phase = "consent" | "review" | "finalize" | "done" | "unavailable" | "record-missing"

  const allRequiredCaptured = checkpoints.filter((c) => c.required && !c.done).length === 0
  const [phase, setPhase] = useState<Phase>(() =>
    hasSignedRecord ? "done" : allRequiredCaptured ? "record-missing" : "consent"
  )
  const [consented, setConsented] = useState(false)
  const [typedName, setTypedName] = useState("")
  const [initialsText, setInitialsText] = useState("")
  // Store that will be stamped — signer picks from their assigned stores,
  // pre-selected to primary. Captured once and sent with every entry.
  // DEBT-9: a corporate signer picks nothing and sends nothing; the server
  // resolves their store as "Corporate" and ignores this field either way.
  const primaryStore = staff.stores.find((s) => s.isPrimary) ?? staff.stores[0] ?? null
  const [selectedStoreId, setSelectedStoreId] = useState<string>(
    staff.isCorporate ? "" : (primaryStore?.id ?? "")
  )
  // "This isn't my name" — the signer disputes the legal name on file; signing
  // pauses and escalates to an admin (F3 block-and-escalate).
  const [nameDisputed, setNameDisputed] = useState(false)
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

  // Signatures are captured inline per page (like initials), each its own act
  // with its own timestamp.
  const signaturesByPage = useMemo(() => {
    const m = new Map<number, SigningCheckpoint[]>()
    for (const c of signatures) {
      if (c.pageRef == null) continue
      m.set(c.pageRef, [...(m.get(c.pageRef) ?? []), c])
    }
    return m
  }, [signatures])

  // Anchor coordinates for inline placement (Items 1 & 2): each Initial/Signature
  // checkpoint's anchor (to place its affordance at the line), and the derived
  // identity anchors per page (to show read-only name/date/store chips).
  const anchorByCheckpoint = useMemo(() => {
    const m = new Map<string, (typeof anchors)[number]>()
    for (const a of anchors) if (a.generatedCheckpointId) m.set(a.generatedCheckpointId, a)
    return m
  }, [anchors])
  const identityAnchorsByPage = useMemo(() => {
    const m = new Map<number, (typeof anchors)[number][]>()
    for (const a of anchors) {
      if (a.markType === "PrintedName" || a.markType === "DateStamp" || a.markType === "Store") {
        m.set(a.page, [...(m.get(a.page) ?? []), a])
      }
    }
    return m
  }, [anchors])
  const selectedStoreName = staff.stores.find((s) => s.id === selectedStoreId)?.name ?? ""

  // Sequence pointer: the first REQUIRED initial not yet completed.
  const nextRequiredInitial = initials.find((c) => c.required && !completed.has(c.id)) ?? null

  const initialsDone = initials.filter((c) => c.required).every((c) => completed.has(c.id))
  const signaturesDone = signatures.filter((c) => c.required).every((c) => completed.has(c.id))
  const allPagesViewed = pdfFailed || (pageCount > 0 && viewedPages.size >= pageCount)
  const canFinalize = initialsDone && signaturesDone && allPagesViewed

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
        body: JSON.stringify({
          consent: true,
          typedName: typedName.trim(),
          storeId: selectedStoreId || undefined,
          entries,
        }),
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
      // R1: `complete` now IS the mint result, so this is the record test and no
      // longer needs signingUnavailable to avoid claiming a signature. That flag
      // still picks WHICH refusal to show — anchors an admin must confirm, or a
      // mint that may simply be retried.
      if (data.complete === true) {
        setPhase("done")
        router.refresh()
      } else if (data.checkpointsComplete === true) {
        setPhase(data.signingUnavailable === true ? "unavailable" : "record-missing")
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

  // ── Phase: unavailable ─────────────────────────────────────────────────────
  // Layer (c) declined to mint. The signer's captures are all on file — they do
  // not sign again — so the copy must not read as "you failed" or "start over".
  if (phase === "unavailable") {
    return (
      <div className="max-w-2xl mx-auto">
        {back}
        <SigningUnavailable audience="signer" documentId={doc.id} documentTitle={doc.title} />
      </div>
    )
  }

  // ── Phase: record-missing ──────────────────────────────────────────────────
  // R1. Everything the signer can do is done and no record exists. The copy is
  // the ruled verbatim string; the paragraph under it exists because the screen
  // this replaces told them they were finished, and the correction must not now
  // read as "you did something wrong" or "start again" — neither is true, and
  // their captures are all on file.
  if (phase === "record-missing") {
    return (
      <div className="max-w-2xl mx-auto">
        {back}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-amber-700" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
            {HR_RECORD_MISSING_SIGNER_COPY}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
            You have completed every step of {doc.title}. Each one is saved with the date and time
            you did it, and nothing needs doing again — but the signed record has not been issued
            yet, so this document is not finished. Your manager can complete it.
          </p>
        </div>
      </div>
    )
  }

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
    const canBegin =
      consented && !nameDisputed && !!typedName.trim() && (!needsInitials || !!initialsText.trim())
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

            {/* What will be stamped on the executed document — visible BEFORE
                signing (transparency is the whole point). Name on file is
                read-only context; store is selectable; date is display-only. */}
            <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                What will be stamped on this document
              </p>
              <div>
                <p className="text-xs text-[var(--color-muted-foreground)]">Signing as — name on file</p>
                <p className="text-base font-semibold text-[var(--color-foreground)]">{staff.name}</p>
                {!nameDisputed ? (
                  <button
                    type="button"
                    onClick={() => setNameDisputed(true)}
                    className="text-xs text-[var(--color-primary)] hover:opacity-80 mt-0.5"
                  >
                    This isn&apos;t my name
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-[var(--color-warning,#efa201)]">
                    Signing paused. Ask an admin or manager to correct your legal name on your staff
                    profile, then reload.{" "}
                    <button
                      type="button"
                      onClick={() => setNameDisputed(false)}
                      className="underline hover:opacity-80"
                    >
                      It&apos;s correct — continue
                    </button>
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-[var(--color-muted-foreground)] font-normal">Store</Label>
                {staff.isCorporate ? (
                  <p className="text-sm text-[var(--color-foreground)]">
                    Corporate
                    <span className="block text-xs text-[var(--color-muted-foreground)]">
                      Your work location is the company, not a store.
                    </span>
                  </p>
                ) : staff.stores.length > 0 ? (
                  <select
                    value={selectedStoreId}
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                    className="w-full min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm text-[var(--color-foreground)]"
                  >
                    {staff.stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.isPrimary ? " (primary)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-[var(--color-warning,#efa201)]">
                    No store on file — this will be left blank; ask an admin to assign your store.
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-[var(--color-muted-foreground)]">Date</p>
                <p className="text-sm text-[var(--color-foreground)]">
                  {format(new Date(), "MMMM d, yyyy")} — the real date and time of each step is
                  recorded automatically.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
              <div className="space-y-1.5">
                <Label>Type your full legal name *</Label>
                <Input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type it yourself to sign"
                  autoComplete="off"
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
              Type your name yourself — it is your electronic signature. Each step you complete is
              recorded with the date and time it occurred.
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

  // Inline per-signature capture — an explicit act on the page it belongs to,
  // posted on its own so each carries a distinct server timestamp. Reuses the
  // legal name typed once at the consent gate (postEntries sends typedName).
  function signatureControl(c: SigningCheckpoint) {
    const done = completed.has(c.id)
    const time = completed.get(c.id)
    const isSaving = saving.has(c.id)
    const pageSeen = pdfFailed || c.pageRef == null || viewedPages.has(c.pageRef)
    const enabled = !done && !isSaving && pageSeen && !!typedName.trim()

    if (done) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-success-bg,#e8f8ea)] border border-[var(--color-success,#25ba3b)]/30 px-3 py-2 text-sm font-medium text-[var(--color-success,#1c8a2e)]">
          <CheckCircle2 className="h-4 w-4" />
          <span
            className="font-semibold"
            style={{ fontFamily: "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive" }}
          >
            {typedName.trim() || staff.name}
          </span>
          {time && <span className="text-xs font-normal">{format(time, "h:mm:ss a")}</span>}
        </span>
      )
    }
    return (
      <Button
        size="sm"
        variant={enabled ? "default" : "outline"}
        disabled={!enabled}
        onClick={() => postEntries([{ checkpointId: c.id }])}
        className="min-h-11"
        title={
          !pageSeen
            ? "Scroll this page into view first"
            : !typedName.trim()
              ? "Enter your name at the start first"
              : undefined
        }
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
        Sign here
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
              {signatures.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-[var(--color-foreground)]">{c.name}</span>
                  {signatureControl(c)}
                </div>
              ))}
              {initials.length === 0 && signatures.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No per-page initials or signatures for this document — continue when ready.
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
            pageOverlay={(pageNumber, geom) => {
              const pageInitials = initialsByPage.get(pageNumber) ?? []
              const pageSignatures = signaturesByPage.get(pageNumber) ?? []
              const pageIdentity = identityAnchorsByPage.get(pageNumber) ?? []
              if (!pageInitials.length && !pageSignatures.length && !pageIdentity.length) return null

              // Before the page renders (geom null) or for checkpoints whose
              // anchor we don't have (legacy docs), corner-dock so affordances
              // stay reachable.
              const cornerDock = (sig: SigningCheckpoint[], init: SigningCheckpoint[]) =>
                sig.length || init.length ? (
                  <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
                    {sig.map((c) => (
                      <span key={c.id}>{signatureControl(c)}</span>
                    ))}
                    {init.map((c) => (
                      <span key={c.id}>{initialControl(c)}</span>
                    ))}
                  </div>
                ) : null

              if (!geom) return cornerDock(pageSignatures, pageInitials)

              // ── HR-11o D2: affordances move SIDEWAYS, never vertically ──────
              // These used to be lifted above the anchor (translate(0,-118%)) so
              // they would clear the signature line and its caption. On page 3 of
              // the test document that put "Sign here" squarely on top of the
              // acknowledgment paragraph — "By accepting employment with Keva
              // Juice, you acknowledge you have fully read and understand…" — so
              // the signer could not read the sentence they were signing under.
              //
              // ANY upward placement collides, because prose sits directly above
              // a signature line by construction; that is what a signature line
              // IS. Downward is the parked Initials-vs-footer collision. So the
              // fix cannot be a better vertical offset — it has to leave the
              // vertical band alone entirely.
              //
              // Horizontal is safe because the space to the right of an anchor
              // token is the FILL LINE: an underscore run the document itself
              // reserves for a mark. Nothing readable is there. The identity
              // chips (printed name / store / date) have always placed this way.
              //
              // Vertically centred on the anchor baseline rather than lifted, so
              // the control sits ON the line it belongs to and reads as attached
              // to it.
              const placed: { top: number; left: number }[] = []
              const NUDGE = 132
              const at = (
                ax: number,
                ay: number,
                node: ReactNode,
                key: string,
                dockOnOverflow = false
              ) => {
                const p = geom.toCss(ax, ay)
                let left = p.left
                // Collision nudge goes RIGHT, not up — the old `top -= 46` walked
                // stacked affordances further into the body text with each step.
                while (placed.some((q) => Math.abs(q.top - p.top) < 28 && Math.abs(q.left - left) < NUDGE)) {
                  left += NUDGE
                }
                // Ran out of page. Controls fall back to the corner dock — which
                // is already the answer for anchorless checkpoints — because a
                // control clipped at the right edge is unclickable. Read-only
                // identity chips clamp instead: a visible date slightly out of
                // position beats no date at all.
                if (left > geom.cssWidth - 120) {
                  if (dockOnOverflow) return null
                  left = Math.max(0, geom.cssWidth - 120)
                }
                placed.push({ top: p.top, left })
                return (
                  <div
                    key={key}
                    className="absolute z-10"
                    style={{ left, top: p.top, transform: "translate(0, -50%)" }}
                  >
                    {node}
                  </div>
                )
              }

              const dockSig = pageSignatures.filter((c) => !anchorByCheckpoint.get(c.id))
              const dockInit = pageInitials.filter((c) => !anchorByCheckpoint.get(c.id))

              // Where a mark belongs relative to its anchor token. "Right" means
              // a fill line follows the label, so sit on it; otherwise the label
              // captions a line and its own right side is the clear space. This
              // is the rule the identity chips already used — signatures and
              // initials now share it instead of lifting vertically (D2).
              const anchorX = (a: { x: number; width: number | null; placement: string }) =>
                a.placement === "Right" ? a.x + (a.width ?? 0) + 4 : a.x

              // Anchored controls that overflow the page width dock instead. Built
              // before the return so the dock list is complete when it renders.
              const overflowSig: SigningCheckpoint[] = []
              const overflowInit: SigningCheckpoint[] = []
              const sigNodes = pageSignatures.map((c) => {
                const a = anchorByCheckpoint.get(c.id)
                if (!a) return null
                const node = at(anchorX(a), a.y, signatureControl(c), c.id, true)
                if (!node) overflowSig.push(c)
                return node
              })
              const initNodes = pageInitials.map((c) => {
                const a = anchorByCheckpoint.get(c.id)
                if (!a) return null
                const node = at(anchorX(a), a.y, initialControl(c), c.id, true)
                if (!node) overflowInit.push(c)
                return node
              })

              return (
                <>
                  {pageIdentity.map((a, i) => {
                    const value =
                      a.markType === "PrintedName"
                        ? staff.name
                        : a.markType === "Store"
                          ? selectedStoreName || "—"
                          : format(new Date(), "MMM d, yyyy")
                    return at(
                      anchorX(a),
                      a.y,
                      // HR-11o D3: OPAQUE background. This chip was
                      // bg-[var(--color-primary)]/10 — 10% alpha — and it sits by
                      // design on the fill line, an underscore run drawn on the
                      // PDF canvas underneath. Those underscores read straight
                      // through the translucent chip and crossed the text, so the
                      // stamped date rendered as "Aug 15, 2026" struck out. On a
                      // signed document a struck-through date reads as an
                      // alteration. Opaque card background, primary border and
                      // text kept, so nothing on the page can show through.
                      <span className="inline-block rounded bg-[var(--color-card)] border border-[var(--color-primary)]/25 px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-primary)] whitespace-nowrap">
                        {value}
                      </span>,
                      `id-${i}`
                    )
                  })}
                  {sigNodes}
                  {initNodes}
                  {cornerDock([...dockSig, ...overflowSig], [...dockInit, ...overflowInit])}
                </>
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
            {/* Signatures are captured inline on their pages during review, each
                with its own timestamp; the document completes on the final
                acknowledgment below. */}
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {attestations.length > 0
                ? "You've signed each page above. Confirm the acknowledgment to complete this document."
                : "You've signed each page above. Complete every step to finish."}
            </p>
            {!canSign && (
              <p className="text-xs text-[var(--color-muted-foreground)] mt-2 text-center">
                Complete every required step above to finish.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
