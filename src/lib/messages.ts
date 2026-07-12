import { Prisma } from "@prisma/client"
import { z } from "zod"

// ─── I-14 Team Messaging: shared constants & helpers ─────────────────────────

export const MESSAGE_TYPES = [
  "shift_note", // opening / mid / closing notes
  "shortage", // product shortage (links to an ingredient)
  "equipment", // blender's grinding again
  "customer_feedback", // inquiries / complaints / praise
  "staffing", // coverage problems
  "shoutout", // team wins
  "general",
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

export const SHIFT_PHASES = ["opening", "mid", "closing"] as const

export const MESSAGE_STATUSES = ["open", "resolved", "archived"] as const

export const ALLOWED_EMOJI = ["👍", "🎉", "❤️", "😂", "👀", "🙏"] as const

export const MAX_ATTACHMENTS = 4
export const MAX_BODY_LENGTH = 2000

// Minutes after posting during which the author may still edit the body.
export const EDIT_WINDOW_MS = 15 * 60 * 1000

// Handoff notes older than this never render on checklists (feed-only) to
// avoid stale banners.
export const HANDOFF_MAX_AGE_DAYS = 7

// ─── Checklist day sequence ───────────────────────────────────────────────────
// Template.operationalPhase orders a store's checklists within the day. The
// handoff date rule: posting to a LATER slot lands today; posting to an
// earlier-or-equal slot lands tomorrow (closer → tomorrow's opener).

const PHASE_ORDER: Record<string, number> = {
  "Before Opening": 0,
  "During the Day": 1, // canonical (what the template form writes)
  "During Hours": 1, // legacy rows from the original template import
  "After Closing": 2,
}

export function phaseOrder(operationalPhase: string | null): number {
  return PHASE_ORDER[operationalPhase ?? ""] ?? 1
}

// Maps a source checklist's slot to the shift_phase recorded on the note.
export function phaseToShiftPhase(operationalPhase: string | null): "opening" | "mid" | "closing" {
  const order = phaseOrder(operationalPhase)
  return order === 0 ? "opening" : order === 2 ? "closing" : "mid"
}

// The day (YYYY-MM-DD) the note should appear on, given the source checklist's
// date and both templates' slots. Users never think about dates — "Post to
// Closing" at 7 AM lands today, "Post to Opening" at 10 PM lands tomorrow.
export function resolvePostedForDate(
  sourceDate: string,
  sourcePhase: string | null,
  targetPhase: string | null
): string {
  if (phaseOrder(targetPhase) > phaseOrder(sourcePhase)) return sourceDate
  const d = new Date(`${sourceDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// A note stays visible on checklists/dashboard through its target day plus
// the org's handoffNoteExpireDays grace days, unless acknowledged first.
export function handoffExpiresAt(postedForDate: string, expireDays: number): Date {
  const d = new Date(`${postedForDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1 + expireDays)
  return d
}

// Where-clause for notes that should surface for a store on a given business
// day (YYYY-MM-DD): unacknowledged, unexpired handoff notes whose surface date
// has arrived — `lte` (not equals) so a note targeting a closed day simply
// waits for the next open one. Store-wide notes have postedToTemplateId null.
// templateIds narrows to specific checklists (banner); omit for the dashboard,
// which shows every note surfacing today — including ones whose target
// template no longer generates checklists, so nothing is ever silently lost.
// Legacy rows without expiresAt fall back to the 7-day createdAt cutoff.
export function activeHandoffNotesWhere({
  storeId,
  day,
  templateIds,
}: {
  storeId: string
  day: string
  templateIds?: string[]
}): Prisma.TeamMessageWhereInput {
  return {
    storeId,
    deletedAt: null,
    acknowledgedAt: null,
    postedForDate: { not: null, lte: new Date(`${day}T00:00:00.000Z`) },
    ...(templateIds
      ? { OR: [{ postedToTemplateId: { in: templateIds } }, { postedToTemplateId: null }] }
      : {}),
    AND: [
      {
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null, createdAt: { gte: new Date(Date.now() - HANDOFF_MAX_AGE_DAYS * 86400000) } },
        ],
      },
    ],
  }
}

