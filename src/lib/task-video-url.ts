// ─── CHK-20: a task's training video is a web link or nothing ────────────────
// Task.videoUrl is free text (String?, no constraint) and every surface that
// shows it puts it in an href. Before this file a value like `javascript:…`
// was saved as typed and rendered as a clickable "Watch Training Video" link
// for every team member on the desktop checklist page. TAB-15 had already
// closed that on the tablet with a private http(s) check in tablet-data.ts;
// this is that check made shared, so EVERY reader and writer applies one rule.
//
// THE RULE. Trim. A value that names a scheme must be http: or https:, and
// anything else — javascript:, data:, file:, mailto:, any case, any leading
// whitespace — is refused. A value with no scheme that looks like a web
// address (www.youtube.com/watch?v=…, youtu.be/…) gets https:// in front. A
// value containing whitespace or a control character inside it is refused
// outright: browsers strip tabs and newlines out of URLs, which is how
// `java\tscript:` turns back into `javascript:`, and no real video link has a
// space in it.
//
// THE RETURN VALUE IS THE TYPED STRING, NOT `new URL(x).href`. The URL parser
// is used only to judge the value; returning its normalised form would add a
// trailing slash to https://example.com and re-encode characters, so a link
// that was already correct would change on save and on every render.
//
// NO IMPORTS, deliberately: this runs in the browser bundle (the template
// editor and the desktop checklist page are client components) as well as in
// the API routes and the tablet's server-side loader.
//
// NO BACKFILL (CHK-20 prompt, step 2.5). A bad value already in the database
// is not rewritten; it simply stops rendering, because every reader runs it
// through `safeVideoUrl` and shows nothing for null.

/** The inline message under the field, and the server's 400, word for word. */
export const TASK_VIDEO_URL_ERROR = "Use a web link that starts with https://"

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
// A dotted hostname whose last label is letters, an optional port, then the
// end or a path/query/fragment. Checked BEFORE the scheme test, because
// `youtube.com:443/x` would otherwise read as a scheme named "youtube.com".
const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/i
const SPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/

function isWebUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate)
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * A clean http(s) URL for a task's training video, or null.
 * Null means "show nothing" to a reader and "refuse" to a writer (a writer
 * first treats ""/whitespace as no link at all — see `normalizeTaskVideoUrl`).
 */
export function safeVideoUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (!value || SPACE_OR_CONTROL.test(value)) return null
  if (BARE_HOST.test(value)) {
    const withScheme = `https://${value}`
    return isWebUrl(withScheme) ? withScheme : null
  }
  if (!SCHEME.test(value)) return null
  return isWebUrl(value) ? value : null
}

/**
 * The WRITE-side reading of the same rule. Blank means the task has no video
 * (the editor sends "" for an untouched field) and is stored as NULL; anything
 * typed must pass `safeVideoUrl` or the write is refused.
 */
export function normalizeTaskVideoUrl(
  raw: string | null | undefined
): { ok: true; value: string | null } | { ok: false } {
  if (raw == null || (typeof raw === "string" && !raw.trim())) return { ok: true, value: null }
  const value = safeVideoUrl(raw)
  return value ? { ok: true, value } : { ok: false }
}

/** The stored value for a task that has ALREADY passed `taskVideoUrlRefusal`. */
export function storedTaskVideoUrl(raw: unknown): string | null {
  const r = normalizeTaskVideoUrl(typeof raw === "string" ? raw : raw == null ? null : String(raw))
  return r.ok ? r.value : null
}

/**
 * THE SERVER HALF OF THE EDITOR'S RULE, for POST /api/templates and PATCH
 * /api/templates/[id] — the two routes every editor save and every Duplicate
 * goes through. Returns the 400 message for the first task whose link fails,
 * or null when every task is fine. A non-string videoUrl (a hand-made request
 * sending a number or an object) is refused, not coerced.
 */
export function taskVideoUrlRefusal(
  tasks: readonly { description?: unknown; videoUrl?: unknown }[]
): string | null {
  for (const t of tasks) {
    const v = t.videoUrl
    const ok = v == null || (typeof v === "string" && normalizeTaskVideoUrl(v).ok)
    if (!ok) {
      const d = typeof t.description === "string" ? t.description.trim() : ""
      const label = d ? `"${d.length > 40 ? `${d.slice(0, 40)}…` : d}"` : "A task"
      return `${label}: ${TASK_VIDEO_URL_ERROR}`
    }
  }
  return null
}
