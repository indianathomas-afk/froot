/**
 * CHK-20 — only real web links can be saved or shown as a task's training
 * video.
 *
 *   npx tsx scripts/verify-chk20-video-links.ts
 *
 * PURE, in the verify-tab9-cards.ts style: no database, no browser. It drives
 * src/lib/task-video-url.ts, the one rule every writer (template create/edit,
 * template import, Duplicate) and every reader (desktop checklist, template
 * editor, print views, tablet, help-request training list) now calls.
 *
 * WHAT THIS CAN DETECT:
 *   - AN http(s) LINK CHANGED IN TRANSIT: https and http pass back exactly as
 *     typed (trimmed), with no trailing slash or re-encoding added. Cases 1.
 *   - A BARE WEB ADDRESS NOT REPAIRED: www.… and youtu.be/… gain https://.
 *     Cases 2.
 *   - ANY OTHER SCHEME GETTING THROUGH: javascript: in any case, with leading
 *     whitespace, or with a tab hidden inside it; data:, file:, mailto:,
 *     vbscript:, a protocol-relative //host. Cases 3.
 *   - BLANK HANDLED WRONG: "" and whitespace are null to a reader, and "no
 *     link" (stored NULL, not a refusal) to a writer. Cases 4.
 *
 * WHAT IT CANNOT DETECT: that each call site actually calls the helper (the
 * report enumerates them; the build typechecks them), the editor's inline
 * message, or the import dialog's dropped-links list — Gary's staging list.
 */
import { TASK_VIDEO_URL_ERROR, normalizeTaskVideoUrl, safeVideoUrl } from "../src/lib/task-video-url"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

console.log("\n1 · https and http pass unchanged")
check("https YouTube watch link", safeVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
check("http link", safeVideoUrl("http://example.com/training.mp4"), "http://example.com/training.mp4")
check("no trailing slash added", safeVideoUrl("https://example.com"), "https://example.com")
check("surrounding whitespace trimmed", safeVideoUrl("  https://youtu.be/dQw4w9WgXcQ \n"), "https://youtu.be/dQw4w9WgXcQ")
check("upper-case scheme kept as typed", safeVideoUrl("HTTPS://Example.com/Video"), "HTTPS://Example.com/Video")

console.log("\n2 · A bare web address gets https://")
check("www.youtube.com/watch?v=…", safeVideoUrl("www.youtube.com/watch?v=dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
check("youtu.be/…", safeVideoUrl("youtu.be/dQw4w9WgXcQ"), "https://youtu.be/dQw4w9WgXcQ")
check("bare host with a port", safeVideoUrl("videos.example.com:8443/a"), "https://videos.example.com:8443/a")
check("bare word is not a web address", safeVideoUrl("training"), null)

console.log("\n3 · Any other scheme returns null")
check("javascript:", safeVideoUrl("javascript:alert(1)"), null)
check("JAVASCRIPT:", safeVideoUrl("JAVASCRIPT:alert(1)"), null)
check('" javascript:"', safeVideoUrl(" javascript:alert(1)"), null)
check("java<TAB>script:", safeVideoUrl("java\tscript:alert(1)"), null)
check("data:", safeVideoUrl("data:text/html,<script>alert(1)</script>"), null)
check("file:", safeVideoUrl("file:///etc/passwd"), null)
check("mailto:", safeVideoUrl("mailto:someone@example.com"), null)
check("vbscript:", safeVideoUrl("vbscript:msgbox(1)"), null)
check("protocol-relative //host", safeVideoUrl("//evil.example.com/x"), null)
check("host-looking scheme with no port", safeVideoUrl("evil.com:alert(1)"), null)
check("space inside", safeVideoUrl("https://example.com/a b"), null)

console.log("\n4 · Empty and whitespace")
check("empty string → null", safeVideoUrl(""), null)
check("whitespace → null", safeVideoUrl("   \t "), null)
check("null → null", safeVideoUrl(null), null)
check("writer: empty is no link, stored NULL", normalizeTaskVideoUrl(""), { ok: true, value: null })
check("writer: whitespace is no link, stored NULL", normalizeTaskVideoUrl("  "), { ok: true, value: null })
check("writer: null is no link", normalizeTaskVideoUrl(null), { ok: true, value: null })
check("writer: bare www stored with https://", normalizeTaskVideoUrl("www.youtube.com/watch?v=x"), { ok: true, value: "https://www.youtube.com/watch?v=x" })
check("writer: javascript: refused", normalizeTaskVideoUrl("javascript:alert(1)"), { ok: false })
check("the message, word for word", TASK_VIDEO_URL_ERROR, "Use a web link that starts with https://")

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
