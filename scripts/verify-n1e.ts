/**
 * N-1e — label inbox, batch read, review queue, read from a link, pinned.
 *
 *   npx tsx scripts/verify-n1e.ts
 *
 * Rulings: docs/DECISIONS.md 2026-11-02 N-1e (Gary, DRAFT: "Accept all
 * leans"); audit docs/prompts/N-1e_AUDIT.md.
 *
 * TWO PARTS.
 *   1–8 PURE: the URL guard, the link fetcher driven by a FAKE transport and a
 *       FAKE resolver (no network), the matcher, the batch runner, the limit
 *       arithmetic, the attach questions, and source checks on the routes.
 *       Every ingredient name is invented except Almond Milk.
 *   9   DATABASE: against the database in local .env (dev), inside ONE
 *       transaction that is ALWAYS rolled back. It proves the APPLIED migration
 *       20261103010000_n1e_label_inbox stores an inbox row, that the read limit
 *       counts dialog AND inbox reads in one pool, and the 24 h reuse window.
 *       The branch is printed from `neon.branch_id`, never typed.
 *
 * WHAT THIS CAN DETECT (the prompt's list):
 *   - A suggestion never assigns: only the PATCH route writes ingredientId,
 *     and Apply is blocked until it is set.
 *   - The batch stops at the rate limit with the rest left, and resumes.
 *   - 24 h reuse is respected (found at 23 h, not at 25 h); inbox reads count
 *     toward the same 30/hour limit as dialog reads.
 *   - The URL guard refuses http://, localhost, 127.0.0.1, 10.x, 172.16–31.x,
 *     192.168.x, 169.254.169.254, IPv6 loopback / link-local / unique-local,
 *     IPv4-mapped private addresses, a redirect from a public host to a
 *     private one (by IP literal and by a name that resolves private), more
 *     than 3 redirects, HTML content (by type and by sniff), an oversize body
 *     (by Content-Length and while streaming), and mismatched first bytes.
 *   - Replacing an existing label requires the confirm; the dialog's own
 *     upload does not ask (R4).
 *   - Discard deletes the file (source check on the route).
 *
 * WHAT IT CANNOT DETECT: the real node:https connect-time check against live
 * DNS (the same guardedLookup is exercised with a fake resolver), the private
 * blob store (no Development connection — copy/put/delete run on staging), the
 * model, the routes' ADMIN gate and HTTP shapes, and the page. Those are
 * Gary's staging pass.
 */
import "dotenv/config"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../src/lib/prisma"
import {
  HTML_REFUSAL, LINK_MAX_REDIRECTS, LinkFetchError, checkLinkUrl, fetchLabelFromLink, guardedLookup, isBlockedAddress,
  linkFileName, type LinkTransport,
} from "../src/lib/safe-fetch"
import { LABEL_MAX_BYTES } from "../src/lib/nutrition-files"
import {
  ABANDONED_AFTER_DAYS, ageDays, applyBlocker, filenameText, runBatch, suggestFromFilename, suggestFromLabel, type BatchStep,
} from "../src/lib/label-match"
import { READ_HOUR_LIMIT, findRecentRead, readLimitFrom, readLimitReached, recordReuse } from "../src/lib/label-read-run"
import { attachQuestion } from "../src/lib/nutrition-proof"
import { INBOX_ENTITY, type NutritionAuditEntity } from "../src/lib/nutrition-record"

let failures = 0
let count = 0
function check(label: string, actual: unknown, expected: unknown) {
  count++
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}
const codeOf = (fn: () => unknown) => {
  try {
    fn()
    return "ok"
  } catch (e) {
    return e instanceof LinkFetchError ? e.code : `threw ${String(e)}`
  }
}
const codeOfAsync = async (p: Promise<unknown>) => {
  try {
    await p
    return "ok"
  } catch (e) {
    return e instanceof LinkFetchError ? e.code : `threw ${String(e)}`
  }
}

