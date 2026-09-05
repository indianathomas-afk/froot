// Upload a redacted guide screenshot to the private froot-guide Blob store.
//
// Step 5 of the capture workflow (audit §J): capture into docs/guide/_raw/,
// redact by hand into docs/guide/_review/, then upload from there with this.
// The frontmatter references the pathname this prints — never a local path, and
// never the stored blob URL.
//
//   node scripts/upload-guide-image.mjs docs/guide/_review/deleted-01.png \
//     inv-ingredients/deleted-01.png
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
import { basename, extname } from "node:path"
import { put } from "@vercel/blob"

const [, , source, target] = process.argv

if (!source) {
  console.error("usage: node scripts/upload-guide-image.mjs <file> [<target-pathname>]")
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

// addRandomSuffix is DELIBERATELY OFF, unlike hr-files.ts. An HR document needs
// a unique key per upload because two people may upload files of the same name.
// A guide image's pathname is written into frontmatter by hand and must be
// predictable and re-uploadable in place — replacing a screenshot should not
// orphan the old one and require a frontmatter edit.
const blob = await put(pathname, bytes, {
  access: "private",
  addRandomSuffix: false,
  contentType,
  token,
})

console.log(`uploaded  ${source}  ->  ${blob.pathname}  (${(size / 1024).toFixed(0)} KB, ${contentType})`)
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
