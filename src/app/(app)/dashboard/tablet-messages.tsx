"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ArrowRight, Paperclip, Pin, Play, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { MessageAttachments, TYPE_META, type FeedAttachment, type FeedMessage } from "@/app/(app)/messages/messages-client"
import { MessageTypePicker } from "@/app/(app)/messages/type-picker"
import {
  QUICK_REPLIES,
  chatOrder,
  isNearBottom,
  keyboardInset,
  markReadUpTo,
  mergeRefresh,
  postBody,
  unreadBadge,
  withPosted,
} from "@/lib/tablet-messages"
import { publishUnread } from "@/lib/tablet-unread"
import { fetchCard } from "./card-fetch"
import { useRefreshLoader, useTabletRefresh } from "./tablet-refresh"
import { timeAgo, type Comms } from "./dashboard-client"

// TAB-2 — the tablet home's Messages column (Direction 1 · Status Stage),
// replacing the desktop Team Messages card TAB-1 left as a placeholder.
// Gary's rulings, 2026-11-10 ("Yes"): Messages column only (the stat strip is
// TAB-3); Corporate Update pinned at the top, the thread below, a large
// composer fixed at the bottom; quick replies post as an ordinary message;
// messages come from the logged-in account; unread reuses desktop's.
//
// EVERY READ AND WRITE IS AN EXISTING ENDPOINT, CALLED THE WAY ITS SCREEN DOES:
//   pinned update + unread   GET /api/dashboard/comms   (the desktop dashboard)
//   thread                   GET /api/messages          (the /messages feed,
//                            first page, no filters — the same store-scoped
//                            set the desktop card previews the top 3 of)
//   post / quick reply       POST /api/messages         (the /messages composer,
//                            type "general", no staff name: the logged-in
//                            account is the author, ruling 4)
// Nothing here marks a message read. Desktop marks read only when /messages
// loads, so the count clears the way desktop's does: through "Open the feed".
//
// ORDER: newest first, as the desktop card and the feed read (src/lib/
// tablet-messages.ts says why). "Scroll to the newest" therefore means the top.
//
// ── 2026-11-10, Gary's rulings on the three RULING NOW items (6-8 here; the
// two paragraphs above are spent, kept): ──
//   6 ORDER: chat order — oldest at the top, newest at the bottom beside the
//     composer; scrolls to the bottom on load and after posting. Desktop
//     unchanged.
//   7 READ: what the column has rendered counts as read, through the SAME
//     POST /api/messages/mark-read /messages uses (upTo = the newest rendered
//     message). After it lands the count is re-read, so the column and the
//     rail clear.
//   8 LIVE: refetch every 60s while visible, at once on becoming visible
//     again (visibilitychange / focus); never while hidden or while a send is
//     in flight.

// TAB-3: the one definition now lives in src/lib/tablet-messages.ts, shared
// with the stat strip so the two can't drift (the DEBT-32 shape).
// ── TAB-5, 2026-11-10: the column no longer runs its own timer. The tablet
// home's one refresh controller (./tablet-refresh.tsx) runs this column's
// re-read on its cycle, together with the Tasks panel, the chips and the
// strip, under the same ruling 8 rule; a send in flight now holds the whole
// page's cycle, not just this column's. The REFRESH_MS line that stood here
// is spent.
//
// ── TAB-12, 2026-11-11 (Gary, R1–R6; DECISIONS 2026-11-11 TAB-12). The
// composer posts with a type: a tag inside the message box, starting at
// General, opens TAB-11's type picker (shared, ../messages/type-picker.tsx).
// Quick replies always post General and leave the draft's tag alone (R2);
// the tag returns to General after every composer post (R3); only non-General
// messages show a type badge in this thread (R4); type only — no ingredient
// link (R5); Shift Note picks its phase inside the picker (R6). The "type
// "general"" in the endpoint list above now holds for quick replies only.

