import sanitizeHtmlLib from "sanitize-html"
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
// WHY sanitize-html AND NOT DOMPurify, WHICH THIS SHIPPED WITH FIRST. HR-28
// originally used isomorphic-dompurify. It built green everywhere and 500'd on
// staging on the first real request: DOMPurify needs a DOM, isomorphic-dompurify
// supplies one with jsdom, and jsdom@30's own tree crosses a broken module
// boundary — html-encoding-sniffer@6 is CommonJS and require()s
// @exodus/bytes@1, which is ESM-only, so the serverless CJS loader throws
// ERR_REQUIRE_ESM. Adding it to serverExternalPackages was tried FIRST and was
// insufficient: it changed the error rather than fixing it, because making the
// package externally required is precisely what forces the runtime require()
// that fails.
//
// sanitize-html needs no DOM at all — it parses with htmlparser2 — so the whole
// class of failure goes away rather than moving. It must stay OUT of
// serverExternalPackages: bundled, the ESM in its tree is resolved at build
// time and never hits a runtime require().
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
 * it in a text node. It is a correctness requirement — the sanitizer
 * entity-encodes bare ampersands, so sanitizing a CSV-imported "Tom & Jerry"
 * would store "Tom &amp; Jerry", which the plain-text branch of the renderer
 * then shows to staff exactly like that. Anything tag-SHAPED, including
 * "<script>", takes the sanitizer branch (see looksLikeHtml).
 *
 * Verified byte-identical to the previous DOMPurify implementation across all
 * 19 cases in the HR-28 audit's harness (§10.1), including every XSS vector,
 * Google Docs and Word paste, real Tiptap output, and the legacy plain-text
 * cases. The one difference found was <br> serialisation, normalized below.
 */
export function sanitizeRichText(value: string | null | undefined): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (!looksLikeHtml(trimmed)) return trimmed

  const clean = sanitizeHtmlLib(trimmed, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
  })
    // sanitize-html emits void elements XHTML-style ("<br />"); DOMPurify and
    // Tiptap both emit "<br>". Normalized so every row in the column carries
    // one form, including rows written before the library swap. Safe as a
    // literal replace because it runs AFTER sanitizing, on output that holds
    // only allowlisted tags and no attributes — a "<br />" in the author's own
    // TEXT was escaped to "&lt;br /&gt;" and cannot match. Do NOT reach for
    // sanitize-html's `selfClosing: []` instead: that emits "<br></br>", which
    // a browser parses as TWO line breaks.
    .replace(/<br \/>/g, "<br>")

  return isEmptyRichText(clean) ? null : clean
}
