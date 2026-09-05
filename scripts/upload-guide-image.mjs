// Upload a redacted guide screenshot to the private froot-guide Blob store.
//
// Step 5 of the capture workflow (audit §J): capture into docs/guide/_raw/,
// redact by hand into docs/guide/_review/, then upload from there with this.
// The frontmatter references the pathname this prints — never a local path, and
// never the stored blob URL.
//
//   node scripts/upload-guide-image.mjs docs/guide/_review/hr-doc-detail.png \
//     hr-documents/document-detail-01.png
//
// CHECK THE HOST BEFORE YOU SHOOT. Ruling 1 says screenshots come from
// PRODUCTION. Staging renders identically — same code, same layout, same
// chrome — and the only thing distinguishing them is a URL badge that is easy
// to miss, which is exactly what happened on 2026-09-04 when the first attempt
// at this capture began on staging.
//
// THE COST OF GETTING IT WRONG IS NOT COSMETIC, and that is why this warning is
// here rather than in a doc nobody opens. Staging is a Neon branch forked from
// production, so its rows are real-looking and may be stale production data. A
// staging capture therefore ships a screenshot that LOOKS right, teaches the
// wrong state of the product, and carries person data whose provenance nobody
// can reconstruct afterwards — a redaction pass cannot catch what it cannot
// tell apart. The URL is the only signal, so read it deliberately, before the
// shutter and not after.
//
// WHY A SCRIPT AND NOT AN UPLOAD UI. Guide images are authored, not
// user-submitted: they are captured from production by a human, redacted by a
// human, and reviewed by a human before they go anywhere. An upload route would
// be a write path into a private store that exists solely to be typed into once
// per screenshot, and every such route is a permission surface to get wrong.
//
// NOTHING HERE IS EVER A TRACKED FILE. docs/guide/_raw/ and docs/guide/_review/
// are gitignored, and docs/guide/ holds .md only (the generator warns when it
// stops being true). That is what makes a missed redaction a live-site bug you
// can fix rather than a permanent history entry you cannot — ruling 1's whole
// point.

import { readFileSync, statSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { head, issueSignedToken, presignUrl, put } from "@vercel/blob"

// LOAD .env OURSELVES rather than requiring `node --env-file=.env`.
//
// Recorded 2026-09-05 after the documented command failed as written: plain
// `node` and `npx tsx` do not read .env, so both this script and the verifier
// exited on "token is not set" while the token was sitting in .env the whole
// time. The error message was accurate and the instruction was wrong, which is
// the worst combination — it sends you to check the thing that is already fine.
//
// Fixing the SCRIPT rather than the INSTRUCTIONS is deliberate. A documented
// flag is a flag someone forgets, and the failure it produces is
// indistinguishable from a genuinely missing credential. Loading here means the
// script works the way a person expects it to, and CI still wins because a real
// environment variable takes precedence over the file.
try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"))
} catch {
  // No .env — fine. The variable may come from the real environment instead,
  // which is how this runs anywhere that is not a laptop.
}

// --force may appear anywhere; everything else is positional.
const argv = process.argv.slice(2)
const force = argv.includes("--force")
const [source, target] = argv.filter((a) => a !== "--force")

if (!source) {
  console.error(
    "usage: node scripts/upload-guide-image.mjs <file> [<target-pathname>] [--force]\n" +
      "  --force  replace an image that already exists at that pathname"
  )
  process.exit(1)
}

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }
const MAX_BYTES = 5 * 1024 * 1024

const token = process.env.GUIDE_BLOB_READ_WRITE_TOKEN
if (!token) {
  console.error(
    "GUIDE_BLOB_READ_WRITE_TOKEN is not set.\n" +
      "The private froot-guide store must exist and its token must be in your local .env.\n" +
      "It is a SEPARATE store from froot-hr by ruling (Gary, 2026-09-04): pattern shared, blast radius not."
  )
  process.exit(1)
}

