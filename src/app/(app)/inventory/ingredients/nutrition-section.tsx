"use client"

import { useEffect, useRef, useState } from "react"
import type { Allergen, NutritionStatus } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ALLERGENS, NUTRIENTS, allergenLabel, allowedBasisUnits, type NutrientKey } from "@/lib/nutrition"
import { PROOF_LABEL, type ProofState } from "@/lib/nutrition-proof"
import { buildLabelReview, parseLabelOutput, type LabelReview } from "@/lib/label-review"
import { LabelReadReview, type ReviewedValues } from "./label-read-review"

// N-1 deliverable 7: nutrition, allergens and the not-food flag, as a section
// of the ingredient dialog (F6). It loads and saves through
// /api/nutrition/ingredients/[id] — never the inventory PATCH — because only
// ADMIN edits nutrition (F3) while MANAGER may edit the rest of the dialog.
// A non-admin sees it read-only. Its own Save, so the two writes never depend
// on each other.
//
// N-1b deliverable 5: the record's proof — a source link and one label
// document — and its Estimated/Verified status. The SERVER decides when a save
// touches a verified record and answers 409 with a code; this component turns
// the code into the question (Gary, F3 "Still verified?") and re-sends with the
// answer.
//
// N-1d (Gary, 2026-11-02, DRAFT), superseding N-1b F6 and F7: proof works on
// any food ingredient, numbers or not (N1D-F1). A record with proof and no
// numbers is "No nutrition". Clearing the numbers keeps the document and the
// link (F1a), so there is no "clear the proof?" question any more; the file
// goes only with Remove. Verified needs the label document — the link is
// reference only (F2).
//
// N-1c: "Read label" (ADMIN, a document attached, not HEIC) reads it and opens
// the side-by-side review (label-read-review.tsx). Gary, 2026-11-02: "Read
// label is a button only; never read on upload."

type LabelDoc = {
  fileName: string | null
  contentType: string | null
  sizeBytes: number | null
  uploadedAt: string | null
  downloadOnly: boolean
}

type Loaded = {
  name: string
  brand: string | null
  kind: string
  reportingUnit: string
  nutritionExempt: boolean
  allergens: Allergen[]
  nutrition:
    | ({
        // null on a proof-only record (N1D-F1)
        basisAmount: number | null
        basisUnit: string | null
        sourceNote: string | null
        sourceUrl: string | null
        status: NutritionStatus
        proof: ProofState
        verifiedAt: string | null
        verifiedByName: string | null
        staleAt: string | null
        label: LabelDoc | null
      } & Record<NutrientKey, number | null>)
    | null
}

type Form = {
  exempt: boolean
  allergens: Set<Allergen>
  basisAmount: string
  basisUnit: string
  values: Record<NutrientKey, string>
  sourceNote: string
  sourceUrl: string
}

function toForm(d: Loaded): Form {
  return {
    exempt: d.nutritionExempt,
    allergens: new Set(d.allergens),
    basisAmount: d.nutrition?.basisAmount != null ? String(d.nutrition.basisAmount) : "",
    basisUnit: d.nutrition?.basisUnit ?? d.reportingUnit,
    values: Object.fromEntries(NUTRIENTS.map((n) => [n.key, d.nutrition?.[n.key] == null ? "" : String(d.nutrition[n.key])])) as Record<NutrientKey, string>,
    sourceNote: d.nutrition?.sourceNote ?? "",
    sourceUrl: d.nutrition?.sourceUrl ?? "",
  }
}

const formKey = (f: Form) => JSON.stringify({ ...f, allergens: [...f.allergens].sort() })

// Some browsers report "" for .heic — map by extension so the presigned PUT
// is signed for the right type.
const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", heic: "image/heic", heif: "image/heif",
}
function labelContentType(file: File): string {
  return file.type || EXT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] || ""
}