// ─── 1. URL guard (N1E-F4) ───────────────────────────────────────────────────
const refused: [string, string][] = [
  ["http://example.com/label.pdf", "scheme"],
  ["https://localhost/label.pdf", "host_blocked"],
  ["https://app.localhost/label.pdf", "host_blocked"],
  ["https://127.0.0.1/label.pdf", "address_blocked"],
  ["https://10.1.2.3/label.pdf", "address_blocked"],
  ["https://172.16.0.1/label.pdf", "address_blocked"],
  ["https://172.31.255.254/label.pdf", "address_blocked"],
  ["https://192.168.1.10/label.pdf", "address_blocked"],
  ["https://169.254.169.254/latest/meta-data/", "address_blocked"],
  ["https://[::1]/label.pdf", "address_blocked"],
  ["https://[fe80::1]/label.pdf", "address_blocked"],
  ["https://[fd12:3456::1]/label.pdf", "address_blocked"],
  ["https://[::ffff:10.0.0.1]/label.pdf", "address_blocked"],
  ["https://[::ffff:169.254.169.254]/x", "address_blocked"],
  ["https://0.0.0.0/label.pdf", "address_blocked"],
  ["https://100.64.0.1/label.pdf", "address_blocked"],
  ["https://user:pass@example.com/label.pdf", "userinfo"],
  ["https://example.com:8443/label.pdf", "port"],
  ["ftp://example.com/label.pdf", "scheme"],
  ["not a url", "invalid_url"],
]
for (const [u, code] of refused) check(`1. refused: ${u} → ${code}`, codeOf(() => checkLinkUrl(u)), code)
check("1. allowed: https://example.com/label.pdf, 172.15.0.1 and 172.32.0.1 (outside 172.16/12), 8.8.8.8", [
  codeOf(() => checkLinkUrl("https://example.com/label.pdf")),
  codeOf(() => checkLinkUrl("https://172.15.0.1/x.pdf")),
  codeOf(() => checkLinkUrl("https://172.32.0.1/x.pdf")),
  codeOf(() => checkLinkUrl("https://8.8.8.8/x.pdf")),
], ["ok", "ok", "ok", "ok"])
check("1. isBlockedAddress: public v4/v6 allowed, private and garbage blocked", [
  isBlockedAddress("93.184.216.34"), isBlockedAddress("2606:4700::1111"), isBlockedAddress("::1"), isBlockedAddress("fc00::1"),
  isBlockedAddress("::ffff:192.168.0.1"), isBlockedAddress("0:0:0:0:0:ffff:7f00:1"), isBlockedAddress("not-an-ip"),
], [false, false, true, true, true, true, true])

// guardedLookup — the connect-time check, with a fake resolver.
type Addr = { address: string; family: number }
const fakeDns: Record<string, Addr[]> = {
  "labels.example.com": [{ address: "93.184.216.34", family: 4 }],
  "rebind.example.com": [{ address: "10.0.0.5", family: 4 }],
  "mixed.example.com": [{ address: "93.184.216.34", family: 4 }, { address: "fd00::5", family: 6 }],
  "meta.example.com": [{ address: "169.254.169.254", family: 4 }],
}
const resolver = async (h: string) => fakeDns[h] ?? []
function lookupResult(host: string, all: boolean): Promise<string> {
  return new Promise((resolve) => {
    guardedLookup(resolver)(host, { all }, (err: NodeJS.ErrnoException | null, address: unknown) => {
      if (err) resolve(err instanceof LinkFetchError ? err.code : String(err))
      else resolve(Array.isArray(address) ? address.map((a) => a.address).join(",") : String(address))
    })
  })
}

