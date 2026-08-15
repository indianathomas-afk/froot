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
 *
 * HR-11d adds:
 *   - the 2d vocabulary (bare "Signature:", "Store Location:",
 *     "Acceptance (PRINT):", fill-gated "Employee:");
 *   - the "Manager Signature:" DISCARD — it claims its span so bare
 *     "Signature:" cannot stamp the employee on the manager's line, and then
 *     emits nothing at all;
 *   - the 2b signing guard (R3(i-a)): matched > 0 && confirmed == 0 refuses.
 *     The guard is a pure function of two counts, so it is asserted here
 *     rather than in a second, database-backed harness — see the ROADMAP row.
 *
 * Nothing is persisted.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib"
import {
  detectAnchors,
  assembleLines,
  matchLine,
  dedupeAnchors,
  isSigningBlocked,
  type AnchorCandidate,
} from "../src/lib/hr-anchors"
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

  // ── Item 3: within-pass dedup ────────────────────────────────────────────────
  console.log("\ndedup (Item 3, unit):")
  {
    const mk = (over: Partial<{ page: number; x: number; y: number; anchorText: string; markType: string }>) => ({
      page: 22, x: 72, y: 120, width: 100, pageRotation: 0, pageView: [0, 0, 612, 792] as [number, number, number, number],
      anchorText: "Employee's Signature", markType: "SignatureStamp", placement: "Right", ...over,
    }) as AnchorCandidate
    check("coincident duplicate (Δ<3) collapses to 1", dedupeAnchors([mk({}), mk({ x: 73, y: 121 })]).length === 1)
    check("same caption far apart in Y (Δ20) preserved", dedupeAnchors([mk({}), mk({ y: 140 })]).length === 2)
    check("same caption side-by-side in X (Δ30) preserved", dedupeAnchors([mk({}), mk({ x: 300 })]).length === 2)
    check("different markType not merged", dedupeAnchors([mk({}), mk({ markType: "Initial", anchorText: "Initial:" })]).length === 2)
    // deterministic survivor = smallest x (sorted-first)
    const survivor = dedupeAnchors([mk({ x: 74 }), mk({ x: 72 }), mk({ x: 73 })])
    check("deterministic survivor is smallest-x", survivor.length === 1 && survivor[0].x === 72)
    // curly vs straight apostrophe normalize to the same field → collapse
    check(
      "curly/straight apostrophe treated as same caption",
      dedupeAnchors([mk({ anchorText: "Employee's Signature" }), mk({ anchorText: "Employee’s Signature", x: 73 })]).length === 1
    )
  }

  console.log("\ndedup (Item 3, end-to-end — caption drawn twice):")
  {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    // faux-bold: the same caption drawn twice at ~same spot
    p.drawText("Employee Signature: _______", { x: 72, y: 120, size: 12, font })
    p.drawText("Employee Signature: _______", { x: 72.4, y: 120, size: 12, font })
    // a genuine SECOND signature line far below → must survive
    p.drawText("Employee Signature: _______", { x: 72, y: 60, size: 12, font })
    const res = await detectAnchors(await doc.save())
    const sigs = res.anchors.filter((a) => a.markType === "SignatureStamp")
    check("2 visual lines (one doubled) → 2 anchors, not 3", sigs.length === 2, `got ${sigs.length}`)
  }

  // ── Image-only fallback ──────────────────────────────────────────────────────
  console.log("\nimage-only PDF:")
  const none = await detectAnchors(await imageOnlyPdf())
  check("zero anchors → certificate-only fallback", none.anchors.length === 0, `got ${none.anchors.length}`)
  check("image-only: textItemCount == 0 (no text layer)", none.textItemCount === 0, `items=${none.textItemCount}`)

  // ── HR-11d 2d: the 2023 Keva handbook vocabulary ─────────────────────────────
  console.log("\nHR-11d 2d — new vocabulary tokens:")
  {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    p.drawText("Signature: ____________________", { x: 72, y: 700, size: 12, font }) // bare, pp. 9/19
    p.drawText("Store Location: _______________", { x: 72, y: 660, size: 12, font })
    p.drawText("Acceptance (PRINT): ___________", { x: 72, y: 620, size: 12, font })
    p.drawText("Employee: _____________________", { x: 72, y: 580, size: 12, font }) // p.13 signature line
    const res = await detectAnchors(await doc.save())
    const byText = (t: string) => res.anchors.find((a) => a.anchorText.toLowerCase().startsWith(t))

    check("bare 'Signature:' → SignatureStamp", byText("signature:")?.markType === "SignatureStamp", byText("signature:")?.markType)
    check("'Store Location:' → Store", byText("store location:")?.markType === "Store", byText("store location:")?.markType)
    check(
      "'Store Location:' is ONE anchor, not also a 'Store:' hit",
      res.anchors.filter((a) => a.markType === "Store").length === 1,
      `${res.anchors.filter((a) => a.markType === "Store").length}`
    )
    check("'Acceptance (PRINT):' → PrintedName", byText("acceptance (print):")?.markType === "PrintedName", byText("acceptance (print):")?.markType)
    check("'Employee:' → SignatureStamp (fill-gated, ruled default)", byText("employee:")?.markType === "SignatureStamp", byText("employee:")?.markType)
    check("four labels → four anchors, no strays", res.anchors.length === 4, `got ${res.anchors.length}: ${res.anchors.map((a) => a.anchorText).join(" | ")}`)
  }

  console.log("\nHR-11d 2d — 'Employee:' is fill-gated:")
  {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    // Prose, no fill line anywhere near it.
    p.drawText("The Employee: as used in this policy means any team member.", { x: 72, y: 400, size: 10, font })
    const res = await detectAnchors(await doc.save())
    check("prose 'Employee:' with no fill line is NOT matched", res.anchors.length === 0, `got ${res.anchors.map((a) => a.anchorText).join(" | ")}`)
  }

  // ── HR-11d 2d: the discard flag ──────────────────────────────────────────────
  // The whole point: "Manager Signature:" must CLAIM ITS SPAN so bare
  // "Signature:" cannot reach the substring and stamp the EMPLOYEE's signature
  // on the MANAGER's line — and must then produce nothing at all.
  console.log("\nHR-11d 2d — 'Manager Signature:' claims its span and emits nothing:")
  {
    const line = assembleLines([{ str: "Manager Signature: ____________", x: 72, y: 300, width: 220 }])[0]
    const m = matchLine(line)
    check("exactly one match on the manager line", m.length === 1, `got ${m.length}: ${m.map((x) => x.anchorText).join(" | ")}`)
    check("that match is the discard token", m[0]?.discard === true && m[0]?.anchorText.toLowerCase() === "manager signature:", m[0]?.anchorText)
    check(
      "bare 'Signature:' did NOT also match inside it",
      m.filter((x) => x.anchorText.toLowerCase() === "signature:").length === 0
    )

    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    p.drawText("Employee Signature: ___________", { x: 72, y: 200, size: 12, font })
    p.drawText("Manager Signature: ____________", { x: 72, y: 160, size: 12, font })
    const res = await detectAnchors(await doc.save())
    check("manager line writes NO candidate", res.anchors.length === 1, `got ${res.anchors.length}: ${res.anchors.map((a) => a.anchorText).join(" | ")}`)
    check("the surviving anchor is the EMPLOYEE signature", res.anchors[0]?.anchorText.toLowerCase().startsWith("employee signature:"), res.anchors[0]?.anchorText)
  }

  // A document whose ONLY signature line is the manager's: the discard means it
  // reports matched == 0, so the 2b guard needs no carve-out for it — it is
  // certificate-only by design and stays signable.
  console.log("\nHR-11d 2d — manager-only document reports matched == 0:")
  {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage([612, 792]).drawText("Manager Signature: ____________", { x: 72, y: 160, size: 12, font })
    const res = await detectAnchors(await doc.save())
    check("no anchors at all", res.anchors.length === 0, `got ${res.anchors.length}`)
    check("text layer WAS present (not confused with image-only)", res.textItemCount > 0)
  }

  // ── HR-11d 2b: THE REGRESSION ASSERTION ──────────────────────────────────────
  // "A version with matched-but-unconfirmed anchors must not mint a signed
  // record." The trip-wire is a pure function of two counts, so the assertion
  // lands in THIS harness against the synthetic PDFs already here — no second
  // harness, no real-PDF fixture. detectAnchors gives the real `matched` a fresh
  // upload produces; `confirmed` is 0 by construction, because
  // detectAndStoreVersionAnchors writes every proposal unconfirmed.
  console.log("\nHR-11d 2b — signing guard (R3(i-a)):")
  {
    const matched = detected.anchors.length
    check("the text PDF really does match fields", matched > 0, `matched=${matched}`)
    check(
      "freshly uploaded, nothing confirmed → BLOCKED (this is the defect)",
      isSigningBlocked(matched, 0) === true
    )
    check("one anchor confirmed → not blocked", isSigningBlocked(matched, 1) === false)
    check("all confirmed → not blocked", isSigningBlocked(matched, matched) === false)
    check(
      "image-only PDF (matched 0) stays signable, certificate-only",
      isSigningBlocked(none.anchors.length, 0) === false
    )
    check(
      "admin discarded every proposal (0 rows, 0 confirmed) stays signable",
      isSigningBlocked(0, 0) === false
    )
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
