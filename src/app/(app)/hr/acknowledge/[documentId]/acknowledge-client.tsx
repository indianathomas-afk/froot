"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, ExternalLink, PenLine, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  HR_ATTEST_CONSENT_TEXT,
  HR_ESIGN_CONSENT_TEXT,
} from "@/lib/hr-documents"

interface CaptureCheckpoint {
  id: string
  name: string
  type: string
  pageRef: number | null
  attestationText: string | null
  required: boolean
  done: boolean
}

interface CaptureDoc {
  id: string
  title: string
  versionNumber: number
  fileHash: string
  fileName: string
}

// One capture engine, two modes. Self: the signer works through every
// checkpoint — fields, per-page initials, attestations, typed signature.
// Attested: a manager records that the staff member completed the document;
// the manager types their own name and the record is marked ManagerAttested.
export function AcknowledgeClient({
  doc,
  checkpoints,
  mode,
  staff,
}: {
  doc: CaptureDoc
  checkpoints: CaptureCheckpoint[]
  mode: "self" | "attested"
  staff: { id: string; name: string }
}) {
  const router = useRouter()
  const attested = mode === "attested"

  const [consented, setConsented] = useState(false)
  const [typedName, setTypedName] = useState("")
  const [initials, setInitials] = useState("")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [finished, setFinished] = useState(false)

  const pending = useMemo(() => checkpoints.filter((c) => !c.done), [checkpoints])
  const fields = pending.filter((c) => c.type === "Field")
  const initialPages = pending.filter((c) => c.type === "Initial")
  const attestations = pending.filter((c) => c.type === "Acknowledgment")
  const signatures = pending.filter((c) => c.type === "Signature")
  const alreadyComplete = pending.filter((c) => c.required).length === 0

  // In attested mode the manager confirms the whole document at once; in self
  // mode every non-Field checkpoint needs its own deliberate tick.
  const requiredReady = attested
    ? fields.filter((c) => c.required).every((c) => fieldValues[c.id]?.trim()) && checked.attestAll
    : pending
        .filter((c) => c.required)
        .every((c) =>
          c.type === "Field"
            ? !!fieldValues[c.id]?.trim()
            : c.type === "Initial"
              ? checked[c.id] && !!initials.trim()
              : checked[c.id]
        )
  const canSubmit = consented && !!typedName.trim() && requiredReady && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const entries = attested
        ? pending.map((c) => ({
            checkpointId: c.id,
            ...(c.type === "Field" ? { value: fieldValues[c.id]?.trim() } : {}),
          }))
        : pending
            .filter((c) => (c.type === "Field" ? !!fieldValues[c.id]?.trim() : checked[c.id]))
            .map((c) => ({
              checkpointId: c.id,
              ...(c.type === "Field"
                ? { value: fieldValues[c.id]?.trim() }
                : c.type === "Initial"
                  ? { value: initials.trim().toUpperCase() }
                  : {}),
            }))
      const res = await fetch(`/api/hr/documents/${doc.id}/acknowledgments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(attested ? { staffMemberId: staff.id } : {}),
          consent: true,
          typedName: typedName.trim(),
          entries,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save — please try again")
        return
      }
      setFinished(data.complete === true)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (finished || alreadyComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <BackLink attested={attested} staffId={staff.id} />
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-success-bg,#e8f8ea)] flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-[var(--color-success,#25ba3b)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
            {doc.title} — complete
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Every required checkpoint of version {doc.versionNumber} is acknowledged
            {attested ? ` for ${staff.name}` : ""}. The signed record is kept permanently.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BackLink attested={attested} staffId={staff.id} />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{doc.title}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Version {doc.versionNumber} ·{" "}
          <span className="font-mono" title={`sha256 ${doc.fileHash}`}>
            sha256 {doc.fileHash.slice(0, 12)}…
          </span>
        </p>
        <a
          href={`/api/hr/documents/${doc.id}/download`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-[var(--color-primary)] hover:opacity-80"
        >
          <ExternalLink className="h-4 w-4" />
          Read the document ({doc.fileName})
        </a>
      </div>

      {attested && (
        <div className="mb-6 rounded-lg border border-[var(--color-warning-border,#f3d9a4)] bg-[var(--color-warning-bg,#fdf6e7)] px-4 py-3 text-sm text-[var(--color-warning-text,#8a6100)]">
          Recording on behalf of <strong>{staff.name}</strong> — this record will be marked
          manager-attested, not self-signed.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ESIGN consent gate — everything below stays disabled until given. */}
        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={consented}
              onCheckedChange={(v) => setConsented(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm text-[var(--color-foreground)]">
              <span className="inline-flex items-center gap-1.5 font-medium mb-1">
                <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
                {attested ? "Manager attestation" : "Electronic signature consent"}
              </span>
              <br />
              {attested ? HR_ATTEST_CONSENT_TEXT : HR_ESIGN_CONSENT_TEXT}
            </span>
          </label>
        </section>

        <fieldset disabled={!consented} className={consented ? "" : "opacity-50"}>
          <div className="space-y-6">
            {fields.length > 0 && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Details</h2>
                {fields.map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <Label>
                      {c.name}
                      {c.required && " *"}
                      {c.pageRef != null && (
                        <span className="text-xs text-[var(--color-muted-foreground)] ml-1">(p. {c.pageRef})</span>
                      )}
                    </Label>
                    <Input
                      value={fieldValues[c.id] ?? ""}
                      onChange={(e) => setFieldValues((s) => ({ ...s, [c.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </section>
            )}

            {!attested && initialPages.length > 0 && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Initial each page</h2>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      Type your initials, then confirm each page as you read it.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={initials}
                      onChange={(e) => setInitials(e.target.value)}
                      placeholder="Initials"
                      maxLength={6}
                      className="w-24 uppercase"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!initials.trim()}
                      onClick={() =>
                        setChecked((s) => ({
                          ...s,
                          ...Object.fromEntries(initialPages.map((c) => [c.id, true])),
                        }))
                      }
                    >
                      Initial all
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                  {initialPages.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-[var(--color-foreground)] cursor-pointer">
                      <Checkbox
                        checked={!!checked[c.id]}
                        disabled={!initials.trim()}
                        onCheckedChange={(v) => setChecked((s) => ({ ...s, [c.id]: v === true }))}
                      />
                      <span className="truncate">
                        {c.name}
                        {!c.required && <span className="text-[var(--color-muted-foreground)]"> (optional)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {!attested && attestations.length > 0 && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Acknowledgments</h2>
                {attestations.map((c) => (
                  <label key={c.id} className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={!!checked[c.id]}
                      onCheckedChange={(v) => setChecked((s) => ({ ...s, [c.id]: v === true }))}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-[var(--color-foreground)]">
                      <span className="font-medium">
                        {c.name}
                        {c.required && " *"}
                      </span>
                      {c.attestationText && (
                        <span className="block text-[var(--color-muted-foreground)] mt-0.5">
                          {c.attestationText}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </section>
            )}

            {!attested && signatures.length > 0 && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-3">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Signature</h2>
                {signatures.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 text-sm text-[var(--color-foreground)] cursor-pointer">
                    <Checkbox
                      checked={!!checked[c.id]}
                      onCheckedChange={(v) => setChecked((s) => ({ ...s, [c.id]: v === true }))}
                    />
                    {c.name}
                    {c.required && " *"}
                    {c.pageRef != null && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">(p. {c.pageRef})</span>
                    )}
                  </label>
                ))}
              </section>
            )}

            {attested && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={!!checked.attestAll}
                    onCheckedChange={(v) => setChecked((s) => ({ ...s, attestAll: v === true }))}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-[var(--color-foreground)]">
                    <span className="font-medium">
                      Record all {pending.length} outstanding checkpoints for {staff.name}
                    </span>
                    <span className="block text-[var(--color-muted-foreground)] mt-0.5">
                      Initials, signatures, and acknowledgments are recorded as attested by you.
                    </span>
                  </span>
                </label>
              </section>
            )}

            <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-1.5">
              <Label>
                <span className="inline-flex items-center gap-1.5">
                  <PenLine className="h-4 w-4 text-[var(--color-primary)]" />
                  {attested ? "Your full name (manager) *" : "Type your full legal name *"}
                </span>
              </Label>
              <Input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={attested ? "Manager name" : staff.name}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {attested
                  ? "Recorded as the attesting manager on every checkpoint."
                  : "Your typed name is your electronic signature."}
              </p>
            </section>
          </div>
        </fieldset>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <Button type="submit" disabled={!canSubmit}>
            {submitting
              ? "Saving..."
              : attested
                ? `Record for ${staff.name}`
                : "Sign & Complete"}
          </Button>
        </div>
      </form>
    </div>
  )
}

function BackLink({ attested, staffId }: { attested: boolean; staffId: string }) {
  const href = attested ? `/staff/${staffId}` : "/hr/documents"
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
    >
      <ArrowLeft className="h-4 w-4" />
      {attested ? "Staff Member" : "Document Library"}
    </Link>
  )
}