// ─── 2. The fetcher, through a fake transport (no network) ───────────────────
const PDF = new TextEncoder().encode("%PDF-1.7\n% fake label\n")
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
async function* chunks(...parts: Uint8Array[]) {
  for (const p of parts) yield p
}
type Route = { status: number; headers: Record<string, string>; body?: () => AsyncIterable<Uint8Array> }
/** A transport that resolves each host through guardedLookup(fakeDns) first — the same check the real one makes. */
function fakeTransport(routes: Record<string, Route>): LinkTransport & { hits: string[] } {
  const hits: string[] = []
  const t: LinkTransport = async (url) => {
    hits.push(url.toString())
    const host = url.hostname.replace(/^\[|\]$/g, "")
    if (!/^[\d.:a-f]+$/.test(host)) {
      const r = await lookupResult(host, true)
      if (!/^[\d.:a-f,]+$/.test(r)) throw new LinkFetchError("blocked by lookup", r)
    }
    const route = routes[url.toString()]
    if (!route) return { status: 404, headers: {}, body: chunks(), abort: () => {} }
    return { status: route.status, headers: route.headers, body: route.body ? route.body() : chunks(), abort: () => {} }
  }
  return Object.assign(t, { hits })
}
const ok = (type: string, body: Uint8Array, extra: Record<string, string> = {}): Route => ({
  status: 200, headers: { "content-type": type, ...extra }, body: () => chunks(body),
})
const redirect = (to: string): Route => ({ status: 302, headers: { location: to } })

async function fetcherPart() {
  check("2a. lookup: a public name resolves", await lookupResult("labels.example.com", false), "93.184.216.34")
  check("2b. lookup: a name that resolves private is refused (DNS rebinding)", await lookupResult("rebind.example.com", true), "address_blocked")
  check("2c. lookup: refused when ANY address is private", await lookupResult("mixed.example.com", true), "address_blocked")
  check("2d. lookup: a name pointing at the metadata address is refused", await lookupResult("meta.example.com", false), "address_blocked")

  const good = await fetchLabelFromLink("https://labels.example.com/almond.pdf", {
    transport: fakeTransport({ "https://labels.example.com/almond.pdf": ok("application/pdf; charset=binary", PDF) }),
  })
  check("2e. a direct PDF link is fetched: bytes, type, no redirects", [good.bytes.byteLength, good.contentType, good.redirects], [PDF.byteLength, "application/pdf", 0])
  check("2f. the file is named from the link", linkFileName(good.finalUrl, good.contentType), "almond.pdf")

  check("2g. redirect from a public host to 169.254.169.254 → refused", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/a.pdf", {
    transport: fakeTransport({ "https://labels.example.com/a.pdf": redirect("https://169.254.169.254/latest/meta-data/") }),
  })), "address_blocked")
  check("2h. redirect from a public host to a name that resolves private → refused at the lookup", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/a.pdf", {
    transport: fakeTransport({ "https://labels.example.com/a.pdf": redirect("https://rebind.example.com/a.pdf") }),
  })), "address_blocked")
  check("2i. redirect to http:// → refused", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/a.pdf", {
    transport: fakeTransport({ "https://labels.example.com/a.pdf": redirect("http://labels.example.com/a.pdf") }),
  })), "scheme")
  const hops: Record<string, Route> = {}
  for (let i = 0; i <= LINK_MAX_REDIRECTS; i++) hops[`https://labels.example.com/${i}`] = redirect(`https://labels.example.com/${i + 1}`)
  hops[`https://labels.example.com/${LINK_MAX_REDIRECTS + 1}`] = ok("application/pdf", PDF)
  check(`2j. more than ${LINK_MAX_REDIRECTS} redirects → refused`, await codeOfAsync(fetchLabelFromLink("https://labels.example.com/0", { transport: fakeTransport(hops) })), "too_many_redirects")
  const three: Record<string, Route> = {}
  for (let i = 0; i < LINK_MAX_REDIRECTS; i++) three[`https://labels.example.com/r${i}`] = redirect(`https://labels.example.com/r${i + 1}`)
  three[`https://labels.example.com/r${LINK_MAX_REDIRECTS}`] = ok("application/pdf", PDF)
  check(`2k. exactly ${LINK_MAX_REDIRECTS} redirects is fine`, (await fetchLabelFromLink("https://labels.example.com/r0", { transport: fakeTransport(three) })).redirects, LINK_MAX_REDIRECTS)

  let htmlMsg = ""
  try {
    await fetchLabelFromLink("https://labels.example.com/product", {
      transport: fakeTransport({ "https://labels.example.com/product": ok("text/html; charset=utf-8", new TextEncoder().encode("<!doctype html>")) }),
    })
  } catch (e) {
    htmlMsg = e instanceof LinkFetchError ? `${e.code}: ${e.message}` : String(e)
  }
  check("2l. an HTML product page → refused with the save-the-image instruction", htmlMsg, `html: ${HTML_REFUSAL}`)
  check("2m. HTML served as application/pdf → still refused as HTML (by sniff)", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/p.pdf", {
    transport: fakeTransport({ "https://labels.example.com/p.pdf": ok("application/pdf", new TextEncoder().encode("  <html><body>")) }),
  })), "html")
  check("2n. oversize by Content-Length → refused before reading", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/big.pdf", {
    transport: fakeTransport({ "https://labels.example.com/big.pdf": ok("application/pdf", PDF, { "content-length": String(LABEL_MAX_BYTES + 1) }) }),
  })), "too_large")
  const MB = new Uint8Array(1024 * 1024)
  check("2o. oversize while streaming (no Content-Length, 11 × 1 MB) → refused", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/stream.pdf", {
    transport: fakeTransport({
      "https://labels.example.com/stream.pdf": { status: 200, headers: { "content-type": "application/pdf" }, body: () => chunks(PDF, ...Array(11).fill(MB)) },
    }),
  })), "too_large")
  check("2p. mismatched first bytes (says PNG, is a PDF) → refused", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/x.png", {
    transport: fakeTransport({ "https://labels.example.com/x.png": ok("image/png", PDF) }),
  })), "mismatch")
  check("2q. a PNG that is a PNG is accepted", (await fetchLabelFromLink("https://labels.example.com/x.png", {
    transport: fakeTransport({ "https://labels.example.com/x.png": ok("image/png", PNG) }),
  })).contentType, "image/png")
  check("2r. HEIC by link → refused (not readable)", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/x.heic", {
    transport: fakeTransport({ "https://labels.example.com/x.heic": ok("image/heic", PNG) }),
  })), "heic")
  check("2s. any other type (application/zip) → refused", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/x.zip", {
    transport: fakeTransport({ "https://labels.example.com/x.zip": ok("application/zip", PDF) }),
  })), "type")
  check("2t. a 404 → refused", await codeOfAsync(fetchLabelFromLink("https://labels.example.com/missing.pdf", { transport: fakeTransport({}) })), "http_status")
  check("2u. the http:// guard fires before any request is made", await (async () => {
    const t = fakeTransport({})
    await codeOfAsync(fetchLabelFromLink("http://labels.example.com/a.pdf", { transport: t }))
    return t.hits.length
  })(), 0)
}

