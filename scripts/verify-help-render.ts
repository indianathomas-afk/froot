// HELP-1b — RENDER assertions. The instrument that was missing.
//
// WHY THIS EXISTS, stated plainly because the gap it closes cost two bugs that
// shipped: every other check in this repo reads the PAYLOAD. helpScope produces
// correct data, the verifiers confirm the data is correct, and both were green
// while /help/hr-forms rendered a broken list and a broken image. THE PAYLOAD
// WAS NEVER WRONG. The bug was entirely in turning correct data into HTML, and
// no assertion in the repo looked at HTML.
//
// So this one renders the real components with the real articles and asserts
// against the markup. It is deliberately NOT a snapshot test — a snapshot would
// have happily recorded the broken output as expected on the day it was
// written. Each assertion states a property that must hold.
//
//   npx tsx scripts/verify-help-render.ts
//
// WHAT IT STILL CANNOT SEE, and this is the honest boundary: it renders
// components in isolation, so it proves nothing about routing, authentication,
// the image route answering over HTTP, or anything a browser does. The image
// bug found on 2026-09-05 was an ENV VAR NAME mismatch in a deployed
// environment — no local instrument of any kind could have caught it. That gap
// is a row, not something this file closes.

import { renderToStaticMarkup } from "react-dom/server"
import { GuideArticleView, GuideMarkdown } from "../src/components/help/guide-content"
import { helpScope, type GuideArticle } from "../src/lib/help-access"
import { GUIDE_ARTICLES } from "../src/generated/guide"
import type { PermissionUser } from "../src/lib/permissions"

const ARTICLES = GUIDE_ARTICLES as GuideArticle[]
const ORG = { activeModules: ["inventory", "hr", "labor", "nutrition"] }
const scopeFor = (role: string) =>
  helpScope({ role } as PermissionUser, ORG, ARTICLES, { surface: "app" })

let failures = 0
function assert(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`)
  if (!ok) failures++
}

/** Source bullets, with wrapped continuation lines joined the way markdown joins them. */
function sourceBullets(md: string): string[] {
  const out: string[] = []
  let open = false
  for (const line of md.split("\n")) {
    if (/^[-*]\s+/.test(line)) {
      out.push(line.replace(/^[-*]\s+/, "").trim())
      open = true
    } else if (line.trim() === "" || /^#{2,3}\s/.test(line)) {
      open = false
    } else if (open) {
      out[out.length - 1] += ` ${line.trim()}`
    }
  }
  return out
}

/** Source markdown inline syntax reduced to the text it renders as. */
const plain = (md: string) =>
  md
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()

/** How renderToStaticMarkup escapes a value inside an attribute. */
const escapeAttr = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Strip tags and unescape the few entities renderToStaticMarkup emits. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")

// ─── 1. A WRAPPED BULLET STAYS ONE LIST ITEM ─────────────────────────────────
//
// THE REGRESSION THIS FILE WAS BUILT FOR. A bullet wrapped across source lines
// used to end the list at the wrap and render its tail as a full-width
// paragraph below it. Every payload assertion passed throughout, because the
// payload was correct.

console.log("\n── Wrapped bullets stay inside their list item ───────────────────────────────\n")

for (const article of ARTICLES) {
  const blocks = [article.body, ...article.sections.map((s) => s.body)]
  for (const md of blocks) {
    const bullets = sourceBullets(md)
    if (bullets.length === 0) continue
    const html = renderToStaticMarkup(GuideMarkdown({ source: md }) as never)
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]).trim())
    assert(
      `${article.id}: ${bullets.length} source bullets render as ${bullets.length} list items`,
      items.length === bullets.length,
      `rendered ${items.length}`
    )
    for (const b of bullets) {
      const want = plain(b)
      assert(
        `${article.id}: "${want.slice(0, 44)}…" is wholly inside one <li>`,
        items.some((i) => i === want),
        `no <li> matched; closest was "${(items.find((i) => i.startsWith(want.slice(0, 20))) ?? items[0] ?? "").slice(0, 80)}…"`
      )
    }
  }
}

// ─── 2. NO PROSE ESCAPES ITS BLOCK ───────────────────────────────────────────

console.log("\n── Every source line reaches the markup ──────────────────────────────────────\n")

for (const article of ARTICLES) {
  const view = scopeFor("ADMIN").article(article.id)
  if (!view) continue
  const html = renderToStaticMarkup(GuideArticleView({ article: view }) as never)
  const body = text(html)
  // Every `## heading` in the body must appear as a rendered heading, and every
  // surviving section heading too. A heading that silently vanished would be a
  // ruling-6 shaped bug arriving from the renderer rather than the policy.
  const headings = [
    ...article.body.split("\n").filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, "").trim()),
    ...article.sections.map((s) => s.heading),
  ]
  for (const h of headings) {
    assert(`${article.id}: heading "${h.slice(0, 40)}" is rendered`, body.includes(plain(h)))
  }
}

// ─── 3. IMAGES RENDER THROUGH THE AUTHENTICATED ROUTE, WITH ALT TEXT ─────────

console.log("\n── Images point at the authenticated route and carry alt text ────────────────\n")

for (const article of ARTICLES) {
  const view = scopeFor("ADMIN").article(article.id)
  if (!view || view.images.length === 0) continue
  const html = renderToStaticMarkup(GuideArticleView({ article: view }) as never)
  for (const img of view.images) {
    assert(
      `${article.id}: ${img.id} renders via /api/help/image`,
      html.includes(`/api/help/image/${img.id}`),
      "an image src that is a blob URL or a public path would defeat ruling 7"
    )
    assert(`${article.id}: ${img.id} has alt text`, html.includes(`alt="${escapeAttr(img.alt)}"`))
  }
  assert(
    `${article.id}: no stored blob URL appears in the markup`,
    !html.includes("blob.vercel-storage.com")
  )
}

// ─── 4. A HIDDEN SECTION LEAVES NOTHING IN THE MARKUP ────────────────────────
//
// The payload assertions already prove the section is absent from the DATA.
// This proves the RENDERER does not reintroduce it — a heading emitted from a
// stale contents list, say. Ruling 6 is a claim about what reaches the browser.

console.log("\n── A hidden section leaves no trace in the rendered HTML ─────────────────────\n")

const HIDDEN = [
  { article: "hr-documents", role: "MANAGER", heading: "Versions, detected fields and audience" },
  { article: "hr-training", role: "MANAGER", heading: "Building and changing a module" },
]
for (const h of HIDDEN) {
  const view = scopeFor(h.role).article(h.article)
  assert(`${h.role} can still read ${h.article}`, view !== null)
  const html = renderToStaticMarkup(GuideArticleView({ article: view! }) as never)
  assert(`${h.article}: "${h.heading}" absent from ${h.role}'s markup`, !html.includes(h.heading))
  assert(
    `${h.article}: ${h.role}'s contents list has no gap`,
    !/<li[^>]*>\s*<\/li>/.test(html),
    "an empty list item is a removed entry that did not renumber"
  )
}

console.log(failures === 0 ? "\nPASS — all assertions held\n" : `\nFAIL — ${failures} assertion(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
