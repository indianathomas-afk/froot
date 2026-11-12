"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronUp,
  ExternalLink,
  FileText,
  GraduationCap,
  Maximize,
  Play,
  RotateCcw,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TabletTask, TaskDoc, TaskHowTo, TaskVideo } from "./tablet-data"

// TAB-15 — training how-tos on tablet checklist tasks (design "Tablet
// checklist — training resources", A1 pill, A2 panel, A3 full-screen player,
// B portrait expand). TABLET MODE ONLY: nothing here is imported by the
// desktop execution page, which keeps its own "Watch Training Video" link.
//
// What a task carries is decided on the server (taskHowTo in ./tablet-data.ts:
// the desktop page's videoUrl and its one attachment, nothing else). This file
// only draws it. Every "Mark done" here calls back into TasksPanel's tapTask —
// the one tablet tick path, "Who completed this task?" included.
//
// NEVER NAVIGATES THE APP'S OWN WINDOW (PWA-1 runs standalone, no Safari
// chrome to come back with). A YouTube video plays in an iframe, a video file
// in <video playsInline>, an image opens in an in-app viewer with "Back to
// checklist", and anything else (a PDF, a non-embeddable video page) opens in
// a NEW window (target="_blank"), which iOS shows over the home-screen app
// with its own Done button.
//
// TAB-16 ("Ask a manager") goes in three marked places: above Mark done in the
// panel, in the player's bottom bar, and beside Mark done in B's expanded row.

/** What is open, held by TabletHome so the Messages column can give way to the
 *  panel and the idle can close it (15 minutes while one is open — TAB-15
 *  ruling, HOWTO_IDLE_MS in src/lib/tablet-cards.ts). `scope` is TabletHome's
 *  store:day — a new day or store drops it. "panel" is the side panel in
 *  landscape and the expanded row in portrait. */
export type HowToLayer = "panel" | "player" | "image"
export type HowToOpen = { scope: string; checklistId: string; taskId: string; layer: HowToLayer }

// ── Orientation, the same media query as Tailwind's portrait: variant ────────
const PORTRAIT = "(orientation: portrait)"
function subscribePortrait(cb: () => void) {
  const mq = window.matchMedia(PORTRAIT)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}