// ─── 3. Matching: suggest, never assign (N1E-F2) ─────────────────────────────
const ING = [
  { id: "almond-orig", name: "Almond Milk Original", brand: "Almond Breeze" },
  { id: "almond-unsw", name: "Almond Milk Unsweetened", brand: "Almond Breeze" },
  { id: "oat", name: "Oat Milk", brand: "Oatly" },
  { id: "honey", name: "Clover Honey", brand: null },
  { id: "mango", name: "Mango Puree", brand: "Fixture Farms" },
]
check("3a. filenameText strips extension, noise and camelCase", filenameText("MangoPuree_nutrition-label_2024.pdf"), "Mango Puree")
check("3b. a clear filename suggests", suggestFromFilename("mango-puree-spec-sheet.pdf", ING).suggestedId, "mango")
check("3c. IMG_4021.jpg suggests nothing", suggestFromFilename("IMG_4021.jpg", ING).suggestedId, null)
check("3d. 'almond milk' in a filename is a tie between two variants → nothing suggested", suggestFromFilename("almond-milk.pdf", ING).suggestedId, null)
check("3e. … but both are offered as the top options", suggestFromFilename("almond-milk.pdf", ING).options.slice(0, 2).map((o) => o.id).sort(), ["almond-orig", "almond-unsw"])
check("3f. the label names Unsweetened → Unsweetened suggested (brand-aware, almondmilk folded)", suggestFromLabel({ brand: "Almond Breeze", productName: "Almondmilk Unsweetened" }, ING).suggestedId, "almond-unsw")
check("3g. a variant the ingredient doesn't have is never suggested (Vanilla vs Original/Unsweetened)", suggestFromLabel({ brand: "Almond Breeze", productName: "Almondmilk Vanilla" }, ING).suggestedId, null)
check("3h. an unrelated label suggests nothing", suggestFromLabel({ brand: "Acme", productName: "Sparkling Water" }, ING).suggestedId, null)
check("3i. one shared word is not a match ('Milk' alone)", suggestFromLabel({ brand: "", productName: "Whole Milk" }, ING).suggestedId, null)

