import DOMPurify from "isomorphic-dompurify"
import { isEmptyRichText, looksLikeHtml } from "./rich-text"

// HR-28: ONE allowlist, shared by every write path and by the renderer.
//
// The client editor cannot be trusted with this. A payload is just JSON — the
// browser is free to send anything to POST/PATCH, and the CSV importer never
// goes near the editor at all. So the rule is: the DATABASE never holds
// unsanitized HTML (the three write paths below), and the renderer sanitizes
// AGAIN on the way out, because staff devices render whatever is stored and a
// row written before this file existed is still out there.
//
// Write paths, all three of them:
//   POST   /api/hr/training            (builder save + duplicate)
//   PATCH  /api/hr/training/[id]       (builder save)
//   POST   /api/hr/training/import     (CSV — the one the audit found)
//
// The tag set matches what the editor can PRODUCE, exactly. Anything the
// toolbar can make must survive the sanitizer, or an admin formats something,
// saves, and watches it vanish; anything the sanitizer permits but the toolbar
// cannot make is a tag with no author. No attributes at all — no class, no
// style, no href — which is what makes the allowlist a floor rather than a
// starting point: there is no attribute to smuggle a handler or a javascript:
// URL through.
const ALLOWED_TAGS = ["p", "br", "strong", "em", "b", "i", "ul", "ol", "li"]

/**
 * Sanitize a rich-text field for storage or display.
 *
 * Returns null for anything with no content left — including "<p></p>" from an
 * emptied editor and a paste that was nothing but junk markup — so the column
 * holds either real content or nothing, never markup that renders blank.
 *
 * Plain text passes through VERBATIM rather than being sanitized. This is not
 * a hole: text with no tag in it cannot carry a script, and the renderer puts
 * it in a text node. It is a correctness requirement — DOMPurify entity-encodes
 * bare ampersands, so sanitizing a CSV-imported "Tom & Jerry" would store
 * "Tom &amp; Jerry", which the plain-text branch of the renderer then shows to
 * staff exactly like that. Anything tag-SHAPED, including "<script>", takes the
 * sanitizer branch (see looksLikeHtml).
 */
export function sanitizeRichText(value: string | null | undefined): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (!looksLikeHtml(trimmed)) return trimmed

  const clean = DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
  })

  return isEmptyRichText(clean) ? null : clean
}
