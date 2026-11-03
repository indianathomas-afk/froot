"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Link2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
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
import type { LabelOutput } from "@/lib/label-review"
import { ABANDONED_AFTER_DAYS, runBatch, type BatchResult, type BatchStep, type InboxStatus } from "@/lib/label-match"
import { IngredientPicker } from "./ingredient-picker"
import { LabelQueueCard, type Ask } from "./label-queue-card"

// N-1e — the label inbox (/nutrition/labels). ADMIN only. Rulings:
// docs/DECISIONS.md 2026-11-02 N-1e (Gary, DRAFT: "Accept all leans").
//   1. drop many files; each is a row (name, size, status) with an ingredient
//      SUGGESTED, never assigned (F2);
//   2. Read all / Read selected — one at a time inside N-1c's 30/hour, 300/day
//      limit, stopping cleanly at it with "N left — continue after …" (F3);
//      a failure is that row's alone;
//   3. the review queue, one card at a time (label-queue-card.tsx);
//   4. Add from link (the server fetches it — src/lib/safe-fetch.ts);
//   5. leftovers: open files 7+ days old, with "Discard all older than 7 days".
// Everything is persisted server-side as it happens (F1), so a closed tab
// loses nothing but the read in flight.

export type InboxIngredient = { id: string; name: string; brand: string | null }
export type InboxItem = {
  id: string
  status: InboxStatus
  fileName: string
  contentType: string
  sizeBytes: number
  sourceUrl: string | null
  suggestedIngredientId: string | null
  ingredientId: string | null
  readError: string | null
  createdAt: string
  ageDays: number
  applyBlocker: string | null
  read: { readId: string; readAt: string; reused: boolean; output: LabelOutput } | null
}

type Pending = { key: string; fileName: string; error: string | null }

const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heif",
}
const fileType = (f: File) => f.type || EXT_TYPES[f.name.split(".").pop()?.toLowerCase() ?? ""] || ""
const MAX_BYTES = 10 * 1024 * 1024
const HEIC_NOTE = "HEIC photos can't be read. Upload a JPG or PNG of the label (on iPhone: Share → Save as JPEG, or Settings → Camera → Formats → Most Compatible)."

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

const STATUS_TEXT: Record<InboxStatus, string> = { UPLOADED: "Not read", READ: "Read", FAILED: "Read failed", APPLIED: "Applied", DISCARDED: "Discarded" }
const STATUS_CLASS: Record<InboxStatus, string> = {
  UPLOADED: "text-[var(--color-muted-foreground)]",
  READ: "text-[#25ba3b]",
  FAILED: "text-[var(--color-destructive)]",
  APPLIED: "text-[#25ba3b]",
  DISCARDED: "text-[var(--color-muted-foreground)]",
}

type Confirm = { title: string; body: string; yes: string; no?: string; destructive?: boolean; resolve: (v: boolean | null) => void }

