"use client"

import { useState } from "react"
import { ChevronDown, Info, PlayCircle } from "lucide-react"
import { canonicalYouTubeUrl, youTubeVideoId } from "@/lib/messages"
import { looksLikeHtml } from "@/lib/rich-text"
import { sanitizeRichText } from "@/lib/sanitize-html"

// DOC-3 ruling 3: an admin's instructions for what to do with a document —
// rich text plus an optional video — shown on the admin library row and on the
// staff portal card. ONE COMPONENT FOR BOTH SURFACES, deliberately: HR-17's
// no-second-renderer rule, and the reason HR-28's own description fix landed on
// both of its surfaces with a single edit. A second copy here would be the
// thing that drifts.
//
// THE TWO SURFACES DIFFER ONLY IN `variant`, which is a placement decision, not
// a rendering one (Gary, 2026-08-24):
//   "collapsed" — the admin library, a dense scannable list where an expanded
//                 rich-text block per row would destroy the scan.
//   "expanded"  — the staff portal, one card per document, where the
//                 instruction is the thing that makes the link actionable and a
//                 staff member on a phone should not have to find a disclosure.

// The class list is COPIED VERBATIM from training-module-view.tsx and must stay
// identical to it. Tailwind's preflight strips list markers and margins, so a
// <ul> would otherwise render as unindented run-on lines. [&_li_p]:mb-0 is
// load-bearing and was a real defect found in HR-28's browser pass: Tiptap
// wraps list-item content in a <p>, which takes the paragraph spacing and blows
// the bullets apart. The editor applies the same list, so the builder is a true
// preview of this.
const RICH_TEXT_CLASSES =
  "[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:mb-0.5 [&_li_p]:mb-0"

export function hasInstructions(
  html: string | null | undefined,
  videoUrl: string | null | undefined
): boolean {
  return !!(html?.trim() || videoUrl?.trim())
}

function InstructionsBody({
  instructionsHtml,
  instructionsVideoUrl,
  title,
}: {
  instructionsHtml: string | null
  instructionsVideoUrl: string | null
  title: string
}) {
  // SANITIZED AGAIN ON THE WAY OUT, and that is not belt-and-braces theatre —
  // it is HR-28's stated rule (lib/sanitize-html.ts). The write paths protect
  // what arrives; this protects what is already there. Not yet load-bearing for
  // DOC-3 (this column is one commit old and every row in it was sanitized on
  // write), but the moment an importer or a script writes one it is, and by
  // then nobody will be re-reading this file.
  const html =
    instructionsHtml && looksLikeHtml(instructionsHtml)
      ? sanitizeRichText(instructionsHtml)
      : null

  const canonical = instructionsVideoUrl ? canonicalYouTubeUrl(instructionsVideoUrl) : null
  const videoId = canonical ? youTubeVideoId(canonical) : null

  return (
    <div className="text-sm text-[var(--color-muted-foreground)]">
      {html ? (
        <div className={RICH_TEXT_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
      ) : instructionsHtml ? (
        // Plain text, which sanitizeRichText passes through verbatim rather
        // than entity-encoding (the "Tom & Jerry" case). whitespace-pre-wrap so
        // it keeps the line breaks its author typed.
        <p className="whitespace-pre-wrap">{instructionsHtml}</p>
      ) : null}

      {videoId ? (
        <div className="aspect-video mt-3 rounded-md overflow-hidden">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}`}
            title={`Instructions — ${title}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        </div>
      ) : instructionsVideoUrl ? (
        // Not YouTube (or an unrecognised YouTube shape): a plain link rather
        // than an iframe. Same fallback as the HR-28 lesson renderer. The URL
        // was validated https-and-not-our-blob-host at save
        // (isValidExternalDocumentUrl), so this href cannot carry a
        // javascript: or data: scheme.
        <a
          href={instructionsVideoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] mt-3 min-h-11"
        >
          <PlayCircle className="h-4 w-4" />
          Watch video
        </a>
      ) : null}
    </div>
  )
}

export function DocumentInstructions({
  instructionsHtml,
  instructionsVideoUrl,
  title,
  variant,
}: {
  instructionsHtml: string | null
  instructionsVideoUrl: string | null
  title: string
  variant: "collapsed" | "expanded"
}) {
  const [open, setOpen] = useState(false)
  if (!hasInstructions(instructionsHtml, instructionsVideoUrl)) return null

  if (variant === "expanded") {
    return (
      <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1.5">
          <Info className="h-3.5 w-3.5" />
          Instructions
        </p>
        <InstructionsBody
          instructionsHtml={instructionsHtml}
          instructionsVideoUrl={instructionsVideoUrl}
          title={title}
        />
      </div>
    )
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        Instructions
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-3">
          <InstructionsBody
            instructionsHtml={instructionsHtml}
            instructionsVideoUrl={instructionsVideoUrl}
            title={title}
          />
        </div>
      )}
    </div>
  )
}
