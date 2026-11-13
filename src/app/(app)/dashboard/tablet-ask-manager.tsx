"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, ClipboardCheck, Mail, MessageCircleQuestion, Send, TriangleAlert, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  HELP_NOTE_MAX,
  HELP_WINDOW_MS,
  HELP_REASONS,
  NOT_LISTED_NAME,
  recipientsPhrase,
  type HelpReasonKey,
  type TabletHelp,
  type TabletHelpRecent,
} from "@/lib/help-request-shared"
import type { TabletStaff, TabletTask, TaskHowTo } from "./tablet-data"

// ─── TAB-16 — A4, the "Ask a manager" sheet (Tablet mode only) ───────────────
// Rulings: docs/DECISIONS.md 2026-11-12 TAB-16 R1–R10 (Gary).
//
// Opens over the How-to panel, the expanded row or the full-screen player
// (z-[60], above the player's z-50). TasksPanel owns it: its open state is part
// of the "tasks:sheet" busy flag (TAB-5 holds refreshes while it is up) and it
// closes with the How-to it was opened from, which the TAB-9 idle closes
// (15 minutes while a How-to is open — TAB-15 ruling).
//
// WHAT IT SENDS: ids only — store (the URL), checklist, task, the asker (or
// null for "Not listed", R4), the reason key, the note, the ticked contact ids.
// Managers are never sent and never shown by address (R3): the server resolves
// them. Every check the sheet makes is made again on the server.
//
// AFTER SEND: when everyone it was meant for really got the email (or emails
// are off) the sheet just closes and the caller shows "Help sent · …". When
// anything didn't go out — a failure (R9) or a dry run / sandbox hold (R10) —
// it stays open on a result view that says so. A duplicate inside R5's window
// shows when the first went and who got it.

type Result =
  /** Opened from "Help sent": what went, and when the window ends. */
  | { kind: "already"; createdAt: string; askerName: string; label: string; warn: boolean }
  /** The server found a request inside R5's window (another tablet, a race). */
  | { kind: "duplicate"; createdAt: string; askerName: string; label: string; warn: boolean }
  | { kind: "missed"; createdAt: string; askerName: string; label: string; warn: boolean }

/** "9:44 AM" in the store's zone. */
function timeIn(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
}

function trainingLine(h: TaskHowTo | null): string | null {
  if (!h) return null
  if (h.video && h.doc) return "Video + guide attached"
  if (h.video) return "Video attached"
  if (h.doc) return "Guide attached"
  return null
}

const PILL =
  "flex min-h-14 items-center gap-2.5 rounded-full border-2 px-4 text-lg font-semibold transition-colors"