export function LabelInboxClient() {
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [ingredients, setIngredients] = useState<InboxIngredient[]>([])
  const [limit, setLimit] = useState<{ message: string; retryAt: string } | null>(null)
  const [readConfigured, setReadConfigured] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [link, setLink] = useState("")
  const [linkBusy, setLinkBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState<{ total: number; result: BatchResult } | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [queueAt, setQueueAt] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(
    () =>
      fetch("/api/nutrition/labels")
        .then(async (r) => {
          const body = await r.json().catch(() => ({}))
          if (!r.ok) {
            setLoadError(body.error ?? "Couldn't load the label inbox")
            return
          }
          setItems(body.items)
          setIngredients(body.ingredients)
          setLimit(body.limit)
          setReadConfigured(body.readConfigured)
        })
        .catch(() => setLoadError("Couldn't load the label inbox")),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  const ask: Ask = (q) => new Promise((resolve) => setConfirm({ ...q, resolve }))
  const askDestructive = (title: string, body: string, yes: string) =>
    new Promise<boolean | null>((resolve) => setConfirm({ title, body, yes, destructive: true, resolve }))

  const replace = (row: InboxItem) => setItems((xs) => (xs ? xs.map((x) => (x.id === row.id ? row : x)) : xs))
  const remove = (id: string) => {
    setItems((xs) => (xs ? xs.filter((x) => x.id !== id) : xs))
    setSelected((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
  }

  // ─── 1. Upload many files — one at a time, each its own row ────────────────
  async function uploadFiles(files: File[]) {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random()}`
      const fail = (error: string) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error } : x)))
      setPending((p) => [...p, { key, fileName: file.name, error: null }])
      const contentType = fileType(file)
      if (contentType === "image/heic" || contentType === "image/heif") { fail(HEIC_NOTE); continue }
      if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(contentType)) { fail("Only PDF, PNG, JPG or WEBP files"); continue }
      if (file.size > MAX_BYTES) { fail("File must be 10 MB or smaller"); continue }
      try {
        const urlRes = await fetch("/api/nutrition/labels/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType, sizeBytes: file.size }),
        })
        const urlData = await urlRes.json().catch(() => ({}))
        if (!urlRes.ok) { fail(urlData.error ?? "Couldn't start the upload"); continue }
        const putRes = await fetch(urlData.uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: file })
        const blob = await putRes.json().catch(() => ({}))
        if (!putRes.ok || !blob.url) { fail("The file upload failed — please try again"); continue }
        const reg = await fetch("/api/nutrition/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: blob.url, fileName: file.name }),
        })
        const row = await reg.json().catch(() => ({}))
        if (!reg.ok) { fail(row.error ?? "Couldn't add the file"); continue }
        setItems((xs) => [...(xs ?? []), row])
        setPending((p) => p.filter((x) => x.key !== key))
      } catch {
        fail("The file upload failed — please try again")
      }
    }
  }

  // ─── 4. Add from link ──────────────────────────────────────────────────────
  async function addFromLink() {
    if (!link.trim()) return
    setLinkBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/nutrition/labels/from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setMessage({ ok: false, text: body.error ?? "Couldn't fetch that link" })
      else {
        setItems((xs) => [...(xs ?? []), body])
        setLink("")
        setMessage({ ok: true, text: `Added ${body.fileName} from the link` })
      }
    } catch {
      setMessage({ ok: false, text: "Couldn't fetch that link" })
    } finally {
      setLinkBusy(false)
    }
  }

  // ─── Per-row actions ───────────────────────────────────────────────────────
  async function assign(item: InboxItem, ingredientId: string | null) {
    const res = await fetch(`/api/nutrition/labels/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setMessage({ ok: false, text: body.error ?? "Couldn't save the ingredient" })
    else replace(body)
  }

  async function discard(item: InboxItem): Promise<boolean> {
    const yes = await askDestructive("Discard this file?", `${item.fileName} is deleted. Any read of it is kept in the audit log only.`, "Discard")
    if (!yes) return false
    const res = await fetch(`/api/nutrition/labels/${item.id}`, { method: "DELETE" })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage({ ok: false, text: body.error ?? "Couldn't discard the file" })
      return false
    }
    remove(item.id)
    return true
  }

  async function readOne(id: string, fresh = false): Promise<BatchStep> {
    setRowBusy(id)
    try {
      const res = await fetch(`/api/nutrition/labels/${id}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fresh }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 429 && body.code === "RATE_LIMITED") {
        setLimit({ message: body.error, retryAt: body.retryAt })
        return { ok: false, limited: true, retryAt: body.retryAt, error: body.error }
      }
      if (!res.ok) {
        setItems((xs) => (xs ? xs.map((x) => (x.id === id ? { ...x, status: "FAILED", readError: body.error ?? "Read failed" } : x)) : xs))
        return { ok: false, limited: false, error: body.error ?? "Read failed" }
      }
      replace(body)
      return { ok: true }
    } catch {
      return { ok: false, limited: false, error: "Read failed" }
    } finally {
      setRowBusy(null)
    }
  }

  // ─── 2. Batch read: sequential, stops cleanly at the limit ─────────────────
  async function readMany(ids: string[]) {
    if (ids.length === 0) return
    setMessage(null)
    setBatch({ total: ids.length, result: { done: [], failed: [], left: ids, stoppedAt: null } })
    await runBatch(ids, (id) => readOne(id), (r) => setBatch({ total: ids.length, result: r }))
  }

  async function discardOld(count: number) {
    const yes = await askDestructive(
      `Discard ${count} file${count === 1 ? "" : "s"} older than ${ABANDONED_AFTER_DAYS} days?`,
      "They were never applied. The files are deleted.",
      "Discard all"
    )
    if (!yes) return
    const res = await fetch("/api/nutrition/labels/discard-old", { method: "POST" })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setMessage({ ok: false, text: body.error ?? "Couldn't discard the files" })
    else {
      setMessage({ ok: true, text: `Discarded ${body.discarded} file${body.discarded === 1 ? "" : "s"}` })
      await load()
    }
  }

  if (loadError) return <p className="text-sm text-[var(--color-destructive)]">{loadError}</p>

  const list = items ?? []
  const unread = list.filter((i) => i.status === "UPLOADED" || i.status === "FAILED")
  const selectedUnread = unread.filter((i) => selected.has(i.id))
  const queue = list.filter((i) => i.status === "READ")
  const old = list.filter((i) => i.ageDays >= ABANDONED_AFTER_DAYS)
  const running = batch !== null && batch.result.left.length > 0 && batch.result.stoppedAt === null
  const busy = running || rowBusy !== null

  // ─── 3. The review queue ───────────────────────────────────────────────────
  if (queueAt !== null) {
    const current = queue[Math.min(queueAt, queue.length - 1)]
    return (
      <div className="max-w-4xl space-y-4">
        <button onClick={() => setQueueAt(null)} className="inline-flex items-center text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          <ArrowLeft className="h-4 w-4 mr-1" /> Label inbox
        </button>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Review labels</h1>
        {message && <p className={`text-sm ${message.ok ? "text-[#25ba3b]" : "text-[var(--color-destructive)]"}`}>{message.text}</p>}
        {!current ? (
          <div className="rounded-lg border border-[var(--color-border)] p-6 text-center space-y-3">
            <p className="text-sm">No read labels left to review.</p>
            <Button onClick={() => setQueueAt(null)}>Back to the inbox</Button>
          </div>
        ) : (
          <LabelQueueCard
            key={current.id}
            item={current}
            ingredients={ingredients}
            position={Math.min(queueAt, queue.length - 1) + 1}
            total={queue.length}
            ask={ask}
            onAssign={(id) => assign(current, id)}
            onApplied={(text) => {
              setMessage({ ok: true, text })
              remove(current.id) // the file now belongs to the ingredient; the queue moves on
            }}
            onSkip={() => setQueueAt((i) => ((i ?? 0) + 1) % Math.max(1, queue.length))}
            onDiscard={() => {
              discard(current)
            }}
            onReadAgain={async () => {
              await readOne(current.id, true)
            }}
          />
        )}
        <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/nutrition/menu" className="inline-flex items-center text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-3">
          <ArrowLeft className="h-4 w-4 mr-1" /> Menu Nutrition
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Label inbox</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Drop many labels at once, read them, then step through each one and apply it to its ingredient. Froot suggests the ingredient; you confirm every one.
        </p>
      </div>

      {/* Drop zone + link */}
      <div
        className={`rounded-lg border-2 border-dashed p-5 text-center space-y-2 ${dragging ? "border-[oklch(65%_.2_35)] bg-[oklch(65%_.2_35)]/5" : "border-[var(--color-border)]"}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          uploadFiles([...e.dataTransfer.files])
        }}
      >
        <Upload className="h-6 w-6 mx-auto text-[var(--color-muted-foreground)]" />
        <p className="text-sm">Drop label files here, or</p>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>Choose files</Button>
        <p className="text-xs text-[var(--color-muted-foreground)]">PDF, PNG, JPG or WEBP, up to 10 MB each. HEIC photos can&apos;t be read — share them as JPEG.</p>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])]
            e.target.value = ""
            uploadFiles(fs)
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        <Input
          type="url"
          className="max-w-md"
          placeholder="https://… direct link to a label PDF or image"
          value={link}
          disabled={linkBusy}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFromLink()}
        />
        <Button variant="outline" size="sm" disabled={linkBusy || !link.trim()} onClick={addFromLink}>
          {linkBusy ? "Fetching…" : "Add from link"}
        </Button>
        <span className="text-xs text-[var(--color-muted-foreground)]">A product web page won&apos;t work — open it, save the label image, and upload it.</span>
      </div>

      {message && <p className={`text-sm ${message.ok ? "text-[#25ba3b]" : "text-[var(--color-destructive)]"}`}>{message.text}</p>}
      {!readConfigured && <p className="text-sm text-[#efa201]">Label reading isn&apos;t set up in this environment (ANTHROPIC_API_KEY is not set).</p>}

      {/* Batch controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !readConfigured || unread.length === 0} onClick={() => readMany(unread.map((i) => i.id))}>
          Read all ({unread.length})
        </Button>
        <Button variant="outline" disabled={busy || !readConfigured || selectedUnread.length === 0} onClick={() => readMany(selectedUnread.map((i) => i.id))}>
          Read selected ({selectedUnread.length})
        </Button>
        <Button variant="outline" disabled={busy || queue.length === 0} onClick={() => setQueueAt(0)}>
          Review read labels ({queue.length})
        </Button>
      </div>
      {batch && <BatchProgress batch={batch} />}
      {limit && !batch?.result.stoppedAt && <p className="text-xs text-[#efa201]">{limit.message}</p>}

      {/* Inbox table */}
      {items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : list.length === 0 && pending.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] p-6 text-center">
          <p className="text-sm">The inbox is empty.</p>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Drop your supplier spec sheets or label photos above to start verifying nutrition in a batch.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                <th className="p-2 w-8" />
                <th className="p-2 font-normal">File</th>
                <th className="p-2 font-normal">Status</th>
                <th className="p-2 font-normal">Ingredient</th>
                <th className="p-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.key} className="border-b border-[var(--color-border)] last:border-0 align-top">
                  <td className="p-2" />
                  <td className="p-2 truncate max-w-[16rem]">{p.fileName}</td>
                  <td className="p-2 text-xs" colSpan={2}>
                    {p.error ? <span className="text-[var(--color-destructive)]">{p.error}</span> : <Skeleton className="h-4 w-24" />}
                  </td>
                  <td className="p-2 text-right">
                    {p.error && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPending((xs) => xs.filter((x) => x.key !== p.key))}>Dismiss</Button>
                    )}
                  </td>
                </tr>
              ))}
              {list.map((i) => (
                <tr key={i.id} className="border-b border-[var(--color-border)] last:border-0 align-top">
                  <td className="p-2">
                    <Checkbox
                      checked={selected.has(i.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s)
                          if (v === true) n.add(i.id)
                          else n.delete(i.id)
                          return n
                        })
                      }
                    />
                  </td>
                  <td className="p-2">
                    <p className="truncate max-w-[16rem]" title={i.fileName}>{i.fileName}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {fmtSize(i.sizeBytes)}{i.sourceUrl ? " · from link" : ""}{i.ageDays > 0 ? ` · ${i.ageDays} day${i.ageDays === 1 ? "" : "s"} old` : ""}
                    </p>
                  </td>
                  <td className="p-2 text-xs">
                    {rowBusy === i.id ? <Skeleton className="h-4 w-20" /> : <span className={STATUS_CLASS[i.status]}>{STATUS_TEXT[i.status]}</span>}
                    {i.status === "FAILED" && i.readError && <p className="text-[var(--color-destructive)] max-w-[14rem]">{i.readError}</p>}
                    {i.read && <p className="text-[var(--color-muted-foreground)] max-w-[14rem] truncate">{`${i.read.output.brand} ${i.read.output.productName}`.trim()}</p>}
                  </td>
                  <td className="p-2">
                    <IngredientPicker item={i} ingredients={ingredients} disabled={busy} onAssign={(id) => assign(i, id)} />
                  </td>
                  <td className="p-2 text-right whitespace-nowrap space-x-1">
                    {(i.status === "UPLOADED" || i.status === "FAILED") && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy || !readConfigured} onClick={() => readOne(i.id)}>Read</Button>
                    )}
                    {i.status === "READ" && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setQueueAt(queue.findIndex((q) => q.id === i.id))}>Review</Button>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => discard(i)}>Discard</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Leftovers */}
      {old.length > 0 && (
        <div className="rounded-lg border border-[#efa201] p-3 space-y-2">
          <p className="text-sm font-medium">Left in the inbox</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {old.length} file{old.length === 1 ? " has" : "s have"} been here {ABANDONED_AFTER_DAYS}+ days without being applied or discarded.
          </p>
          <ul className="text-xs list-disc pl-5">
            {old.map((i) => <li key={i.id}>{i.fileName} — {i.ageDays} days</li>)}
          </ul>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => discardOld(old.length)}>
            Discard all older than {ABANDONED_AFTER_DAYS} days
          </Button>
        </div>
      )}

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