/** TAB-11's single-column portrait layout, as a value. Server render: landscape. */
export function usePortrait(): boolean {
  return useSyncExternalStore(
    subscribePortrait,
    () => window.matchMedia(PORTRAIT).matches,
    () => false
  )
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** "~1.5 min" / "~2 min"; null when the task has no (or no positive) estimate. */
export function minutesLabel(m: number | null): string | null {
  if (m === null || !(m > 0)) return null
  return `~${Number.isInteger(m) ? m : Number(m.toFixed(1))} min`
}

/** "Opening checklist", never "Opening checklist checklist". */
export function checklistLine(name: string): string {
  return `${name.replace(/\s+checklist\s*$/i, "")} checklist`
}

function resourceCount(h: TaskHowTo): number {
  return (h.video ? 1 : 0) + (h.doc ? 1 : 0)
}

// ── A1: the pill on a task row ───────────────────────────────────────────────

const PILL =
  "flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-base font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50"

export function HowToPill({
  howTo,
  state,
  onClick,
  disabled,
}: {
  howTo: TaskHowTo
  /** closed = the list as normal; open = this task's side panel is showing
   *  (landscape); expanded = this row is open in place (portrait). */
  state: "closed" | "open" | "expanded"
  onClick: () => void
  disabled?: boolean
}) {
  const extra = resourceCount(howTo) - 1
  if (state !== "closed") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-expanded
        aria-label="Close how-to"
        className={cn(PILL, "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]")}
      >
        {state === "open" ? (
          <>
            <GraduationCap className="h-5 w-5" /> Open <ArrowRight className="h-5 w-5" />
          </>
        ) : (
          <>
            Hide <ChevronUp className="h-5 w-5" />
          </>
        )}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={false}
      aria-label={howTo.video ? "Watch the training for this task" : "Open the guide for this task"}
      className={cn(
        PILL,
        "border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/10 text-[var(--color-primary)] active:bg-[var(--color-primary)]/20"
      )}
    >
      {howTo.video ? <Play className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      {howTo.video ? "Watch" : "Guide"}
      {extra > 0 && (
        <span className="rounded-full bg-[var(--color-primary)] px-1.5 text-xs font-bold leading-5 text-[var(--color-primary-foreground)]">
          +{extra}
        </span>
      )}
    </button>
  )
}

// ── The inline video (A2's 16:9 box, B's thumbnail) ──────────────────────────

const OVERLAY_BTN =
  "absolute flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-foreground)]/70 text-[var(--color-background)]"

/** Plays INLINE (playsinline) on tap; the corner button opens the full-screen
 *  player. `active` false (the player or image viewer is over it) drops back
 *  to the poster, so two copies never play at once. */
export function HowToVideo({
  video,
  title,
  active,
  onFullScreen,
  compact,
}: {
  video: TaskVideo
  title: string
  active: boolean
  onFullScreen: () => void
  /** B's thumbnail: a smaller play button and no "Training video" chip. */
  compact?: boolean
}) {
  const [playing, setPlaying] = useState(false)
  if (!active && playing) setPlaying(false)
  const live = playing && active

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[var(--color-foreground)]">
      {live && video.kind === "youtube" && (
        <iframe
          src={`https://www.youtube.com/embed/${video.id}?autoplay=1&playsinline=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      )}
      {live && video.kind === "file" && (
        <video src={video.url} autoPlay playsInline controls className="h-full w-full" />
      )}
      {!live && (
        <>
          {video.kind === "youtube" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://img.youtube.com/vi/${video.id}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover opacity-70"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            {video.kind === "link" ? (
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 items-center gap-2 rounded-full bg-[var(--color-primary)] px-6 text-lg font-semibold text-[var(--color-primary-foreground)]"
              >
                <ExternalLink className="h-5 w-5" /> Open video
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label={`Play: ${title}`}
                className={cn(
                  "flex items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] ring-4 ring-[var(--color-background)]",
                  compact ? "h-16 w-16" : "h-20 w-20"
                )}
              >
                <Play className={cn("fill-current", compact ? "h-7 w-7" : "h-9 w-9")} />
              </button>
            )}
          </span>
          {!compact && (
            <span className="absolute bottom-3 left-3 rounded-full bg-[var(--color-foreground)]/70 px-3 py-1 text-sm font-semibold text-[var(--color-background)]">
              Training video
            </span>
          )}
        </>
      )}
      {video.kind !== "link" && (
        <button
          type="button"
          onClick={onFullScreen}
          aria-label="Full screen"
          className={cn(OVERLAY_BTN, live ? "right-2 top-2" : "bottom-3 right-3")}
        >
          <Maximize className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}

// ── A document row with its Open button ──────────────────────────────────────

const OPEN_BTN =
  "flex h-11 min-w-20 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-foreground)] px-5 text-base font-semibold text-[var(--color-foreground)] active:bg-[var(--color-accent)]"

export function HowToDocRow({ doc, onOpenImage }: { doc: TaskDoc; onOpenImage: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold text-[var(--color-foreground)]">{doc.label}</p>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {doc.kind === "image" ? "Image · opens on this tablet" : "Document · opens in a new window"}
        </p>
      </div>
      {doc.kind === "image" ? (
        <button type="button" onClick={onOpenImage} className={OPEN_BTN}>
          Open
        </button>
      ) : (
        <a href={doc.url} target="_blank" rel="noopener noreferrer" className={OPEN_BTN}>
          Open
        </a>
      )}
    </div>
  )
}

function MarkDoneButton({ onClick, disabled, className }: { onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <Button size="touch" onClick={onClick} disabled={disabled} className={cn("h-16 w-full text-xl", className)}>
      <Check /> Mark done
    </Button>
  )
}

// ── A2: the How-to panel, in the Messages column's place (landscape) ─────────

export function HowToPanel({
  task,
  checklistName,
  layer,
  onClose,
  onLayer,
  onMarkDone,
  disabled,
}: {
  task: TabletTask & { howTo: TaskHowTo }
  checklistName: string
  layer: HowToLayer
  onClose: () => void
  onLayer: (layer: HowToLayer) => void
  onMarkDone: () => void
  disabled?: boolean
}) {
  const { video, doc } = task.howTo
  const mins = minutesLabel(task.minutes)
  return (
    <section
      aria-label={`How-to: ${task.label}`}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border-2 border-[var(--color-primary)]/30 bg-[var(--color-card)]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wider text-[var(--color-primary)]">
              <GraduationCap className="h-4 w-4" /> How-to
            </p>
            <h2 className="mt-1 text-2xl font-extrabold leading-tight text-[var(--color-foreground)]">{task.label}</h2>
            <p className="mt-1 text-base text-[var(--color-muted-foreground)]">
              {checklistLine(checklistName)}
              {mins ? ` · ${mins}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close how-to"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {video && (
          <div className="mt-4">
            <HowToVideo video={video} title={task.label} active={layer === "panel"} onFullScreen={() => onLayer("player")} />
          </div>
        )}
        {doc && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-extrabold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {video ? "Also attached" : "Guide"}
            </p>
            <HowToDocRow doc={doc} onOpenImage={() => onLayer("image")} />
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-3 px-5 pb-5 pt-2">
        {/* TAB-16: the "Still stuck? Ask a manager" button goes here. */}
        <MarkDoneButton onClick={onMarkDone} disabled={disabled} />
      </div>
    </section>
  )
}

// ── B: the row expanded in place (portrait) ──────────────────────────────────

export function HowToExpanded({
  task,
  layer,
  onLayer,
  onMarkDone,
  disabled,
}: {
  task: TabletTask & { howTo: TaskHowTo }
  layer: HowToLayer
  onLayer: (layer: HowToLayer) => void
  onMarkDone: () => void
  disabled?: boolean
}) {
  const { video, doc } = task.howTo
  const mins = minutesLabel(task.minutes)
  const ref = useRef<HTMLDivElement>(null)
  // Bring the opened row's training on screen, without jumping if it already is.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [])
  return (
    <div ref={ref} className={cn("grid gap-4 px-5 pb-5", video && "grid-cols-2")}>
      {video && (
        <HowToVideo video={video} title={task.label} active={layer === "panel"} onFullScreen={() => onLayer("player")} compact />
      )}
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wider text-[var(--color-primary)]">
            {video ? "Training video" : "Guide"}
          </p>
          {mins && <p className="text-base text-[var(--color-muted-foreground)]">Task takes {mins}</p>}
        </div>
        {doc && <HowToDocRow doc={doc} onOpenImage={() => onLayer("image")} />}
        {/* TAB-16: "Ask a manager" goes beside Mark done here. */}
        <MarkDoneButton onClick={onMarkDone} disabled={disabled} className="mt-auto" />
      </div>
    </div>
  )
}

// ── A3: the full-screen player ───────────────────────────────────────────────

const DARK_OUTLINE =
  "flex h-14 shrink-0 items-center gap-2 rounded-full border border-[var(--color-background)]/30 px-5 text-lg font-semibold text-[var(--color-background)] active:bg-[var(--color-background)]/10"

export function HowToPlayer({
  task,
  checklistName,
  onBack,
  onOpenImage,
  onMarkDone,
  disabled,
}: {
  task: TabletTask & { howTo: TaskHowTo }
  checklistName: string
  onBack: () => void
  onOpenImage: () => void
  onMarkDone: () => void
  disabled?: boolean
}) {
  const { video, doc } = task.howTo
  // Watch again: a YouTube iframe restarts by remounting (autoplay=1); a file
  // rewinds its own element.
  const [round, setRound] = useState(0)
  const fileRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])
  if (!video || video.kind === "link") return null

  function watchAgain() {
    if (video?.kind === "file" && fileRef.current) {
      fileRef.current.currentTime = 0
      void fileRef.current.play()
    } else setRound((r) => r + 1)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Training video: ${task.label}`}
      className="fixed inset-0 z-50 flex flex-col gap-4 bg-[var(--color-foreground)] p-5 text-[var(--color-background)]"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button type="button" onClick={onBack} className={cn(DARK_OUTLINE, "justify-self-start border-transparent bg-[var(--color-background)]/10")}>
          <ArrowLeft className="h-5 w-5" /> Back to checklist
        </button>
        <div className="min-w-0 text-center">
          <p className="text-sm font-extrabold uppercase tracking-widest text-[var(--color-primary)]">
            How-to · {checklistName.replace(/\s+checklist\s*$/i, "")}
          </p>
          <p className="truncate text-2xl font-bold">{task.label}</p>
        </div>
        {doc ? (
          doc.kind === "image" ? (
            <button type="button" onClick={onOpenImage} className={cn(DARK_OUTLINE, "justify-self-end")}>
              <FileText className="h-5 w-5" /> Open guide
            </button>
          ) : (
            <a href={doc.url} target="_blank" rel="noopener noreferrer" className={cn(DARK_OUTLINE, "justify-self-end")}>
              <FileText className="h-5 w-5" /> Open guide
            </a>
          )
        ) : (
          <span />
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className="aspect-video overflow-hidden rounded-2xl bg-[var(--color-background)]/5"
          style={{ width: "min(100%, 72rem, calc((100dvh - 16rem) * 16 / 9))" }}
        >
          {video.kind === "youtube" ? (
            <iframe
              key={round}
              src={`https://www.youtube.com/embed/${video.id}?autoplay=1&playsinline=1&rel=0`}
              title={task.label}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          ) : (
            <video ref={fileRef} src={video.url} autoPlay playsInline controls className="h-full w-full" />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--color-background)]/10 p-4">
        <div className="min-w-0">
          <p className="text-xl font-bold">Got it?</p>
          <p className="text-base opacity-80">Check the task off right here — no need to go back.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={watchAgain} className={DARK_OUTLINE}>
            <RotateCcw className="h-5 w-5" /> Watch again
          </button>
          {/* TAB-16: the "Ask a manager" button goes here. */}
          <Button size="touch" onClick={onMarkDone} disabled={disabled} className="h-14 rounded-full px-6">
            <Check /> Mark done
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── An image guide, opened inside the app ────────────────────────────────────

