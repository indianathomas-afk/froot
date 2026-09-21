// ─── NOTIFY-2b: the one email template ───────────────────────────────────────
// Every email Froot sends renders through renderEmail(). There is no
// per-consumer HTML anywhere in the codebase and adding some is the thing this
// file exists to prevent — a second template is a second place for the brand to
// drift, and mail is the one surface nobody looks at until a customer does.
//
// HTML RULES, all of them forced by mail clients rather than taste:
//   - TABLES, not divs. Outlook renders through Word's engine; flex and grid do
//     not exist there.
//   - INLINE STYLES ONLY. Gmail strips <style> blocks in some contexts and
//     every client strips <link>. Nothing here loads anything.
//   - HEX COLOURS, never the app's oklch() tokens. src/app/globals.css is the
//     source of the values below; oklch is unsupported in every major client,
//     so the tokens are converted once, here, and named so the next person can
//     re-derive them rather than guess.
//   - SYSTEM FONT STACK. No web fonts — @font-face is stripped or ignored.
//   - ONE IMAGE, the mark, and only when a host is known. No tracking pixel, no
//     spacer gifs, no decorative images.
//   - 600px max width, single column, which is the width every client has
//     rendered without horizontal scroll since the Outlook 2007 engine.
//
// THE TEXT PART IS NOT DECORATION. Every message is sent multipart: the HTML is
// the alternative body, the text is what a plain-text client, a screen reader
// in text mode, and every spam filter actually reads. A message with no text
// part scores worse and reads as a blank in some clients.

// The app's design tokens, converted from oklch() to sRGB hex. Recompute with
// the same conversion if globals.css ever moves:
//   --color-primary          oklch(65% .2 35)    → #f0532b
//   --color-foreground       oklch(18% .03 50)   → #1c0d06
//   --color-muted-foreground oklch(45% .03 50)   → #635147
//   --color-border           oklch(85% .02 65)   → #d7cbc1
//   --color-muted            oklch(90% .02 65)   → #e8dcd1
//   --color-background       oklch(97% .02 65)   → #fff3e8
const ORANGE = "#f0532b"
const INK = "#1c0d06"
const MUTED_INK = "#635147"
const BORDER = "#d7cbc1"
const HAIRLINE = "#e8dcd1"
const PAGE_BG = "#fff3e8"
const CARD_BG = "#ffffff"

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

export type EmailRow = { label: string; value: string }

export type EmailTemplateInput = {
  /** Tenant name, rendered in the header as "on behalf of <orgName>". */
  orgName: string
  /** One line, the subject restated as a sentence. First thing in the body. */
  heading: string
  /** One short paragraph under the heading. Empty string omits it. */
  intro: string
  /** Label/value pairs rendered as a two-column table. */
  rows: EmailRow[]
  cta?: { label: string; url: string }
  /** The closing line. Today every consumer says the address takes no replies. */
  footer: string
  /**
   * Absolute origin (NEXT_PUBLIC_APP_URL). OPTIONAL, and the fallback is F1's
   * fallback branch: with no host there is no absolute URL for the mark, so the
   * header renders the wordmark alone rather than a broken image. A relative
   * src is worse than none — mail has no base URL to resolve it against.
   */
  appUrl?: string
  /**
   * EXACT text body, used verbatim when supplied. This is how a consumer whose
   * wording predates the template keeps its text byte-identical while still
   * getting branded HTML — see the NOTIFY-2b note in each consumer. When it is
   * absent the text part is GENERATED from the fields above, which is the path
   * a new consumer should take.
   */
  text?: string
}

/**
 * HTML-escape a value destined for element text or an attribute.
 *
 * EVERY interpolated value goes through this, without exception — org names,
 * store names and signer names are tenant-supplied strings and an email body is
 * a document that gets forwarded. Escaping `<` is also what keeps the fixture's
 * "no <script" assertion honest for a hostile org name rather than only for a
 * well-behaved one.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Absolute http(s) URL or nothing.
 *
 * A malformed NEXT_PUBLIC_APP_URL, or a CTA built from one, must not put a
 * `javascript:` or `data:` href into a document that gets forwarded — so the
 * scheme is allowlisted rather than sanitised.
 */
function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null
  } catch {
    return null
  }
}