// ─── YouTube ──────────────────────────────────────────────────────────────────
// Accepts watch/share/shorts/embed URLs; returns the canonical watch URL or
// null when no valid 11-char video id is found.

export function canonicalYouTubeUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, "")
  let id: string | null = null
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0]
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v")
    else {
      const m = url.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/)
      if (m) id = m[2]
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}

export function youTubeVideoId(canonicalUrl: string): string | null {
  const m = canonicalUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export const attachmentSchema = z.object({
  kind: z.enum(["image", "document", "youtube"]),
  url: z.string().min(1),
  filename: z.string().nullish(),
  contentType: z.string().nullish(),
  sizeBytes: z.number().int().positive().nullish(),
})

// Resolves uploaded/pasted attachments into DB rows: youtube URLs are
// canonicalized server-side, blob URLs pass through.
export function buildAttachmentRows(attachments: z.infer<typeof attachmentSchema>[]) {
  const rows: { kind: string; url: string; filename?: string | null; contentType?: string | null; sizeBytes?: number | null }[] = []
  for (const a of attachments) {
    if (a.kind === "youtube") {
      const canonical = canonicalYouTubeUrl(a.url)
      if (!canonical) throw new Error("Invalid YouTube URL")
      rows.push({ kind: "youtube", url: canonical })
    } else {
      rows.push({ kind: a.kind, url: a.url, filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes })
    }
  }
  return rows
}

// ─── Feed serialization ───────────────────────────────────────────────────────
// One include + one serializer shared by the feed, handoff banner, and
// dashboard preview so every surface renders the same shape.

export const messageInclude = {
  authorUser: { select: { id: true, name: true, email: true } },
  authorStaff: { select: { id: true, displayName: true } },
  acknowledgedByUser: { select: { id: true, name: true, email: true } },
  linkedIngredient: { select: { id: true, name: true } },
  postedToTemplate: { select: { id: true, name: true } },
  attachments: { orderBy: { createdAt: "asc" } },
  reactions: { select: { emoji: true, userId: true } },
} satisfies Prisma.TeamMessageInclude

type MessageWithIncludes = Prisma.TeamMessageGetPayload<{ include: typeof messageInclude }>

export function authorName(m: Pick<MessageWithIncludes, "authorStaff" | "authorUser">): string {
  return (
    m.authorStaff?.displayName ??
    m.authorUser?.name ??
    m.authorUser?.email.split("@")[0] ??
    "Unknown"
  )
}

export function serializeMessage(m: MessageWithIncludes, currentUserId: string | null) {
  const name = authorName(m)
  const counts = new Map<string, { count: number; mine: boolean }>()
  for (const r of m.reactions) {
    const e = counts.get(r.emoji) ?? { count: 0, mine: false }
    e.count++
    if (r.userId === currentUserId) e.mine = true
    counts.set(r.emoji, e)
  }
  return {
    id: m.id,
    storeId: m.storeId,
    type: m.type,
    shiftPhase: m.shiftPhase,
    body: m.body,
    status: m.status,
    author: { name, initial: name[0]?.toUpperCase() ?? "?" },
    isMine: m.authorUserId !== null && m.authorUserId === currentUserId,
    linkedIngredient: m.linkedIngredient,
    postedToTemplate: m.postedToTemplate,
    postedForDate: m.postedForDate ? m.postedForDate.toISOString().slice(0, 10) : null,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.url,
      filename: a.filename,
      youtubeId: a.kind === "youtube" ? youTubeVideoId(a.url) : null,
    })),
    reactions: ALLOWED_EMOJI.filter((e) => counts.has(e)).map((e) => ({
      emoji: e,
      count: counts.get(e)!.count,
      reactedByMe: counts.get(e)!.mine,
    })),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    resolvedAt: m.resolvedAt?.toISOString() ?? null,
    acknowledgedAt: m.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: m.acknowledgedByUser
      ? m.acknowledgedByUser.name ?? m.acknowledgedByUser.email.split("@")[0]
      : null,
    expiresAt: m.expiresAt?.toISOString() ?? null,
  }
}

export type SerializedMessage = ReturnType<typeof serializeMessage>