const PROOF_CLASS: Record<ProofState, string> = {
  NONE: "text-[var(--color-muted-foreground)]",
  ESTIMATED: "text-[var(--color-muted-foreground)]",
  VERIFIED: "text-[#25ba3b]",
  STALE: "text-[#efa201]",
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "")
const fmtSize = (b: number | null) => (b === null ? "" : b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

type Question =
  | { kind: "still-verified"; answer: (keep: boolean) => void }
  | { kind: "remove-label"; answer: () => void }

export function NutritionSection({
  ingredientId,
  canEdit,
  onSaved,
}: {
  ingredientId: string
  canEdit: boolean
  onSaved: () => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<{ readId: string; readAt: string; reused: boolean; review: LabelReview } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/nutrition/ingredients/${ingredientId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setLoadError(body.error ?? "Couldn't load nutrition")
        else {
          setData(body)
          setForm(toForm(body))
        }
      })
      .catch(() => !cancelled && setLoadError("Couldn't load nutrition"))
    return () => {
      cancelled = true
    }
  }, [ingredientId])

  if (loadError) return <p className="text-xs text-[var(--color-destructive)]">{loadError}</p>
  if (!data || !form) return <Skeleton className="h-24 w-full" />

  if (data.kind === "PREPARED") {
    return (
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Prepared ingredient — its nutrition and allergens are computed from its recipe.
      </p>
    )
  }

  const blank = form.basisAmount.trim() === "" && NUTRIENTS.every((n) => form.values[n.key].trim() === "")
  const disabled = !canEdit || saving
  const dirty = formKey(form) !== formKey(toForm(data))
  const n = data.nutrition
  const proof: ProofState = n?.proof ?? "NONE"
  // N1D-F1: proof is open on every food ingredient; only not-food is locked.
  const proofLocked = data.nutritionExempt
  const savedHasNumbers = n?.basisAmount != null
  const savedHasDocument = Boolean(n?.label)
  const labelHref = `/api/nutrition/ingredients/${ingredientId}/label`

  // Apply a successful response; returns false (and shows the error) otherwise.
  // A 409 with a known code becomes a question instead.
  async function handle(res: Response, okText: string, retry: { stillVerified?: (keep: boolean) => void }): Promise<boolean> {
    const body = await res.json().catch(() => ({}))
    if (res.status === 409 && body.code === "CONFIRM_STILL_VERIFIED" && retry.stillVerified) {
      setQuestion({ kind: "still-verified", answer: retry.stillVerified })
      return false
    }
    if (!res.ok) {
      setMessage({ ok: false, text: body.error ?? "Save failed" })
      return false
    }
    setData(body)
    setForm(toForm(body))
    setMessage({ ok: true, text: okText })
    onSaved()
    return true
  }

  async function run(fn: () => Promise<void>) {
    setSaving(true)
    setMessage(null)
    try {
      await fn()
    } finally {
      setSaving(false)
    }
  }

  function save(answers: { keepVerified?: boolean } = {}) {
    if (!form) return
    run(async () => {
      const nutrition = blank
        ? null
        : {
            basisAmount: Number(form.basisAmount),
            basisUnit: form.basisUnit,
            values: Object.fromEntries(
              NUTRIENTS.map((nt) => [nt.key, form.values[nt.key].trim() === "" ? null : Number(form.values[nt.key])])
            ),
            sourceNote: form.sourceNote.trim() || null,
          }
      const res = await fetch(`/api/nutrition/ingredients/${ingredientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nutrition,
          // N1D-F1b: the link saves with or without numbers.
          ...(!proofLocked && { sourceUrl: form.sourceUrl.trim() || null }),
          allergens: [...form.allergens],
          nutritionExempt: form.exempt,
          ...answers,
        }),
      })
      await handle(res, "Nutrition saved", { stillVerified: (keep) => save({ ...answers, keepVerified: keep }) })
    })
  }

  function setVerified(verified: boolean) {
    run(async () => {
      const res = await fetch(`/api/nutrition/ingredients/${ingredientId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified }),
      })
      await handle(res, verified ? "Marked verified" : "Marked estimated", {})
    })
  }

  function upload(file: File) {
    run(async () => {
      const contentType = labelContentType(file)
      const urlRes = await fetch(`${labelHref}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType, sizeBytes: file.size }),
      })
      const urlData = await urlRes.json().catch(() => ({}))
      if (!urlRes.ok) {
        setMessage({ ok: false, text: urlData.error ?? "Couldn't start the upload" })
        return
      }
      const putRes = await fetch(urlData.uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: file })
      // The PUT returns the stored blob's real URL (with the store's suffix).
      const blob = await putRes.json().catch(() => ({}))
      if (!putRes.ok || !blob.url) {
        setMessage({ ok: false, text: "The file upload failed — please try again" })
        return
      }
      const register = (keepVerified?: boolean): Promise<void> =>
        fetch(labelHref, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: blob.url, fileName: file.name, ...(keepVerified !== undefined && { keepVerified }) }),
        }).then(async (res) => {
          if (await handle(res, "Label document saved", { stillVerified: (keep) => run(() => register(keep)) })) setRead(null)
        })
      await register()
    })
  }

  // N1D-F2: removing the document always resets a verified record; never asked.
  function removeLabel() {
    run(async () => {
      const res = await fetch(labelHref, { method: "DELETE" })
      if (await handle(res, "Label document removed", {})) setRead(null)
    })
  }

  // N-1c: read the attached label, then review it side by side. Reading writes
  // nothing; Apply is a normal PUT carrying `appliedFromRead` for the audit row.
  function readLabel(fresh = false) {
    if (!data) return
    const snapshot = data
    setReading(true)
    setMessage(null)
    fetch(`${labelHref}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fresh }) })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setMessage({ ok: false, text: body.error ?? "Reading the label failed" })
          return
        }
        const parsed = parseLabelOutput(body.output)
        if (!parsed.ok) {
          setMessage({ ok: false, text: parsed.error })
          return
        }
        const sn = snapshot.nutrition
        // A proof-only record has no numbers to compare against (N1D-F1).
        const stored = sn && sn.basisAmount !== null && sn.basisUnit !== null
          ? { basisAmount: sn.basisAmount, basisUnit: sn.basisUnit, values: Object.fromEntries(NUTRIENTS.map((nt) => [nt.key, sn[nt.key]])) as Record<NutrientKey, number | null> }
          : null
        setRead({
          readId: body.readId,
          readAt: body.readAt,
          reused: Boolean(body.reused),
          review: buildLabelReview(parsed.output, snapshot, stored),
        })
      })
      .catch(() => setMessage({ ok: false, text: "Reading the label failed" }))
      .finally(() => setReading(false))
  }

  // F2 (Gary, 2026-11-02): "'Apply & mark verified' as the main button, 'Apply only' as secondary."
  function applyRead(v: ReviewedValues, verify: boolean, keepVerified?: boolean) {
    if (!read || !data) return
    const readId = read.readId
    run(async () => {
      const res = await fetch(`/api/nutrition/ingredients/${ingredientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nutrition: {
            basisAmount: v.basisAmount,
            basisUnit: v.basisUnit,
            values: v.values,
            sourceNote: data.nutrition?.sourceNote ?? null,
          },
          allergens: v.allergens,
          nutritionExempt: data.nutritionExempt,
          // The record is re-verified from the label straight after, so a verified
          // record's "Still verified?" is answered here: reset, then verify.
          ...(verify ? { keepVerified: false } : keepVerified !== undefined && { keepVerified }),
          appliedFromRead: { readId, intent: verify ? "apply-and-verify" : "apply-only", edited: v.edited, nameWarningAcknowledged: v.nameWarningAcknowledged },
        }),
      })
      const saved = await handle(res, "Label applied", { stillVerified: (keep) => applyRead(v, verify, keep) })
      if (!saved) return
      setRead(null)
      if (verify) {
        const vr = await fetch(`/api/nutrition/ingredients/${ingredientId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verified: true }),
        })
        if (!(await handle(vr, "Label applied and marked verified", {}))) {
          setMessage({ ok: false, text: "The label was applied, but marking it verified failed — use Mark verified." })
        }
      }
    })
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox id="nutrition-exempt" checked={form.exempt} disabled={disabled} onCheckedChange={(v) => set({ exempt: v === true })} />
        <Label htmlFor="nutrition-exempt" className="text-sm font-normal">
          Not food — cups, lids, napkins, supplies. Never counted and never makes an item incomplete.
        </Label>
      </div>

      <div>
        <Label className="mb-1 block">Contains</Label>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          {ALLERGENS.map((a) => (
            <div key={a.value} className="flex items-center gap-1.5">
              <Checkbox
                id={`allergen-${a.value}`}
                checked={form.allergens.has(a.value)}
                disabled={disabled}
                onCheckedChange={(v) => {
                  const next = new Set(form.allergens)
                  if (v === true) next.add(a.value)
                  else next.delete(a.value)
                  set({ allergens: next })
                }}
              />
              <Label htmlFor={`allergen-${a.value}`} className="text-xs font-normal">{allergenLabel(a.value)}</Label>
            </div>
          ))}
        </div>
      </div>

      <div className={form.exempt ? "opacity-60" : undefined}>
        {form.exempt && <p className="text-xs text-[var(--color-muted-foreground)] mb-2">Ignored while marked not food.</p>}
        <div className="flex items-end gap-2 mb-2">
          <div className="w-24">
            <Label>Per</Label>
            <Input type="number" value={form.basisAmount} disabled={disabled} onChange={(e) => set({ basisAmount: e.target.value })} />
          </div>
          <div className="w-32">
            <Select value={form.basisUnit} disabled={disabled} onValueChange={(v) => set({ basisUnit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowedBasisUnits(data.reportingUnit).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] pb-2">Leave a value blank if it&apos;s unknown.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {NUTRIENTS.map((nt) => (
            <div key={nt.key}>
              <Label className="text-xs">{nt.label} ({nt.unit})</Label>
              <Input
                type="number"
                min={0}
                value={form.values[nt.key]}
                disabled={disabled}
                onChange={(e) => set({ values: { ...form.values, [nt.key]: e.target.value } })}
              />
            </div>
          ))}
        </div>
        <div className="mt-2">
          <Label className="text-xs">Source note</Label>
          <Input placeholder="label, USDA FDC #…, supplier spec" value={form.sourceNote} disabled={disabled} onChange={(e) => set({ sourceNote: e.target.value })} />
        </div>
      </div>

      {/* N-1b: proof and status */}
      <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="block">Proof</Label>
          <span className={`text-xs font-medium ${PROOF_CLASS[proof]}`}>
            {PROOF_LABEL[proof]}
            {n?.status === "VERIFIED" && n.verifiedAt && (
              <span className="font-normal text-[var(--color-muted-foreground)]">
                {" "}· {fmtDate(n.verifiedAt)}{n.verifiedByName ? ` by ${n.verifiedByName}` : ""}
              </span>
            )}
          </span>
        </div>
        {proof === "STALE" && (
          <p className="text-xs text-[#efa201]">Verified over 12 months ago — check the label again, then mark it verified to restart the clock.</p>
        )}
        {proofLocked ? (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Not-food items carry no nutrition label.
          </p>
        ) : (
          <>
            <div>
              <Label className="text-xs">Source link</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="url"
                  placeholder="https://… product page or spec sheet"
                  value={form.sourceUrl}
                  disabled={disabled}
                  onChange={(e) => set({ sourceUrl: e.target.value })}
                />
                {n?.sourceUrl && (
                  <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline shrink-0">Open</a>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs">Label document</Label>
              {n?.label ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="truncate max-w-[16rem]" title={n.label.fileName ?? undefined}>{n.label.fileName}</span>
                  <span className="text-[var(--color-muted-foreground)]">{fmtSize(n.label.sizeBytes)} · {fmtDate(n.label.uploadedAt)}</span>
                  <a href={labelHref} target="_blank" rel="noopener noreferrer" className="underline">
                    {n.label.downloadOnly ? "Download" : "View"}
                  </a>
                  {canEdit && (
                    <>
                      <Button size="sm" disabled={saving || reading || dirty || n.label.downloadOnly} onClick={() => readLabel()}>
                        {reading ? "Reading label…" : "Read label"}
                      </Button>
                      <Button variant="outline" size="sm" disabled={saving} onClick={() => fileInput.current?.click()}>Replace</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => setQuestion({ kind: "remove-label", answer: () => removeLabel() })}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              ) : canEdit ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={saving} onClick={() => fileInput.current?.click()}>Upload label</Button>
                  <span className="text-xs text-[var(--color-muted-foreground)]">PDF, PNG, JPG, WEBP or HEIC, up to 10 MB</span>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-muted-foreground)]">No label document.</p>
              )}
              {canEdit && n?.label?.downloadOnly && (
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                  HEIC photos can&apos;t be read. To read this label, upload a JPG or PNG (on iPhone: Share → Save as JPEG, or Settings → Camera → Formats → Most Compatible).
                </p>
              )}
              {canEdit && n?.label && !n.label.downloadOnly && dirty && (
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Save your changes first, then read the label.</p>
              )}
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ""
                  if (f) upload(f)
                }}
              />
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {proof !== "VERIFIED" && (
                  <Button size="sm" disabled={saving || dirty || !savedHasNumbers || !savedHasDocument} onClick={() => setVerified(true)}>
                    {proof === "STALE" ? "Re-verify" : "Mark verified"}
                  </Button>
                )}
                {n?.status === "VERIFIED" && (
                  <Button variant="outline" size="sm" disabled={saving} onClick={() => setVerified(false)}>Mark estimated</Button>
                )}
                {proof !== "VERIFIED" && (
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {dirty
                      ? "Save your changes first."
                      : !savedHasNumbers
                        ? "Save the nutrition numbers to verify them."
                        : !savedHasDocument
                          ? "Upload the label document to verify — a source link alone isn't enough."
                          : "Checked against the real label?"}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {reading && <Skeleton className="h-40 w-full" />}
      {read && !reading && (
        <LabelReadReview
          key={read.readId}
          review={read.review}
          reportingUnit={data.reportingUnit}
          hasStored={savedHasNumbers}
          readAt={read.readAt}
          reused={read.reused}
          busy={saving}
          onApply={(v, verify) => applyRead(v, verify)}
          onReadAgain={() => readLabel(true)}
          onDiscard={() => setRead(null)}
        />
      )}

      {message && <p className={`text-xs ${message.ok ? "text-[#25ba3b]" : "text-[var(--color-destructive)]"}`}>{message.text}</p>}
      {canEdit ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => save()} disabled={saving}>{saving ? "Saving..." : "Save nutrition"}</Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-muted-foreground)]">Only admins can edit nutrition.</p>
      )}

      <AlertDialog open={question !== null} onOpenChange={(o) => !o && setQuestion(null)}>
        <AlertDialogContent>
          {question?.kind === "still-verified" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Still verified?</AlertDialogTitle>
                <AlertDialogDescription>
                  This nutrition was verified against a real label. Does it still match the label after this change?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { setQuestion(null); question.answer(false) }} className="bg-transparent text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-muted)]">
                  Mark estimated
                </AlertDialogAction>
                <AlertDialogAction onClick={() => { setQuestion(null); question.answer(true) }}>Still verified</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {question?.kind === "remove-label" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the label document?</AlertDialogTitle>
                <AlertDialogDescription>
                  The file is deleted. {n?.status === "VERIFIED" ? "It's the proof this nutrition was verified against, so it goes back to Estimated." : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { setQuestion(null); question.answer() }} className="bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
