"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, ChevronDown, ChevronUp, Link2, Plus, Trash2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  FORM_FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  HR_CATEGORY_LABELS,
  HR_DOCUMENT_CATEGORIES,
  type FormFieldType,
  type HrDocumentCategory,
} from "@/lib/hr-documents"

interface BuilderField {
  label: string
  fieldType: string
  required: boolean
  options: string[] | null
}

// Local editing row — options edited as comma-separated text, parsed on save.
interface EditRow {
  key: number
  label: string
  fieldType: FormFieldType
  required: boolean
  optionsText: string
}

export function FormBuilderClient({
  doc,
  fields,
  currentVersion,
  versions,
  linked,
  pairable,
}: {
  doc: { id: string; title: string; category: string; bodyText: string; isActive: boolean }
  fields: BuilderField[]
  currentVersion: { versionNumber: number; fileHash: string; submissionCount: number }
  versions: {
    versionNumber: number
    fileHash: string
    isCurrent: boolean
    createdAt: string
    submissionCount: number
  }[]
  linked: { id: string; title: string } | null
  pairable: { id: string; title: string }[]
}) {
  const router = useRouter()
  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState(doc.category as HrDocumentCategory)
  const [bodyText, setBodyText] = useState(doc.bodyText)
  const [rows, setRows] = useState<EditRow[]>(
    fields.map((f, i) => ({
      key: i,
      label: f.label,
      fieldType: (FORM_FIELD_TYPES as readonly string[]).includes(f.fieldType)
        ? (f.fieldType as FormFieldType)
        : "Text",
      required: f.required,
      optionsText: f.options?.join(", ") ?? "",
    }))
  )
  const [nextKey, setNextKey] = useState(fields.length)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const willMintVersion = currentVersion.submissionCount > 0

  function updateRow(key: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function moveRow(key: number, dir: -1 | 1) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function addRow() {
    setRows((rs) => [...rs, { key: nextKey, label: "", fieldType: "Text", required: true, optionsText: "" }])
    setNextKey((k) => k + 1)
  }

  async function handleSave() {
    setError("")
    setNotice("")
    for (const row of rows) {
      if (!row.label.trim()) {
        setError("Every field needs a label")
        return
      }
      if (row.fieldType === "Select" && row.optionsText.split(",").filter((o) => o.trim()).length < 2) {
        setError(`Dropdown field "${row.label}" needs at least 2 comma-separated options`)
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/hr/forms/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          category,
          bodyText,
          fields: rows.map((r) => ({
            label: r.label.trim(),
            fieldType: r.fieldType,
            required: r.required,
            ...(r.fieldType === "Select"
              ? { options: r.optionsText.split(",").map((o) => o.trim()).filter(Boolean) }
              : {}),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save the form")
        return
      }
      setNotice(
        data.version?.minted
          ? `Saved as version ${data.version.versionNumber} — earlier submissions stay pinned to the version they signed.`
          : "Saved."
      )
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/hr/forms"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Agreement Forms
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{doc.title}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Version {currentVersion.versionNumber} ·{" "}
            <span className="font-mono" title={`definition sha256 ${currentVersion.fileHash}`}>
              sha256 {currentVersion.fileHash.slice(0, 12)}…
            </span>{" "}
            · {currentVersion.submissionCount}{" "}
            {currentVersion.submissionCount === 1 ? "submission" : "submissions"}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Form"}
        </Button>
      </div>

      {willMintVersion && (
        <div className="mb-6 rounded-lg border border-[var(--color-warning-border,#f3d9a4)] bg-[var(--color-warning-bg,#fdf6e7)] px-4 py-3 text-sm text-[var(--color-warning-text,#8a6100)]">
          Version {currentVersion.versionNumber} has been signed — changing the agreement text or
          fields creates version {currentVersion.versionNumber + 1}. Existing submissions stay
          pinned to the version they signed.
        </div>
      )}
      {notice && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="space-y-6">
        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Form</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as HrDocumentCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HR_DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{HR_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Agreement text</Label>
            <Textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={10}
              placeholder={"The fixed language of the agreement, e.g.\n\nI understand that I am being issued a key to my assigned store and that a $50 per key fee will be deducted from my final paycheck for any key not returned..."}
            />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Shown above the fields exactly as written, and reproduced verbatim on the signed PDF.
            </p>
          </div>
        </section>

        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Fields</h2>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                The blanks filled in when the form is executed, in order.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" />
              Add Field
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)] py-4 text-center">
              No fields yet — add the blanks to collect (Date, Name, Employee ID...).
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((row, i) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-[var(--color-border)] p-3 space-y-3"
                >
                  <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => moveRow(row.key, -1)}
                        disabled={i === 0}
                        className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRow(row.key, 1)}
                        disabled={i === rows.length - 1}
                        className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-[10rem]">
                      <Input
                        value={row.label}
                        onChange={(e) => updateRow(row.key, { label: e.target.value })}
                        placeholder={`Field ${i + 1} label`}
                      />
                    </div>
                    <div className="w-32 shrink-0">
                      <Select
                        value={row.fieldType}
                        onValueChange={(v) => updateRow(row.key, { fieldType: v as FormFieldType })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORM_FIELD_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{FORM_FIELD_TYPE_LABELS[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-foreground)] cursor-pointer shrink-0 pt-2.5">
                      <Checkbox
                        checked={row.required}
                        onCheckedChange={(v) => updateRow(row.key, { required: v === true })}
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      className="p-1.5 rounded hover:bg-[var(--color-accent)] shrink-0 mt-1"
                      title="Remove field"
                    >
                      <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                    </button>
                  </div>
                  {row.fieldType === "Select" && (
                    <div className="space-y-1">
                      <Input
                        value={row.optionsText}
                        onChange={(e) => updateRow(row.key, { optionsText: e.target.value })}
                        placeholder="Options, comma-separated — e.g. Store key, Office key, Safe key"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <PairingCard docId={doc.id} linked={linked} pairable={pairable} />

        <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-3">Versions</h2>
          <div className="divide-y divide-[var(--color-border)]">
            {versions.map((v) => (
              <div key={v.versionNumber} className="flex items-center gap-3 py-2 text-sm flex-wrap">
                <span className="font-medium text-[var(--color-foreground)] w-10">v{v.versionNumber}</span>
                {v.isCurrent && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                    Current
                  </span>
                )}
                <span className="font-mono text-xs text-[var(--color-muted-foreground)]" title={v.fileHash}>
                  sha256 {v.fileHash.slice(0, 12)}…
                </span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {format(new Date(v.createdAt), "MMM d, yyyy")} · {v.submissionCount}{" "}
                  {v.submissionCount === 1 ? "submission" : "submissions"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Form"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Check-Out ↔ Check-In pairing. Links are symmetric — the API writes both
// documents — so the pair renders together wherever either side appears.
function PairingCard({
  docId,
  linked,
  pairable,
}: {
  docId: string
  linked: { id: string; title: string } | null
  pairable: { id: string; title: string }[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function setLink(linkedFormId: string | null) {
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/forms/${docId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedFormId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to update the pairing")
        return
      }
      setSelected("")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-1">
        Check-Out / Check-In pairing
      </h2>
      <p className="text-xs text-[var(--color-muted-foreground)] mb-3">
        Pair two forms that record the two halves of one cycle (e.g. key issued / key returned) —
        they appear together on each staff member&apos;s Documents tab.
      </p>
      {linked ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
            <Link2 className="h-3.5 w-3.5" />
            Paired with {linked.title}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setLink(null)} disabled={busy}>
            <Unlink className="h-3.5 w-3.5" />
            {busy ? "Unpairing..." : "Unpair"}
          </Button>
        </div>
      ) : pairable.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No other unpaired forms yet — create the counterpart form first.
        </p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-72 max-w-full">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger>
                <SelectValue placeholder="Choose the counterpart form..." />
              </SelectTrigger>
              <SelectContent>
                {pairable.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected || busy}
            onClick={() => setLink(selected)}
          >
            <Link2 className="h-3.5 w-3.5" />
            {busy ? "Pairing..." : "Pair"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-[var(--color-destructive)] mt-2">{error}</p>}
    </section>
  )
}
