/**
 * HR-11b acceptance fixture — field-anchor detection (hr-anchors.ts).
 *
 *   npx tsx scripts/verify-hr-anchors.ts
 *
 * Pure PDF-in / candidates-out — no database. Builds PDFs with pdf-lib and
 * asserts the server-side detector:
 *   - finds each vocabulary token on the right page with a sane (x, y);
 *   - honours longest-match-wins ("Employee Name (Print):" is ONE PrintedName
 *     anchor, never also "Name:" / "Employee Name");
 *   - reassembles a label split across text runs ("Employee" + "Name");
 *   - carries page /Rotate and non-zero MediaBox origin through (D2);
 *   - returns [] for an image-only PDF (no text layer) → certificate-only.
 * Nothing is persisted.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib"
import { detectAnchors, assembleLines, matchLine } from "../src/lib/hr-anchors"
import { computeStampPlacement } from "../src/lib/hr-signed-pdf"

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  const p1 = doc.addPage([612, 792])
  p1.drawText("Employee Name (Print): ______________", { x: 72, y: 700, size: 12, font })
  p1.drawText("Date: __________", { x: 400, y: 700, size: 12, font })
  p1.drawText("Store: __________", { x: 72, y: 660, size: 12, font })
  p1.drawText("Employee Signature: ________________", { x: 72, y: 120, size: 12, font })
  p1.drawText("Initial: ____", { x: 72, y: 40, size: 10, font, color: rgb(0, 0, 0) })

  // Page 2: rotated + shifted MediaBox (D2), label split across two runs.
  const p2 = doc.addPage([612, 792])
  p2.setRotation(degrees(90))
  p2.setMediaBox(-40, -25, 612, 792)
  // Two separate drawText calls → two text runs pdfjs must rejoin into a line.
  p2.drawText("Employee", { x: 100, y: 400, size: 12, font })
  p2.drawText("Name", { x: 165, y: 400, size: 12, font })
  p2.drawText("Initial:", { x: 100, y: 60, size: 10, font })

  return doc.save()
}

// A PDF with no text layer: a single page carrying only a filled rectangle.
async function imageOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  page.drawRectangle({ x: 50, y: 50, width: 500, height: 680, color: rgb(0.9, 0.9, 0.9) })
  return doc.save()
}

async function main() {
  console.log("HR-11b field-anchor detection\n")

  // ── Pure unit: longest-match on a reassembled line ──────────────────────────
  console.log("longest-match-wins (unit):")
  {
    const lines = assembleLines([
      { str: "Employee Name (Print): _____", x: 72, y: 700, width: 200 },
    ])
    const m = matchLine(lines[0])
    check("one match on 'Employee Name (Print): ...'", m.length === 1, `got ${m.length}`)
    check("mark = PrintedName", m[0]?.markType === "PrintedName", m[0]?.markType)
    check("anchorText is the full label", m[0]?.anchorText.startsWith("Employee Name (Print):"))
  }

  // ── Full detect: text PDF ────────────────────────────────────────────────────
  console.log("\ntext PDF detection:")
  const detected = await detectAnchors(await textPdf())
  check("diagnostics: text layer detected", detected.textItemCount > 0, `items=${detected.textItemCount}`)
  check("diagnostics: pagesScanned == 2", detected.pagesScanned === 2, `${detected.pagesScanned}`)
  const anchors = detected.anchors
  const p1 = anchors.filter((a) => a.page === 1)
  const p2 = anchors.filter((a) => a.page === 2)

  const kinds = (arr: typeof anchors) => arr.map((a) => `${a.markType}@${Math.round(a.x)},${Math.round(a.y)}`).sort()
  console.log("  page1:", kinds(p1).join("  "))
  console.log("  page2:", kinds(p2).join("  "))

  check("page 1 has an Initial anchor", p1.some((a) => a.markType === "Initial"))
  check("page 1 has a Store anchor", p1.some((a) => a.markType === "Store"))
  check("page 1 has a DateStamp anchor", p1.some((a) => a.markType === "DateStamp"))
  check("page 1 has a SignatureStamp anchor", p1.some((a) => a.markType === "SignatureStamp"))
  check(
    "page 1 'Employee Name (Print):' → exactly one PrintedName",
    p1.filter((a) => a.markType === "PrintedName").length === 1,
    `got ${p1.filter((a) => a.markType === "PrintedName").length}`
  )
  check(
    "page 1 has NO stray 'Name:'/'Employee Name' extra anchors",
    p1.filter((a) => a.markType === "PrintedName").length === 1
  )
  check(
    "Initial anchor x/y are sane (bottom of page)",
    p1.some((a) => a.markType === "Initial" && a.x > 60 && a.x < 120 && a.y < 60)
  )

  check("page 2 rejoined 'Employee' + 'Name' → PrintedName", p2.some((a) => a.markType === "PrintedName"))
  check("page 2 rotation carried (90)", p2.every((a) => a.pageRotation === 90), `rot ${p2[0]?.pageRotation}`)
  check(
    "page 2 MediaBox origin carried (non-zero)",
    p2.length > 0 && p2[0].pageView[0] === -40 && p2[0].pageView[1] === -25,
    `view ${p2[0]?.pageView}`
  )

  // ── D2: stamp placement geometry (pure) ─────────────────────────────────────
  console.log("\nstamp placement (D2, unit):")
  {
    const anc = { x: 100, y: 400, width: 30, pageRotation: 0 }
    const right = computeStampPlacement(anc, "Right", { pad: 4 })
    check("rot0 Right → x past label, same y", right.x === 134 && right.y === 400 && right.rotateDeg === 0)
    const above = computeStampPlacement(anc, "Above", { lineHeight: 11 })
    check("rot0 Above → same x, y up", above.x === 100 && above.y === 411)
    const below = computeStampPlacement(anc, "Below", { lineHeight: 11 })
    check("rot0 Below → same x, y down", below.x === 100 && below.y === 389)

    // rot90: reader-right maps to content +y; glyphs counter-rotate to 90.
    const r90 = computeStampPlacement({ ...anc, pageRotation: 90 }, "Right", { pad: 4 })
    check("rot90 Right → moves in +y, glyph rotate 90", r90.x === 100 && r90.y === 434 && r90.rotateDeg === 90)
    const r180 = computeStampPlacement({ ...anc, pageRotation: 180 }, "Right", { pad: 4 })
    check("rot180 Right → moves in -x, glyph rotate 180", r180.x === 66 && r180.y === 400 && r180.rotateDeg === 180)
    const r270 = computeStampPlacement({ ...anc, pageRotation: 270 }, "Right", { pad: 4 })
    check("rot270 Right → moves in -y, glyph rotate 270", r270.x === 100 && r270.y === 366 && r270.rotateDeg === 270)
  }

  // ── Vocabulary + placement fixes (curly apostrophe, bare Date, under-line) ───
  console.log("\nvocabulary + placement (signature block):")
  {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    // Signature block: an underscore rule, with bare captions BELOW it.
    p.drawText("____________________________     ____________", { x: 72, y: 420, size: 12, font })
    p.drawText("Employee Name", { x: 72, y: 405, size: 9, font })
    p.drawText("Date", { x: 320, y: 405, size: 9, font })
    // "Employee's Signature" with a TYPOGRAPHIC apostrophe (U+2019).
    p.drawText("Employee’s Signature: ______", { x: 72, y: 300, size: 12, font })
    // A bare "Date" inside prose — must NOT match (no fill line near it).
    p.drawText("Please review the effective Date of this policy carefully.", { x: 72, y: 200, size: 10, font })
    const res = await detectAnchors(await doc.save())
    const a = res.anchors

    check(
      "curly-apostrophe ’ Employee's Signature matches",
      a.some((x) => x.markType === "SignatureStamp"),
      a.map((x) => x.anchorText).join(" | ")
    )
    const dates = a.filter((x) => x.markType === "DateStamp")
    check("bare 'Date' under the rule is detected (1)", dates.length === 1, `got ${dates.length}`)
    check("prose 'Date' is NOT matched", dates.length === 1)
    check(
      "under-line captions get Above placement",
      a.filter((x) => x.markType === "PrintedName" || x.markType === "DateStamp").every((x) => x.placement === "Above"),
      a.map((x) => `${x.markType}:${x.placement}`).join(" ")
    )
    check(
      "fill-to-right label ('Employee's Signature:') gets Right",
      a.find((x) => x.markType === "SignatureStamp")?.placement === "Right"
    )
  }

  // ── Image-only fallback ──────────────────────────────────────────────────────
  console.log("\nimage-only PDF:")
  const none = await detectAnchors(await imageOnlyPdf())
  check("zero anchors → certificate-only fallback", none.anchors.length === 0, `got ${none.anchors.length}`)
  check("image-only: textItemCount == 0 (no text layer)", none.textItemCount === 0, `items=${none.textItemCount}`)

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