// ─── 4. Apply is blocked until an ADMIN confirms the ingredient ──────────────
const readItem = { status: "READ" as const, readAuditId: "a1", fileUrl: "blob", ingredientId: null }
check("4a. read + only a SUGGESTION → Apply blocked", applyBlocker({ ...readItem }), "Confirm which ingredient this label is for")
check("4b. read + confirmed → Apply allowed", applyBlocker({ ...readItem, ingredientId: "mango" }), null)
check("4c. not read yet → blocked even when confirmed", applyBlocker({ ...readItem, status: "UPLOADED", readAuditId: null, ingredientId: "mango" }), "Read the label first")
check("4d. applied / discarded → blocked", [applyBlocker({ ...readItem, ingredientId: "m", status: "APPLIED" }), applyBlocker({ ...readItem, ingredientId: "m", status: "DISCARDED", fileUrl: null })], ["Already applied", "This file was discarded"])

// Source check: the ONLY write of NutritionLabelInboxItem.ingredientId is the PATCH route.
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
}
const inboxSources = [...filesUnder("src/app/api/nutrition/labels"), "src/lib/label-inbox.ts", "src/lib/label-match.ts"]
const writers = inboxSources.filter((f) => /data:\s*\{[^}]*\bingredientId\b/.test(readFileSync(f, "utf8")))
check("4e. only PATCH /api/nutrition/labels/[id] writes ingredientId (a suggestion never assigns)", writers, ["src/app/api/nutrition/labels/[id]/route.ts"])
const readRoute = readFileSync("src/app/api/nutrition/labels/[id]/read/route.ts", "utf8")
check("4f. the read route writes only suggestedIngredientId, and never over a confirmed ingredient", [/suggestedIngredientId: suggestion\.suggestedId/.test(readRoute), /item\.ingredientId\s*\?\s*null/.test(readRoute)], [true, true])

// ─── 5. Batch: one at a time, stop at the limit, resume (N1E-F3) ─────────────
async function batchPart() {
  const order: string[] = []
  let limitedOnce = false
  const step = async (id: string): Promise<BatchStep> => {
    order.push(id)
    if (id === "c" && !limitedOnce) {
      limitedOnce = true
      return { ok: false, limited: true, retryAt: "2026-11-02T20:00:00.000Z", error: "limit" }
    }
    if (id === "b") return { ok: false, limited: false, error: "unreadable" }
    return { ok: true }
  }
  const first = await runBatch(["a", "b", "c", "d", "e"], step)
  check("5a. stops at the limit: a done, b failed (its own row), c–e left", [first.done, first.failed.map((f) => f.id), first.left, first.stoppedAt?.retryAt], [["a"], ["b"], ["c", "d", "e"], "2026-11-02T20:00:00.000Z"])
  const second = await runBatch(first.left, step)
  check("5b. resumes with what was left and finishes", [second.done, second.left, second.stoppedAt], [["c", "d", "e"], [], null])
  check("5c. strictly sequential, c retried exactly once after the stop", order, ["a", "b", "c", "c", "d", "e"])
}