function headerBar(orgName: string, appUrl?: string): string {
  const logo = safeUrl(appUrl ? new URL("/logo.png", appUrl).toString() : undefined)
  // THE MARK SITS ON A WHITE TILE AND THAT IS NOT DECORATION (F1 rider,
  // NOTIFY-2b). public/logo.png is an ORANGE citrus slice on transparency;
  // placed straight onto the orange bar it disappears. The tile is the smallest
  // thing that keeps both the bar and the mark.
  const mark = logo
    ? `<td width="52" style="padding-right:12px;">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td align="center" style="background-color:${CARD_BG};border-radius:8px;padding:5px;">` +
      `<img src="${esc(logo)}" width="30" height="30" alt="Froot" style="display:block;width:30px;height:30px;border:0;outline:none;text-decoration:none;">` +
      `</td></tr></table></td>`
    : ""
  return (
    `<tr><td style="background-color:${ORANGE};padding:16px 24px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    mark +
    `<td style="font-family:${FONT};font-size:14px;line-height:20px;color:${CARD_BG};font-weight:600;">` +
    `USE Froot<span style="font-weight:400;"> &middot; on behalf of ${esc(orgName)}</span>` +
    `</td></tr></table></td></tr>`
  )
}

function rowsTable(rows: EmailRow[]): string {
  if (rows.length === 0) return ""
  const cells = rows
    .map((r, i) => {
      // No hairline under the last row — a rule with nothing beneath it reads
      // as a truncated table.
      const rule = i === rows.length - 1 ? "" : `border-bottom:1px solid ${HAIRLINE};`
      const base = `padding:9px 0;${rule}font-family:${FONT};font-size:13px;line-height:20px;vertical-align:top;`
      return (
        `<tr>` +
        `<td style="${base}color:${MUTED_INK};width:38%;">${esc(r.label)}</td>` +
        `<td style="${base}color:${INK};">${esc(r.value)}</td>` +
        `</tr>`
      )
    })
    .join("")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${cells}</table>`
}

function ctaButton(cta: { label: string; url: string } | undefined): string {
  const url = safeUrl(cta?.url)
  if (!cta || !url) return ""
  // A BORDERED LINK, NOT A FILLED BUTTON. Filled buttons need a background
  // colour on a <td> plus a VML fallback to survive Outlook; a bordered anchor
  // degrades to a plain link everywhere and needs neither.
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding-top:22px;">` +
    `<a href="${esc(url)}" style="display:inline-block;padding:10px 18px;border:2px solid ${ORANGE};border-radius:8px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${ORANGE};text-decoration:none;">${esc(cta.label)}</a>` +
    `</td></tr></table>`
  )
}

function renderHtml(input: EmailTemplateInput): string {
  const intro = input.intro.trim()
  // Preview text — the grey line an inbox shows beside the subject. Hidden in
  // the body itself. Text only; this is NOT a tracking pixel and loads nothing.
  const preheader = intro || input.heading

  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `<title>${esc(input.heading)}</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${PAGE_BG};">` +
    `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;font-size:1px;line-height:1px;color:${PAGE_BG};">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${CARD_BG};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">` +
    headerBar(input.orgName, input.appUrl) +
    `<tr><td style="padding:24px;">` +
    `<h1 style="margin:0 0 ${intro ? "10px" : "18px"};font-family:${FONT};font-size:18px;line-height:26px;font-weight:600;color:${INK};">${esc(input.heading)}</h1>` +
    (intro
      ? `<p style="margin:0 0 18px;font-family:${FONT};font-size:14px;line-height:22px;color:${MUTED_INK};">${esc(intro)}</p>`
      : "") +
    rowsTable(input.rows) +
    ctaButton(input.cta) +
    `</td></tr>` +
    `<tr><td style="padding:16px 24px 22px;border-top:1px solid ${HAIRLINE};">` +
    `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED_INK};">${esc(input.footer)}</p>` +
    `</td></tr>` +
    `</table></td></tr></table>` +
    `</body></html>`
  )
}

/**
 * The generated text part, used when a consumer supplies no `text` override.
 *
 * Column width follows HR-16's existing wording — the label including its colon
 * padded so the widest one is followed by two spaces — because that is the
 * shape the only hand-written padded email in the repo already uses, and a
 * second convention would make two emails that came from one template look like
 * they did not.
 */
function renderText(input: EmailTemplateInput): string {
  const lines: string[] = [input.heading]
  const intro = input.intro.trim()
  if (intro) lines.push("", intro)

  if (input.rows.length > 0) {
    const width = Math.max(...input.rows.map((r) => r.label.length + 1)) + 2
    lines.push("")
    for (const r of input.rows) lines.push(`${(r.label + ":").padEnd(width)}${r.value}`)
  }

  const url = safeUrl(input.cta?.url)
  if (url) lines.push("", url)
  lines.push("", input.footer)
  return lines.join("\n")
}

/**
 * Render one message. `html` is the alternative body; `text` is the plain part
 * — the consumer's own string when it supplied one, otherwise generated.
 */
export function renderEmail(input: EmailTemplateInput): { html: string; text: string } {
  return { html: renderHtml(input), text: input.text ?? renderText(input) }
}