export function MessagesColumn({ storeId }: { storeId: string }) {
  const columnRef = useRef<HTMLElement>(null)
  // ── Pinned Corporate Update + unread count (the desktop card's endpoint) ──
  // undefined = loading, null = failed. A failure only hides the pinned card
  // and the count; the thread has its own read. A failed REFRESH keeps what
  // is showing. Only the latest-issued read is applied, so an early read
  // finishing late can't put back a count that mark-read has since cleared.
  const [comms, setComms] = useState<Comms | null | undefined>(undefined)
  const commsSeq = useRef(0)
  const loadComms = useCallback(() => {
    const seq = ++commsSeq.current
    return fetchCard<Comms>("comms", `/api/dashboard/comms?storeId=${storeId}`).then((data) => {
      if (seq !== commsSeq.current) return
      setComms((prev) => data ?? (prev === undefined ? null : prev))
      if (data) publishUnread(storeId, data.teamMessagesPreview.unreadCount)
    })
  }, [storeId])

  // ── The thread (the feed's own endpoint), in chat order ──
  const [thread, setThread] = useState<FeedMessage[] | null | undefined>(undefined)
  const threadRef = useRef<HTMLDivElement>(null)
  // Asks for a scroll to the newest (the bottom). Applied in the layout
  // effect below, right after the thread that holds the new messages commits,
  // so it never depends on an animation frame firing (a backgrounded page
  // defers those indefinitely).
  const scrollPending = useRef(false)
  const showNewest = useCallback(() => {
    scrollPending.current = true
  }, [])
  const loadThread = useCallback(
    (refresh: boolean): Promise<void> => {
      const el = threadRef.current
      const atBottom = !el || isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight)
      return fetchCard<{ messages: FeedMessage[] }>("messages", `/api/messages?storeId=${storeId}`).then((data) => {
        if (!data) {
          // First load: show the error. Refresh: keep what is showing.
          if (!refresh) setThread(null)
          return
        }
        const fetched = chatOrder(data.messages)
        setThread((prev) => (refresh && prev ? mergeRefresh(fetched, prev) : fetched))
        // Load: always to the newest. Refresh: follow new messages down only
        // when the reader was already at the bottom, never yank someone who
        // scrolled up to read.
        if (!refresh || atBottom) showNewest()
      })
    },
    [storeId, showNewest]
  )

  useLayoutEffect(() => {
    if (!scrollPending.current) return
    scrollPending.current = false
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread])

  useEffect(() => {
    void loadComms()
    void loadThread(false)
  }, [loadComms, loadThread])

  // ── Ruling 7: rendered = read. Runs after the render that put the messages
  // on screen. One request per newer message rendered, none otherwise. ──
  const lastMarked = useRef<string | null>(null)
  useEffect(() => {
    if (!thread) return
    const upTo = markReadUpTo(thread, lastMarked.current)
    if (!upTo) return
    const before = lastMarked.current
    lastMarked.current = upTo
    fetch("/api/messages/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, upTo }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`mark-read ${res.status}`)
        return loadComms()
      })
      .catch((err) => {
        // Try again on the next render or refresh.
        console.error("[tablet messages] mark-read failed:", err)
        if (lastMarked.current === upTo) lastMarked.current = before
      })
  }, [thread, storeId, loadComms])

  // The composer's synchronous send guard (used below by the composer too):
  // a second tap lands before React re-renders the disabled buttons, so state
  // alone can't stop a double post. Ruling 8 reads it to skip a refresh
  // mid-send.
  const sendingRef = useRef(false)

  // ── Ruling 8: live refresh, on the tablet home's one timer (TAB-5) ──
  const ctl = useTabletRefresh()
  const refreshColumn = useCallback(() => Promise.all([loadThread(true), loadComms()]), [loadThread, loadComms])
  useRefreshLoader(refreshColumn)

  // ── The composer ──
  const [draft, setDraft] = useState("")
  // TAB-12: the draft's type (R1) and, for a shift note, its phase (R6).
  const [draftType, setDraftType] = useState("general")
  const [draftPhase, setDraftPhase] = useState<string | null>(null)
  // Which control is sending, for its label; null when idle.
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send(text: string, source: "composer" | "quick") {
    if (sendingRef.current) return
    // R2: a quick reply is always General, whatever the draft's tag says.
    const payload = source === "composer" ? postBody(storeId, text, draftType, draftPhase) : postBody(storeId, text)
    if (!payload) return
    sendingRef.current = true
    ctl?.setBusy("messages:send", true)
    setSending(source === "composer" ? "composer" : payload.body)
    setError(null)
    try {
      let res: Response
      try {
        res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } catch {
        setError(
          source === "composer"
            ? "Couldn't send — no connection. Your message is still here; check the store's wifi and tap Send again."
            : `"${payload.body}" didn't send — no connection. Check the store's wifi and tap it again.`
        )
        return
      }
      if (!res.ok) {
        const reason = (await readError(res)) ?? `error ${res.status}`
        setError(
          source === "composer"
            ? `Couldn't send (${reason}). Your message is still here; tap Send again.`
            : `"${payload.body}" didn't send (${reason}). Tap it again.`
        )
        return
      }
      const posted = (await res.json()) as FeedMessage
      setThread((prev) => withPosted(prev ?? [], posted))
      if (source === "composer") {
        setDraft("")
        // R3: back to General, no phase, after every post.
        setDraftType("general")
        setDraftPhase(null)
      }
      showNewest()
    } finally {
      sendingRef.current = false
      ctl?.setBusy("messages:send", false)
      setSending(null)
    }
  }

  const inset = useKeyboardInset()
  const badge = comms ? unreadBadge(comms.teamMessagesPreview.unreadCount) : null
  const update = comms?.corporateUpdate ?? null
  const busy = sending !== null
  // While the keyboard is up, the column keeps only what typing needs: the
  // thread and the text field. The header, the pinned update and the quick
  // replies fold away (a quick reply never needs the keyboard), because on an
  // iPad they are taller together than the space left above the keyboard and
  // would push the composer back under it — in portrait the column has ~130px
  // above it. They return when the keyboard closes.
  const typing = inset > 0

  return (
    <section
      ref={columnRef}
      className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)]"
      // The iPad keyboard: lift the composer by exactly what the keyboard
      // covers (visualViewport), so it stays above it. 0 with no keyboard.
      style={inset > 0 ? { paddingBottom: inset } : undefined}
    >
      <header className={cn("flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-3", typing && "hidden")}>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-[var(--color-foreground)]">Messages</h2>
          {badge && (
            <span
              data-testid="column-unread"
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--color-primary)] px-2.5 text-sm font-semibold text-white"
            >
              {badge} new
            </span>
          )}
        </div>
        {/* In chat order the bottom of the thread belongs to the newest
            message, so the link to the full feed lives up here (ruling 6). */}
        <Link
          href="/messages"
          className="inline-flex min-h-12 items-center gap-1.5 text-lg font-bold text-[var(--color-primary)]"
        >
          Open the feed <ArrowRight className="h-5 w-5" />
        </Link>
      </header>

      {typing ? null : comms === undefined ? (
        <div className="px-4 pb-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : (
        update && <PinnedUpdate update={update} />
      )}

      {/* TAB-9: no overscroll-contain — at the thread's end a flick carries
          on into the page, which scrolls now (tablet-home.tsx, audit 2). */}
      <div
        ref={threadRef}
        data-testid="tablet-thread"
        className="min-h-0 flex-1 overflow-y-auto px-5 py-2"
      >
        <Thread thread={thread} onRetry={() => void loadThread(false)} />
      </div>

      <div className="shrink-0 space-y-3 border-t border-[var(--color-border)] px-4 pt-3 pb-4">
        <div className={cn("grid grid-cols-3 gap-3", typing && "hidden")}>
          {QUICK_REPLIES.map((label) => (
            <button
              key={label}
              type="button"
              disabled={busy}
              onClick={() => void send(label, "quick")}
              className="min-h-14 rounded-full border border-[var(--color-border)] bg-[var(--color-background)] text-lg font-semibold text-[var(--color-foreground)] transition-colors active:bg-[var(--color-accent)] disabled:opacity-50"
            >
              {sending === label ? "Sending…" : label}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send(draft, "composer")
          }}
        >
          {/* TAB-12: the box is this wrapper; the type tag sits inside it,
              top-left, and the text wraps beside it. */}
          <div className="flex max-h-36 min-h-14 min-w-0 flex-1 items-start rounded-3xl border border-[var(--color-border)] bg-[var(--color-background)] focus-within:ring-2 focus-within:ring-[var(--color-primary)]/40">
            <div className="max-w-[62%] shrink-0 py-[5px] pl-[5px]">
              <MessageTypePicker
                variant="home"
                type={draftType}
                shiftPhase={draftPhase}
                onPick={(t, phase) => {
                  setDraftType(t)
                  setDraftPhase(phase)
                }}
                boundaryRef={columnRef}
                keyboardInset={inset}
              />
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Return sends (a hardware keyboard, or the iPad's Return key);
                // Shift+Return keeps a line break.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send(draft, "composer")
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Message the team…"
              aria-label="Message"
              enterKeyHint="send"
              className="max-h-[142px] min-h-[54px] min-w-0 flex-1 resize-none bg-transparent pt-[14px] pr-2.5 pb-3 pl-1 text-lg text-[var(--color-foreground)] placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
            />
          </div>
          <Button
            type="submit"
            size="touch"
            aria-label="Send"
            disabled={busy || draft.trim().length === 0}
            className="h-14 w-14 shrink-0 rounded-full px-0"
          >
            {sending === "composer" ? <span className="text-sm">…</span> : <Send />}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-base font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Pinned Corporate Update ──────────────────────────────────────────────────
// The desktop card's content (title, body, attachments) in a compact,
// touch-sized card. A YouTube attachment shows its thumbnail; tapping it plays
// the same embed desktop shows inline. Other attachments render exactly as the
// desktop card renders them.

function PinnedUpdate({ update }: { update: NonNullable<Comms["corporateUpdate"]> }) {
  const video = update.attachments.find((a) => a.kind === "youtube" && a.youtubeId) ?? null
  const others: FeedAttachment[] = update.attachments.filter((a) => a !== video)
  const [playing, setPlaying] = useState(false)

  return (
    <div className="mx-4 mb-3 rounded-2xl bg-gradient-to-br from-[#FCE0CC] to-[#F6C8A6] p-3" data-testid="tablet-pinned-update">
      <div className="flex gap-3">
        {video && !playing && (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play video: ${update.title}`}
            className="relative h-20 w-32 shrink-0 overflow-hidden rounded-xl bg-[#1C1917]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://img.youtube.com/vi/${video.youtubeId}/mqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover opacity-80"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                <Play className="h-5 w-5 fill-current" />
              </span>
            </span>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-extrabold tracking-wide text-[#8A3E17]">
            <Pin className="h-4 w-4" /> CORPORATE UPDATE
          </p>
          <p className="truncate text-xl font-bold text-[#1C1917]">{update.title}</p>
          <p className="line-clamp-2 text-base whitespace-pre-wrap text-[#6B4326]">{update.body}</p>
        </div>
      </div>
      {video && playing && (
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl">
          <iframe
            src={`https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&playsinline=1`}
            title={update.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}
      <MessageAttachments attachments={others} />
    </div>
  )
}

// ─── The thread ───────────────────────────────────────────────────────────────

function Thread({ thread, onRetry }: { thread: FeedMessage[] | null | undefined; onRetry: () => void }) {
  if (thread === undefined) {
    return (
      <div className="space-y-4 py-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    )
  }
  if (thread === null) {
    return (
      <div className="flex flex-col items-start gap-3 py-4">
        <p className="text-lg text-[var(--color-muted-foreground)]">Couldn&apos;t load messages.</p>
        <Button size="touch" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  if (thread.length === 0) {
    return (
      <p className="py-4 text-lg text-[var(--color-muted-foreground)]">
        No messages yet at this store — say hello to the team below.
      </p>
    )
  }
  return (
    <ol className="space-y-4">
      {thread.map((m) => (
        <li key={m.id} className="flex gap-3" data-testid="tablet-message">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-base font-bold text-[var(--color-primary)]">
            {m.author.initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg">
              <span className="font-bold text-[var(--color-foreground)]">{m.author.name}</span>
              <span className="text-[var(--color-muted-foreground)]"> · {timeAgo(m.createdAt)}</span>
              <TypeBadge type={m.type} />
            </p>
            <div
              className={cn(
                "mt-1 inline-block max-w-full rounded-2xl px-4 py-2.5 text-lg leading-snug whitespace-pre-wrap break-words",
                m.isMine ? "bg-[var(--color-primary)]/10" : "bg-[var(--color-muted)]"
              )}
            >
              {m.body}
            </div>
            {m.attachments.length > 0 && (
              <Link href="/messages" className="mt-1 flex items-center gap-1.5 text-base text-[var(--color-muted-foreground)]">
                <Paperclip className="h-4 w-4" />
                {m.attachments.length === 1 ? "1 attachment" : `${m.attachments.length} attachments`} — open the feed
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

// TAB-12 R4 — only a non-General message shows its type, so the home reads
// as it did until someone flags a note. An unknown type shows nothing.
function TypeBadge({ type }: { type: string }) {
  if (type === "general") return null
  const meta = TYPE_META[type]
  if (!meta) return null
  return (
    <span
      data-testid="tablet-type-badge"
      className="ml-2 inline-flex h-[26px] items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-secondary)] px-2.5 align-middle text-sm font-[650] text-[var(--color-foreground)]"
    >
      <meta.icon className="h-[15px] w-[15px] shrink-0" />
      {meta.label}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : null
  } catch {
    return null
  }
}

function subscribeViewport(callback: () => void) {
  const vv = window.visualViewport
  window.addEventListener("resize", callback)
  vv?.addEventListener("resize", callback)
  vv?.addEventListener("scroll", callback)
  return () => {
    window.removeEventListener("resize", callback)
    vv?.removeEventListener("resize", callback)
    vv?.removeEventListener("scroll", callback)
  }
}

/** Pixels of the layout viewport the on-screen keyboard covers right now.
 *  TAB-11 — exported so the Tablet-mode Team Messages page lifts its composer
 *  the same way this column does. */
export function useKeyboardInset(): number {
  return useSyncExternalStore(
    subscribeViewport,
    () => keyboardInset(window.innerHeight, window.visualViewport),
    () => 0
  )
}