export function HowToImage({ doc, onBack }: { doc: TaskDoc; onBack: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={doc.label}
      className="fixed inset-0 z-50 flex flex-col gap-4 bg-[var(--color-foreground)] p-5 text-[var(--color-background)]"
    >
      <div className="flex items-center gap-4">
        <button type="button" onClick={onBack} className={cn(DARK_OUTLINE, "border-transparent bg-[var(--color-background)]/10")}>
          <ArrowLeft className="h-5 w-5" /> Back to checklist
        </button>
        <p className="min-w-0 truncate text-xl font-bold">{doc.label}</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={doc.url} alt={doc.label} className="max-h-full max-w-full rounded-xl object-contain" />
      </div>
    </div>
  )
}

// ── A1's "done · 25 of 38" toast, with Undo ──────────────────────────────────

export function DoneToast({
  label,
  done,
  total,
  onUndo,
}: {
  label: string
  done: number
  total: number
  onUndo: () => void
}) {
  return (
    <div
      role="status"
      className="absolute inset-x-4 bottom-4 z-20 flex items-center gap-3 rounded-2xl bg-[var(--color-foreground)] py-2 pl-5 pr-2 text-[var(--color-background)] shadow-2xl"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)]">
        <Check className="h-5 w-5" />
      </span>
      <p className="min-w-0 flex-1 text-lg">
        <span className="line-clamp-1 font-semibold">{label}</span>
        <span className="opacity-80">
          done · {done} of {total}
        </span>
      </p>
      <button
        type="button"
        onClick={onUndo}
        className="flex h-12 shrink-0 items-center rounded-xl px-4 text-lg font-bold text-[var(--color-primary)] active:bg-[var(--color-background)]/10"
      >
        Undo
      </button>
    </div>
  )
}

/** Runs onClose once mounted — for a parent's how-to state that has gone
 *  stale (the task was ticked, the tab changed, the list reloaded). A
 *  component rather than an inline effect because TasksPanel's early returns
 *  sit above where it knows which task is showing. */
export function CloseWhenStale({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    onClose()
  }, [onClose])
  return null
}
