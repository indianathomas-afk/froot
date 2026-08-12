// HR-28: the PURE half of the rich-text rule — no DOM, no DOMPurify, no jsdom.
//
// It lives in its own file rather than inside sanitize-html.ts because both
// sides need the same "is this HTML or legacy plain text?" answer, and the two
// sides run in different places: the editor is a client component, the
// sanitizer pulls in isomorphic-dompurify (and therefore jsdom). Importing the
// sanitizer from the browser to reach one regex would drag jsdom into the
// client bundle. One rule, one definition, and neither side pays for the
// other's dependencies.
//
// The three functions below are the whole of the HTML/plain-text distinction.
// If it ever changes, it changes here — the API handlers, the renderer and the
// editor all read the answer from this file.

// THIS IS THE HTML TOKENIZER'S RULE, AND IT IS COPIED RATHER THAN INVENTED.
// A browser starts a tag at `<` followed by an ASCII letter (or `</` for an end
// tag) and treats every other `<` as text. So does this.
//
// It is not "contains a `<`", because a legacy description reading "hold under
// 5 < 10 minutes" is not HTML: routing it through the sanitizer would
// entity-encode the `&` in "Tom & Jerry" to "&amp;", and the renderer — still
// seeing no tag — would emit a text node showing staff the entity literally.
//
// And it is not a full tag-shaped match either, which is what this started as
// and where the bug was. `/<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/` rejects
// `<svg/onload=alert(1)>` (the `/` is followed by a letter, not `>`), so that
// input was classified plain text and stored WITHOUT sanitizing. Nothing
// executed — the renderer's plain-text branch is a React text node, which
// escapes it — but the safety then rested on this regex agreeing with every
// future caller rather than on the string being harmless. Being at least as
// permissive as the parser is what makes "plain text" mean "no browser can find
// a tag in here", which is the property the text-node branch is entitled to
// assume.
//
// The cost, named because it is real: a legacy description containing
// something like "the <name> field" now takes the sanitizer branch and loses
// that literal, since DOMPurify drops the unknown tag and keeps its content.
// That is the correct side to err on — a browser handed the same string would
// read it as a tag too.
const HTML_TAG = /<\/?[a-z]/i

export function looksLikeHtml(value: string): boolean {
  return HTML_TAG.test(value)
}

// Does this HTML carry any actual content? Tiptap serialises an emptied editor
// as "<p></p>", which is a truthy string — without this test an admin who
// clears the description leaves a blank paragraph rendering forever, and the
// column holds markup that means nothing. Tests TEXT, not length: tags are
// stripped and &nbsp; counts as whitespace, so "<p><br></p>" and
// "<ul><li></li></ul>" are both empty, while "&amp;" is not (it is a real
// ampersand once rendered).
export function isEmptyRichText(html: string): boolean {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim().length === 0
}

// Legacy loading: a description written before HR-28 is plain text whose only
// structure is its line breaks. Dropping it into the editor as-is collapses
// every one of them, so an admin who opens an old module to fix a typo saves
// back a single run-on paragraph — the exact jumbling this row exists to fix,
// inflicted on the source rather than the render. Blank lines become
// paragraphs, single newlines become hard breaks.
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

  return escaped
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("")
}