function BatchProgress({ batch }: { batch: { total: number; result: BatchResult } }) {
  const { done, failed, left, stoppedAt } = batch.result
  const finished = done.length + failed.length
  return (
    <div className="text-xs space-y-0.5">
      {left.length > 0 && !stoppedAt ? (
        <p>Reading {finished + 1} of {batch.total}…</p>
      ) : (
        <p>Read {done.length} of {batch.total}{failed.length ? ` · ${failed.length} failed` : ""}.</p>
      )}
      {stoppedAt && (
        <p className="text-[#efa201]">
          Stopped at the read limit. {left.length} left — continue after {fmtTime(stoppedAt.retryAt)}. Progress so far is saved.
        </p>
      )}
    </div>
  )
}

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm | null; onClose: () => void }) {
  const answer = (v: boolean | null) => {
    confirm?.resolve(v)
    onClose()
  }
  return (
    <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && answer(null)}>
      <AlertDialogContent>
        {confirm && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => answer(null)}>Cancel</AlertDialogCancel>
              {confirm.no && (
                <AlertDialogAction
                  onClick={() => answer(false)}
                  className="bg-transparent text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                >
                  {confirm.no}
                </AlertDialogAction>
              )}
              <AlertDialogAction
                onClick={() => answer(true)}
                className={confirm.destructive ? "bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90" : undefined}
              >
                {confirm.yes}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