// ─── 6. Limit arithmetic (unchanged N-1c numbers) ────────────────────────────
const NOW = Date.parse("2026-11-02T18:00:00.000Z")
const mins = (m: number) => NOW - m * 60_000
check("6a. 29 reads in the hour → not limited", readLimitFrom(Array.from({ length: 29 }, (_, i) => mins(i + 1)), NOW), null)
const at30 = readLimitFrom(Array.from({ length: 30 }, (_, i) => mins(i + 1)), NOW)
check("6b. 30 → limited; retry when the oldest (30 min ago) ages out", [at30?.retryAt.toISOString(), /30 label reads an hour\. Try again in 30 minutes\./.test(at30?.message ?? "")], [new Date(mins(30) + 3_600_000).toISOString(), true])
check("6c. 300 across the day, few this hour → the daily limit", /300 label reads a day/.test(readLimitFrom(Array.from({ length: 300 }, (_, i) => mins(61 + i * 4)), NOW)?.message ?? ""), true)
check("6d. reads older than 24 h don't count", readLimitFrom(Array.from({ length: 400 }, (_, i) => mins(24 * 60 + 1 + i)), NOW), null)

// ─── 7. Replace requires the confirm (N1E-F5, R4) ────────────────────────────
const labelled = { labelFileUrl: "blob://old", status: "ESTIMATED" as const }
const verified = { labelFileUrl: "blob://old", status: "VERIFIED" as const }
check("7a. queue/link: an existing label → CONFIRM_REPLACE", attachQuestion(labelled, { askReplace: true }), "CONFIRM_REPLACE")
check("7b. … answered → no question", attachQuestion(labelled, { askReplace: true, replaceLabel: true }), null)
check("7c. … replaceLabel:false is not an answer → still asked", attachQuestion(labelled, { askReplace: true, replaceLabel: false }), "CONFIRM_REPLACE")
check("7d. no existing label → nothing asked", attachQuestion({ labelFileUrl: null, status: "ESTIMATED" }, { askReplace: true }), null)
check("7e. VERIFIED: replace first, then Still verified?", [attachQuestion(verified, { askReplace: true }), attachQuestion(verified, { askReplace: true, replaceLabel: true }), attachQuestion(verified, { askReplace: true, replaceLabel: true, keepVerified: false })], ["CONFIRM_REPLACE", "CONFIRM_STILL_VERIFIED", null])
check("7f. R4: the dialog's own upload never asks Replace (only Still verified?)", [attachQuestion(labelled, { askReplace: false }), attachQuestion(verified, { askReplace: false })], [null, "CONFIRM_STILL_VERIFIED"])
const attachRoute = readFileSync("src/app/api/nutrition/labels/[id]/attach/route.ts", "utf8")
const linkRoute = readFileSync("src/app/api/nutrition/ingredients/[id]/label/from-link/route.ts", "utf8")
const uploadRoute = readFileSync("src/app/api/nutrition/ingredients/[id]/label/route.ts", "utf8")
check("7g. attach and from-link ask Replace; the upload route does not", [/askReplace: true/.test(attachRoute), /askReplace: true/.test(linkRoute), /askReplace: false/.test(uploadRoute)], [true, true, true])
check("7h. from-link asks BEFORE fetching", linkRoute.indexOf("attachQuestion(") < linkRoute.indexOf("fetchLabelFromLink(url)"), true)