export function AskManagerSheet({
  storeId,
  storeName,
  timeZone,
  checklistId,
  checklistName,
  task,
  staff,
  help,
  sent,
  onClose,
  onSent,
}: {
  storeId: string
  storeName: string
  timeZone: string
  checklistId: string
  checklistName: string
  task: TabletTask
  staff: TabletStaff[]
  help: TabletHelp | undefined
  /** A request for this task still inside R5's window — the sheet opens on it. */
  sent: TabletHelpRecent | null
  onClose: () => void
  onSent: (recent: TabletHelpRecent) => void
}) {
  const emailsOn = help?.emailsOn ?? false
  const managerCount = help?.managerCount ?? 0
  const contacts = useMemo(() => help?.contacts ?? [], [help])

  // undefined = nobody picked yet; null = "Not listed" (R4).
  const [asker, setAsker] = useState<string | null | undefined>(undefined)
  const [reason, setReason] = useState<HelpReasonKey | null>(null)
  const [note, setNote] = useState("")
  // R3: default contacts start ticked and can be unticked.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(contacts.filter((c) => c.isDefault).map((c) => c.id)))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(
    sent ? { kind: "already", createdAt: sent.createdAt, askerName: sent.askerName, label: sent.label, warn: sent.warn } : null
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, sending])

  const managersRow = emailsOn && managerCount > 0
  const recipients = emailsOn ? (managersRow ? 1 : 0) + ticked.size : 0
  const canSend = asker !== undefined && (!emailsOn || recipients > 0) && !sending
  const phrase = recipientsPhrase(storeName, managersRow, ticked.size)

  async function send() {
    if (!canSend) return
    setSending(true)
    setError(null)
    const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/help-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checklistId,
        taskId: task.id,
        askerStaffId: asker ?? null,
        reason,
        note,
        contactIds: emailsOn ? [...ticked] : [],
      }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as
      | { error?: string; duplicate?: boolean; createdAt?: string; askerName?: string; label?: string; allSent?: boolean }
      | null
    setSending(false)
    if (!res?.ok || !body || !body.createdAt || !body.label) {
      // Nothing was posted (the route writes nothing before its checks pass, and
      // a network failure is unknown) — say so and keep everything as typed.
      setError(body?.error ?? "Couldn't send. Check the connection and try again.")
      return
    }
    const askerName =
      body.askerName ?? (asker ? staff.find((s) => s.id === asker)?.displayName ?? NOT_LISTED_NAME : NOT_LISTED_NAME)
    const recent: TabletHelpRecent = {
      taskId: task.id,
      createdAt: body.createdAt,
      label: body.label,
      askerName,
      warn: body.allSent === false,
    }
    onSent(recent)
    if (body.duplicate) setResult({ kind: "duplicate", ...recent })
    else if (!body.allSent) setResult({ kind: "missed", ...recent })
    else onClose()
  }

  const header = (
    <div className="flex items-start gap-4 border-b border-[var(--color-border)] px-6 pb-4 pt-6">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
        <MessageCircleQuestion className="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-extrabold text-[var(--color-foreground)]">Ask a manager</h2>
        <p className="text-base text-[var(--color-muted-foreground)]">
          {emailsOn ? "Posts in Messages and emails the people you pick." : "Posts in Messages for your managers."}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={sending}
        aria-label="Close"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)]"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )

  const taskCard = (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5 p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-foreground)] text-[var(--color-background)]">
        <ClipboardCheck className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {checklistName.replace(/\s+checklist\s*$/i, "")} · {storeName}
        </p>
        <p className="line-clamp-2 text-lg font-bold leading-snug text-[var(--color-foreground)]">{task.label}</p>
        {trainingLine(task.howTo) && <p className="text-sm text-[var(--color-muted-foreground)]">{trainingLine(task.howTo)}</p>}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ask a manager">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !sending && onClose()}
        className="absolute inset-0 touch-none bg-[var(--color-foreground)]/40"
      />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-[var(--color-card)] shadow-2xl">
        {header}

        {result ? (
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            {taskCard}
            <div
              role="status"
              className={cn(
                "flex items-start gap-3 rounded-2xl border px-5 py-4",
                result.warn
                  ? "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                  : "border-[var(--color-border)] bg-[var(--color-muted)]/50 text-[var(--color-foreground)]"
              )}
            >
              {result.warn ? <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0" /> : <Check className="mt-0.5 h-6 w-6 shrink-0" />}
              <div className="min-w-0 text-lg">
                <p className="font-bold">
                  {result.kind === "missed"
                    ? "Your request is posted in Messages."
                    : `${result.askerName} asked for help at ${timeIn(result.createdAt, timeZone)}.`}
                </p>
                <p>{result.label}.</p>
                {result.kind !== "missed" && (
                  <p className="text-base opacity-80">
                    {result.kind === "duplicate" ? "Nothing new was sent. " : ""}One request per task every 15 minutes — you
                    can ask again after{" "}
                    {timeIn(new Date(new Date(result.createdAt).getTime() + HELP_WINDOW_MS).toISOString(), timeZone)}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="touch" onClick={onClose} className="rounded-full px-8">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className={cn("grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-5", emailsOn && "lg:grid-cols-2")}>
              <div className="flex min-w-0 flex-col gap-5">
                {taskCard}

                <fieldset>
                  <legend className="mb-2 text-lg font-bold text-[var(--color-foreground)]">Who&apos;s asking?</legend>
                  <div className="flex flex-wrap gap-2.5">
                    {staff.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={asker === s.id}
                        onClick={() => setAsker(s.id)}
                        className={cn(
                          PILL,
                          "pl-2",
                          asker === s.id
                            ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]"
                            : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-full text-base font-bold",
                            asker === s.id
                              ? "bg-[var(--color-background)] text-[var(--color-foreground)]"
                              : "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          )}
                        >
                          {s.displayName.trim()[0]?.toUpperCase() ?? "?"}
                        </span>
                        {s.displayName}
                      </button>
                    ))}
                    {/* R4: always last, so a new hire can still ask. */}
                    <button
                      type="button"
                      aria-pressed={asker === null}
                      onClick={() => setAsker(null)}
                      className={cn(
                        PILL,
                        asker === null
                          ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]"
                          : "border-dashed border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]"
                      )}
                    >
                      Not listed
                    </button>
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2 text-lg font-bold text-[var(--color-foreground)]">
                    What&apos;s going on? <span className="font-normal text-[var(--color-muted-foreground)]">(optional)</span>
                  </legend>
                  <div className="flex flex-wrap gap-2.5">
                    {HELP_REASONS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        aria-pressed={reason === r.key}
                        onClick={() => setReason(reason === r.key ? null : r.key)}
                        className={cn(
                          PILL,
                          reason === r.key
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                            : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <label className="mt-3 block">
                    <span className="sr-only">Note for your manager</span>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, HELP_NOTE_MAX))}
                      maxLength={HELP_NOTE_MAX}
                      rows={2}
                      placeholder="Add a note…"
                      className="block w-full resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-primary)]/5 px-4 py-3 text-lg text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                    />
                  </label>
                  {note.length > HELP_NOTE_MAX - 40 && (
                    <p className="mt-1 text-right text-sm text-[var(--color-muted-foreground)]">
                      {note.length} / {HELP_NOTE_MAX}
                    </p>
                  )}
                </fieldset>
              </div>

              {emailsOn && (
                <div className="flex min-w-0 flex-col gap-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-lg font-bold text-[var(--color-foreground)]">Send to</p>
                    <p className="text-sm text-[var(--color-muted-foreground)]">From Email Notification Settings</p>
                  </div>
                  {/* R3: always emailed — shown ticked and not a control. */}
                  <div
                    className={cn(
                      "flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3",
                      managersRow
                        ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
                        : "border-[var(--color-border)] bg-[var(--color-muted)]/40"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                        managersRow ? "bg-[var(--color-primary)] text-white" : "border-2 border-[var(--color-border)]"
                      )}
                    >
                      {managersRow && <Check className="h-5 w-5" />}
                    </span>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-foreground)] text-[var(--color-background)]">
                      <Users className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold text-[var(--color-foreground)]">{storeName} store managers</p>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {managersRow
                          ? "Everyone with the Manager role at this store · always emailed"
                          : "No manager at this store has an email address"}
                      </p>
                    </div>
                  </div>
                  {contacts.map((c) => {
                    const on = ticked.has(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() =>
                          setTicked((prev) => {
                            const next = new Set(prev)
                            if (on) next.delete(c.id)
                            else next.add(c.id)
                            return next
                          })
                        }
                        className={cn(
                          "flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left",
                          on
                            ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
                            : "border-[var(--color-border)] bg-[var(--color-card)]"
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            on ? "bg-[var(--color-primary)] text-white" : "border-2 border-[var(--color-border)]"
                          )}
                        >
                          {on && <Check className="h-5 w-5" />}
                        </span>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                          <Mail className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-lg font-bold text-[var(--color-foreground)]">{c.email}</span>
                          <span className="block truncate text-sm text-[var(--color-muted-foreground)]">
                            {c.name && c.name !== c.email ? c.name : "Contact"}
                          </span>
                        </span>
                        {c.isDefault && (
                          <span className="shrink-0 rounded-full bg-[var(--color-muted)] px-2.5 py-1 text-xs font-bold text-[var(--color-foreground)]">
                            Default
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-6 py-4">
              <p className="flex min-w-0 flex-1 items-center gap-2 text-base text-[var(--color-muted-foreground)]">
                <Mail className="h-5 w-5 shrink-0" />
                <span className="min-w-0">
                  Posts in Messages
                  {emailsOn &&
                    (phrase ? (
                      <>
                        {" "}
                        · Emails <span className="font-bold text-[var(--color-foreground)]">{phrase}</span>
                      </>
                    ) : (
                      " · Pick at least one person to email"
                    ))}
                </span>
              </p>
              {error && (
                <p role="alert" className="basis-full rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-2 text-base font-medium text-[var(--color-warning-text)]">
                  {error}
                </p>
              )}
              <Button size="touch" variant="outline" onClick={onClose} disabled={sending} className="rounded-full px-7">
                Cancel
              </Button>
              <Button size="touch" onClick={() => void send()} disabled={!canSend} className="rounded-full px-7">
                <Send /> {sending ? "Sending…" : "Send request"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
