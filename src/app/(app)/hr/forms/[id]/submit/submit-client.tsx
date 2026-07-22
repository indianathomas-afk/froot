"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, CheckCircle2, Clock, PenLine, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { HR_ESIGN_CONSENT_TEXT } from "@/lib/hr-documents"
import type { FormDefinition } from "@/lib/hr-forms"

export interface SubmittedValue {
  label: string
  fieldType: string
  value: string
}

interface PendingSubmission {
  id: string
  values: SubmittedValue[]
  employeeTypedName: string
  employeeSignedAt: string
  formTitle: string
  formVersionNumber: number
}

const INPUT_TYPES: Record<string, string> = {
  Text: "text",
  Date: "date",
  Email: "email",
  Phone: "tel",
  Number: "number",
}

// Dual-signature execution. Both typed-name signatures (employee AND the
// supervising manager) are required before the form can be completed — the
// submit control stays disabled until both are present. If the signers are
// not co-present, "save for countersign" records the employee half as
// PendingSupervisor; reopening the form renders countersign mode instead.
export function FormSubmitClient({
  doc,
  definition,
  staff,
  supervisorName,
  pending,
}: {
  doc: { id: string; title: string; versionNumber: number; definitionHash: string }
  definition: FormDefinition
  staff: { id: string; name: string }
  supervisorName: string
  pending: PendingSubmission | null
}) {
  if (pending) {
    return (
      <CountersignView doc={doc} staff={staff} supervisorName={supervisorName} pending={pending} />
    )
  }
  return (
    <FillView doc={doc} definition={definition} staff={staff} supervisorName={supervisorName} />
  )
}