// ─── 8. Discard deletes the file; leftovers ──────────────────────────────────
const itemRoute = readFileSync("src/app/api/nutrition/labels/[id]/route.ts", "utf8")
const oldRoute = readFileSync("src/app/api/nutrition/labels/discard-old/route.ts", "utf8")
check("8a. DELETE marks DISCARDED, clears fileUrl, and deletes the blob", [/status: "DISCARDED", fileUrl: null/.test(itemRoute), /deleteLabelBlob\(item\.fileUrl\)/.test(itemRoute)], [true, true])
check("8b. discard-old deletes every discarded file", /for \(const i of old\) await deleteLabelBlob\(i\.fileUrl\)/.test(oldRoute), true)
check("8c. age in whole UTC days; 7 days is the cut-off", [ageDays(new Date("2026-10-26T18:00:01Z"), new Date(NOW)), ageDays(new Date("2026-10-26T18:00:00Z"), new Date(NOW)), ABANDONED_AFTER_DAYS], [6, 7, 7])
const migration = readFileSync("prisma/migrations_archive/20261103010000_n1e_label_inbox/migration.sql", "utf8")
check("8d. the migration is additive only", [/DROP (COLUMN|TABLE|CONSTRAINT|INDEX)/i.test(migration), /ALTER TABLE "(?!NutritionLabelInboxItem)/.test(migration)], [false, false])

// ─── 9. Against the applied schema (dev), rolled back ────────────────────────
class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { clerkOrgId: `n1e-fixture-${Date.now()}`, name: "N-1e Fixture Org" } })
      const item = await tx.nutritionLabelInboxItem.create({
        data: { organizationId: org.id, fileName: "N-1e fixture label.pdf", contentType: "application/pdf", sizeBytes: 10, fileHash: "n1e-hash", fileUrl: "blob://n1e" },
      })
      check("9a. an inbox row stores with status UPLOADED and no ingredient", [item.status, item.ingredientId, item.suggestedIngredientId], ["UPLOADED", null, null])

      const now = Date.now()
      const at = (msAgo: number) => new Date(now - msAgo)
      const output = {
        isNutritionLabel: true, productName: "Fixture", brand: "", servingSizeText: "1 cup (240mL)", nutrients: [],
        containsText: "", mayContainText: "", allergens: [], unreadable: [],
      }
      // 24 h reuse: a read 23 h ago is found, one 25 h ago is not.
      await tx.auditLog.create({ data: { organizationId: org.id, action: "nutrition.label.read", entityType: INBOX_ENTITY, entityId: item.id, createdAt: at(25 * 3_600_000), metadata: { fileHash: "old-hash", output } } })
      const fresh = await tx.auditLog.create({ data: { organizationId: org.id, action: "nutrition.label.read", entityType: INBOX_ENTITY, entityId: item.id, createdAt: at(23 * 3_600_000), metadata: { fileHash: "n1e-hash", output, readAt: at(23 * 3_600_000).toISOString() } } })
      const both: { entityType: NutritionAuditEntity }[] = [{ entityType: "Ingredient" }, { entityType: INBOX_ENTITY }]
      check("9b. 24 h reuse: a read of the same file 23 h ago is found (by hash, across subjects)", (await findRecentRead(org.id, "n1e-hash", both, now, tx))?.id, fresh.id)
      check("9c. … one 25 h ago is not", await findRecentRead(org.id, "old-hash", both, now, tx), null)

      // A reuse writes a .reused row and is not counted.
      const reused = await recordReuse({ org, dbUser: null }, { entityType: "Ingredient", entityId: "n1e-ingredient" }, fresh, { fileName: "x.pdf", fileHash: "n1e-hash", contentType: "application/pdf" }, tx)
      check("9d. recordReuse writes a .reused row carrying the read", [Boolean(reused?.readId), reused?.reused, reused?.output.productName], [true, true, "Fixture"])

      // One pool: 15 dialog reads + 15 inbox reads in the last hour → limited.
      const counted = (n: number, entityType: string) =>
        Promise.all(Array.from({ length: n }, (_, i) => tx.auditLog.create({ data: { organizationId: org.id, action: i % 3 === 0 ? "nutrition.label.read.failed" : "nutrition.label.read", entityType, entityId: "x", createdAt: at((i + 1) * 60_000), metadata: {} } })))
      await counted(14, "Ingredient")
      await counted(14, INBOX_ENTITY)
      check("9e. 28 counted reads + 1 reuse → not limited (reuses don't count)", await readLimitReached(org.id, now, tx), null)
      await counted(1, "Ingredient")
      await counted(1, INBOX_ENTITY)
      const lim = await readLimitReached(org.id, now, tx)
      check(`9f. dialog AND inbox reads share one pool: ${READ_HOUR_LIMIT} → limited`, Boolean(lim && /30 label reads an hour/.test(lim.message)), true)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-1e Fixture Org" } })
  check("9g. rolled back: no fixture rows left behind", leaked, 0)
}

fetcherPart()
  .then(batchPart)
  .then(dbPart)
  .catch((e) => {
    failures++
    console.log(`✗ async part threw: ${e instanceof Error ? e.stack : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? `\n✓ ALL PASS (${count} checks)` : `\n✗ ${failures} of ${count} CHECK(S) FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
