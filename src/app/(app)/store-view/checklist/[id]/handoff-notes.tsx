"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, Check, Loader2, Send, StickyNote, X } from "lucide-react"
import {
  MessageAttachments,
  ReactionBar,
  avatarColor,
  timeAgo,
  type FeedMessage,
} from "@/app/(app)/messages/messages-client"

// Checklist handoff notes (Phase I-14): the opener leaves a note for the
// closer, the closer for tomorrow's opener. Rendering + composing live here;
// date resolution is server-side (POST /api/checklists/[id]/handoff-messages).

export type HandoffTarget = { id: string; name: string; operationalPhase: string | null }

// Mirrors PHASE_ORDER in src/lib/messages.ts (server-only module — imports the
// Prisma runtime, so the map is duplicated here rather than imported).
const PHASE_ORDER: Record<string, number> = {
  "Before Opening": 0,
  "During the Day": 1, // canonical (what the template form writes)
  "During Hours": 1, // legacy rows from the original template import
  "After Closing": 2,
}
const order = (phase: string | null) => PHASE_ORDER[phase ?? ""] ?? 1

// ─── "Notes from the last shift" banner ───────────────────────────────────────

// A note that has gone unacknowledged well past when it was left reads as
// visibly stale so an old "we're out of mango" doesn't look like this morning's.
const STALE_AGE_MS = 2 * 86400000

export function HandoffBanner({ checklistId }: { checklistId: string }) {
  const [notes, setNotes] = useState<FeedMessage[] | null>(null)
  const [ackingId, setAckingId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/checklists/${checklistId}/handoff-messages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNotes(d?.messages ?? []))
      .catch(() => setNotes([]))
  }, [checklistId])

  async function acknowledge(id: string) {
    setAckingId(id)
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true }),
      })
      if (res.ok) setNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev)
    } finally {
      setAckingId(null)
    }
  }

  if (!notes || notes.length === 0) return null

  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-amber-700" />
        <h2 className="font-semibold text-amber-900 text-sm">Notes from the last shift</h2>
      </div>
      <div className="divide-y divide-amber-200/70">
        {notes.map((n) => {
          const stale = Date.now() - new Date(n.createdAt).getTime() > STALE_AGE_MS
          return (
            <div key={n.id} className={`px-4 py-3 ${stale ? "bg-amber-100/60" : ""}`}>
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 ${stale ? "opacity-60" : ""}`}
                  style={{ backgroundColor: avatarColor(n.author.name) }}
                >
                  {n.author.initial}
                </div>
                <p className="text-[13px] font-bold text-amber-950">{n.author.name}</p>
                <span className="text-xs text-amber-800/70">{timeAgo(n.createdAt)}</span>
                {stale && (
                  <span className="text-[10px] uppercase font-semibold tracking-wide text-amber-900 bg-amber-200 rounded-full px-2 py-0.5">
                    Still unacknowledged
                  </span>
                )}
              </div>
              <p className={`text-sm mt-1.5 whitespace-pre-wrap ${stale ? "text-amber-950/70" : "text-amber-950"}`}>{n.body}</p>
              <MessageAttachments attachments={n.attachments} />
              <div className="flex items-center justify-between gap-2 mt-1">
                <ReactionBar
                  message={n}
                  onChanged={(updated) => setNotes((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? prev)}
                />
                <button
                  onClick={() => acknowledge(n.id)}
                  disabled={ackingId === n.id}
                  className="flex items-center gap-1.5 min-h-[36px] px-3 rounded-md border border-amber-400 bg-white text-amber-900 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50 shrink-0"
                >
                  {ackingId === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Acknowledge
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── "Leave a note for the next shift" composer ───────────────────────────────

// Sentinel option value: no specific target checklist — the note is
// store-wide and surfaces on every checklist banner plus the dashboard.
const STORE_WIDE = "__everyone__"

export function HandoffComposer({
  checklistId,
  targets,
  sourcePhase,
}: {
  checklistId: string
  targets: HandoffTarget[]
  sourcePhase: string | null
}) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const sorted = [...targets].sort(
    (a, b) => order(a.operationalPhase) - order(b.operationalPhase) || a.name.localeCompare(b.name)
  )
  // Only the next cascading shifts are offered: later slots land today,
  // opening slots wrap to tomorrow. A note can never go backward — the labels
  // mirror the server's date resolution (resolvePostedForDate) exactly, so a
  // closer sees "Opener Checklist (tomorrow)", never an ambiguous bare name.
  const options = [
    ...sorted
      .filter((t) => order(t.operationalPhase) > order(sourcePhase))
      .map((t) => ({ id: t.id, label: `${t.name} (today)` })),
    ...sorted
      .filter((t) => order(t.operationalPhase) === 0)
      .map((t) => ({ id: t.id, label: `${t.name} (tomorrow)` })),
  ]
  // Default to the NEXT checklist in the day's sequence so the common case is
  // one tap + type + send; wraps to tomorrow's opener after closing.
  const [targetId, setTargetId] = useState(options[0]?.id ?? STORE_WIDE)
  const [body, setBody] = useState("")
  const [photo, setPhoto] = useState<{ kind: string; url: string; filename?: string | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  if (targets.length === 0) return null

  async function uploadPhoto(file: File) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/upload/message-attachment", { method: "POST", body: form })
      const d = await res.json()
      if (!res.ok) {
        setError(d?.error ?? "Upload failed")
        return
      }
      setPhoto(d)
    } finally {
      setUploading(false)
    }
  }

  async function send() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/checklists/${checklistId}/handoff-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postedToTemplateId: targetId === STORE_WIDE ? null : targetId,
          body,
          attachments: photo ? [photo] : [],
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d?.error ?? "Failed to send")
        return
      }
      setBody("")
      setPhoto(null)
      setOpen(false)
      setSent(true)
      setTimeout(() => setSent(false), 4000)
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 min-h-[44px] py-2.5 rounded-lg border border-dashed border-[var(--color-primary)]/50 text-[var(--color-primary)] text-sm font-medium hover:bg-[var(--color-primary)]/5 transition-colors"
      >
        <StickyNote className="h-4 w-4" />
        {sent ? "Note sent ✓ — leave another?" : "Leave a note for the next shift"}
      </button>
    )
  }

  return (
    <div className="border border-[var(--color-primary)]/30 rounded-lg bg-[var(--color-card)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--color-foreground)] flex items-center gap-1.5">
          <StickyNote className="h-4 w-4 text-[var(--color-primary)]" />
          Note for the next shift
        </p>
        <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-[var(--color-muted-foreground)] shrink-0">Post to</label>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="flex-1 min-h-[40px] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-sm"
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value={STORE_WIDE}>Everyone (store-wide)</option>
        </select>
      </div>

      <textarea
        rows={3}
        maxLength={2000}
        placeholder="Anything the next shift should know?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm"
      />

      {photo && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="w-10 h-10 rounded object-cover" />
          <span className="truncate flex-1">{photo.filename ?? "Photo"}</span>
          <button onClick={() => setPhoto(null)} className="hover:text-[var(--color-destructive)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadPhoto(f)
            e.target.value = ""
          }}
        />
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 min-h-[40px] px-3 rounded-md border border-[var(--color-border)] text-sm text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Photo
        </button>
        <span className="flex-1" />
        <button
          onClick={send}
          disabled={sending || uploading || !body.trim() || !targetId}
          className="flex items-center gap-1.5 min-h-[40px] px-4 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </button>
      </div>
    </div>
  )
}