function FillView({
  doc,
  definition,
  staff,
  supervisorName,
}: {
  doc: { id: string; title: string; versionNumber: number; definitionHash: string }
  definition: FormDefinition
  staff: { id: string; name: string }
  supervisorName: string
}) {
  const router = useRouter()
  const [consented, setConsented] = useState(false)
  const [values, setValues] = useState<string[]>(() => definition.fields.map(() => ""))
  const [employeeName, setEmployeeName] = useState("")
  const [supervisorTyped, setSupervisorTyped] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [finished, setFinished] = useState<"complete" | "pending" | null>(null)

  const requiredFilled = useMemo(
    () => definition.fields.every((f, i) => !f.required || !!values[i]?.trim()),
    [definition.fields, values]
  )
  // Rule: no finalize without BOTH signatures.
  const canComplete = consented && requiredFilled && !!employeeName.trim() && !!supervisorTyped.trim() && !submitting
  const canSavePending = consented && requiredFilled && !!employeeName.trim() && !submitting

  async function submit(withSupervisor: boolean) {
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/forms/${doc.id}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffMemberId: staff.id,
          definitionHash: doc.definitionHash,
          values: values.map((v) => v.trim()),
          consent: true,
          employeeTypedName: employeeName.trim(),
          ...(withSupervisor ? { supervisorTypedName: supervisorTyped.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save — please try again")
        return
      }
      setFinished(data.complete ? "complete" : "pending")
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (finished) {
    return (
      <DoneCard
        staffId={staff.id}
        title={doc.title}
        message={
          finished === "complete"
            ? `Both signatures are recorded for ${staff.name}. The executed form is kept permanently on their Documents tab.`
            : `${staff.name}'s signature is recorded. The form stays open until a supervisor countersigns — reopen it from the Documents tab to finish.`
        }
        pending={finished === "pending"}
      />
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BackLink staffId={staff.id} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{doc.title}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          For <strong>{staff.name}</strong> · Version {doc.versionNumber} ·{" "}
          <span className="font-mono" title={`definition sha256 ${doc.definitionHash}`}>
            sha256 {doc.definitionHash.slice(0, 12)}…
          </span>
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canComplete) void submit(true)
        }}
        className="space-y-6"
      >
        {/* ESIGN consent gate — everything below stays disabled until given. */}
        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={consented} onCheckedChange={(v) => setConsented(v === true)} className="mt-0.5" />
            <span className="text-sm text-[var(--color-foreground)]">
              <span className="inline-flex items-center gap-1.5 font-medium mb-1">
                <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
                Electronic signature consent (both signers)
              </span>
              <br />
              {HR_ESIGN_CONSENT_TEXT}
            </span>
          </label>
        </section>

        <fieldset disabled={!consented} className={consented ? "" : "opacity-50"}>
          <div className="space-y-6">
            {definition.bodyText && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-2">Agreement</h2>
                <div className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap">
                  {definition.bodyText}
                </div>
              </section>
            )}

            {definition.fields.length > 0 && (
              <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Details</h2>
                {definition.fields.map((f, i) => (
                  <div key={i} className="space-y-1.5">
                    <Label>
                      {f.label}
                      {f.required && " *"}
                    </Label>
                    {f.fieldType === "Select" ? (
                      <Select
                        value={values[i] || undefined}
                        onValueChange={(v) => setValues((s) => s.map((x, j) => (j === i ? v : x)))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(f.options ?? []).map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={INPUT_TYPES[f.fieldType] ?? "text"}
                        value={values[i]}
                        onChange={(e) => setValues((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    )}
                  </div>
                ))}
              </section>
            )}

            <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-1.5">
              <Label>
                <span className="inline-flex items-center gap-1.5">
                  <PenLine className="h-4 w-4 text-[var(--color-primary)]" />
                  Employee signature — type full legal name *
                </span>
              </Label>
              <Input
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder={staff.name}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Typed by {staff.name} — their typed name is their electronic signature.
              </p>
            </section>

            <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-1.5">
              <Label>
                <span className="inline-flex items-center gap-1.5">
                  <PenLine className="h-4 w-4 text-[var(--color-primary)]" />
                  Supervisor signature — type full legal name *
                </span>
              </Label>
              <Input
                value={supervisorTyped}
                onChange={(e) => setSupervisorTyped(e.target.value)}
                placeholder={supervisorName}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                You are signing as the supervisor ({supervisorName}). Not together right now? Leave
                this blank and save — the form waits for a countersignature.
              </p>
            </section>
          </div>
        </fieldset>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <div className="flex items-center justify-end gap-3 flex-wrap">
          <Button
            type="button"
            variant="outline"
            disabled={!canSavePending || !!supervisorTyped.trim()}
            onClick={() => void submit(false)}
            title={supervisorTyped.trim() ? "Both signatures present — use Sign & Complete" : undefined}
          >
            {submitting ? "Saving..." : "Save — supervisor signs later"}
          </Button>
          <Button type="submit" disabled={!canComplete}>
            {submitting ? "Saving..." : "Sign & Complete"}
          </Button>
        </div>
      </form>
    </div>
  )
}

// The second half of a split execution: the employee's values and signature
// are frozen and shown read-only; only the supervisor block is captured.
function CountersignView({
  doc,
  staff,
  supervisorName,
  pending,
}: {
  doc: { id: string; title: string }
  staff: { id: string; name: string }
  supervisorName: string
  pending: PendingSubmission
}) {
  const router = useRouter()
  const [consented, setConsented] = useState(false)
  const [supervisorTyped, setSupervisorTyped] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [finished, setFinished] = useState(false)

  const canSubmit = consented && !!supervisorTyped.trim() && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/forms/submissions/${pending.id}/countersign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, supervisorTypedName: supervisorTyped.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to countersign — please try again")
        return
      }
      setFinished(true)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (finished) {
    return (
      <DoneCard
        staffId={staff.id}
        title={doc.title}
        message={`Both signatures are recorded for ${staff.name}. The executed form is kept permanently on their Documents tab.`}
        pending={false}
      />
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BackLink staffId={staff.id} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{pending.formTitle}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          For <strong>{staff.name}</strong> · Version {pending.formVersionNumber} · awaiting supervisor countersignature
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-[var(--color-warning-border,#f3d9a4)] bg-[var(--color-warning-bg,#fdf6e7)] px-4 py-3 text-sm text-[var(--color-warning-text,#8a6100)]">
        {staff.name} signed {format(new Date(pending.employeeSignedAt), "MMM d, yyyy 'at' h:mm a")} as
        &ldquo;{pending.employeeTypedName}&rdquo;. Their entries are locked — countersigning completes the form.
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-3">Submitted details</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {pending.values.map((v, i) => (
              <div key={i}>
                <dt className="text-[var(--color-muted-foreground)]">{v.label}</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{v.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={consented} onCheckedChange={(v) => setConsented(v === true)} className="mt-0.5" />
            <span className="text-sm text-[var(--color-foreground)]">
              <span className="inline-flex items-center gap-1.5 font-medium mb-1">
                <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
                Electronic signature consent
              </span>
              <br />
              {HR_ESIGN_CONSENT_TEXT}
            </span>
          </label>
        </section>

        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-1.5">
          <Label>
            <span className="inline-flex items-center gap-1.5">
              <PenLine className="h-4 w-4 text-[var(--color-primary)]" />
              Supervisor signature — type full legal name *
            </span>
          </Label>
          <Input
            value={supervisorTyped}
            onChange={(e) => setSupervisorTyped(e.target.value)}
            placeholder={supervisorName}
            disabled={!consented}
          />
        </section>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Saving..." : "Countersign & Complete"}
          </Button>
        </div>
      </form>
    </div>
  )
}

function DoneCard({
  staffId,
  title,
  message,
  pending,
}: {
  staffId: string
  title: string
  message: string
  pending: boolean
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <BackLink staffId={staffId} />
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
        <div
          className={`w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center ${
            pending ? "bg-amber-100" : "bg-[var(--color-success-bg,#e8f8ea)]"
          }`}
        >
          {pending ? (
            <Clock className="h-6 w-6 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-6 w-6 text-[var(--color-success,#25ba3b)]" />
          )}
        </div>
        <h1 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          {title} — {pending ? "awaiting countersignature" : "complete"}
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">{message}</p>
      </div>
    </div>
  )
}

function BackLink({ staffId }: { staffId: string }) {
  return (
    <Link
      href={`/staff/${staffId}`}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
    >
      <ArrowLeft className="h-4 w-4" />
      Staff Member
    </Link>
  )
}