// Lowercase the extension. macOS screenshot workflows produce .PNG, and the
// proxy matcher's extension list is CASE-SENSITIVE — /x.png is excluded from
// middleware while /x.PNG is not. That no longer changes the auth posture here,
// since nothing is in public/ any more, but two files differing only in case is
// a footgun regardless, and safeFileName() in hr-files.ts already lowercases.
const ext = extname(source).toLowerCase()
const contentType = TYPES[ext]
if (!contentType) {
  console.error(`Unsupported extension "${ext}" — allowed: ${Object.keys(TYPES).join(", ")}`)
  process.exit(1)
}

const bytes = readFileSync(source)
const size = statSync(source).size
if (size > MAX_BYTES) {
  console.error(`${source} is ${(size / 1024 / 1024).toFixed(1)} MB — the cap is 5 MB (screenshots, not handbooks)`)
  process.exit(1)
}

const pathname = target ?? basename(source, ext).toLowerCase() + ext

// ─── OVERWRITE IS EXPLICIT ───────────────────────────────────────────────────
//
// addRandomSuffix is DELIBERATELY OFF, unlike hr-files.ts. An HR document needs
// a unique key per upload because two people may upload files of the same name.
// A guide image's pathname is written into frontmatter by hand and must be
// predictable and re-uploadable in place — replacing a screenshot should not
// orphan the old one and require a frontmatter edit.
//
// BUT BARE OVERWRITING MUST FAIL, and that is what --force is for. The failure
// worth designing against is a WRONG capture silently replacing a GOOD one:
// nothing errors, the article keeps rendering, and the only signal is that the
// picture is now of the wrong screen. Re-uploading is a normal thing to want —
// a first capture is often the wrong screen — so the answer is to make
// replacement deliberate rather than to make it hard.
//
// We check with head() first rather than letting put() raise, so the message
// names what is about to be lost (size and upload date) instead of an SDK
// error string.
let existing = null
try {
  existing = await head(pathname, { token })
} catch {
  // Not there — a first upload. Nothing to protect.
}

if (existing && !force) {
  console.error(
    `${pathname} already exists — ${(existing.size / 1024).toFixed(0)} KB, uploaded ${existing.uploadedAt}.\n\n` +
      "Refusing to replace it silently. If this capture is meant to supersede that one, re-run with --force:\n" +
      `  node scripts/upload-guide-image.mjs ${source} ${pathname} --force`
  )
  process.exit(1)
}

if (existing) {
  console.log(
    `replacing  ${pathname}  (was ${(existing.size / 1024).toFixed(0)} KB from ${existing.uploadedAt})`
  )
}

const blob = await put(pathname, bytes, {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: force,
  contentType,
  token,
})

// READ IT BACK AND COMPARE. An upload that reported success and stored
// something else is the failure this catches — and on a replace it is the only
// way to know the new bytes landed rather than the old ones surviving.
const sentHash = createHash("sha256").update(bytes).digest("hex")
const delegation = await issueSignedToken({
  operations: ["get"],
  validUntil: Date.now() + 5 * 60 * 1000,
  token,
})
const { presignedUrl } = await presignUrl(delegation, {
  operation: "get",
  pathname: blob.pathname,
  access: "private",
  validUntil: Date.now() + 5 * 60 * 1000,
})
const readBack = Buffer.from(await (await fetch(presignedUrl)).arrayBuffer())
const backHash = createHash("sha256").update(readBack).digest("hex")
if (backHash !== sentHash) {
  console.error(
    `VERIFY FAILED — the stored bytes do not match the file on disk.\n  sent ${sentHash}\n  got  ${backHash}`
  )
  process.exit(1)
}

console.log(`uploaded  ${source}  ->  ${blob.pathname}  (${(size / 1024).toFixed(0)} KB, ${contentType})`)
console.log(`verified  read back byte-identical  sha256 ${backHash.slice(0, 16)}…`)
console.log("")
console.log("Reference it in the article's frontmatter as:")
console.log("")
console.log("images:")
console.log(`  - id: ${blob.pathname}`)
console.log("    alt: <what the screenshot shows>")
console.log("    section: <section id, if it belongs to a gated section>")
console.log("")
console.log("The `section` key is what puts the image behind the SECTION's capability")
console.log("rather than the article's (ruling 7 — narrowest enclosing scope).")
