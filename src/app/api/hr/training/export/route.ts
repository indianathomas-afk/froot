import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../access"
import { buildTrainingCsv } from "../csv"

// ─── Training Export ──────────────────────────────────────────────────────────
// GET /api/hr/training/export             → CSV download (row per lesson/question)
// GET /api/hr/training/export?format=json → JSON (lossless, nested)
//
// Mirrors /api/templates/export: sign in as an admin in one environment, pull
// the file, import it into another via /api/hr/training/import. Store
// assignments are omitted from the CSV (store cuids are env-specific) and
// RESOURCE FILES never travel — they live in the private Blob store; the JSON
// includes their metadata for reference only. Imported modules default to
// appliesTo="all" with no files attached.
export async function GET(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const url = new URL(req.url)
  const format = url.searchParams.get("format")
  const includeArchived = url.searchParams.get("includeArchived") === "true"

  const modules = await prisma.trainingModule.findMany({
    where: { organizationId: access.org.id, ...(includeArchived ? {} : { isArchived: false }) },
    include: {
      lessons: {
        orderBy: { orderIndex: "asc" },
        include: {
          resources: { orderBy: { orderIndex: "asc" } },
          // HR-32: the JOINED document, not the bare cuid. linkedHrDocumentId
          // rides along in the JSON for free the moment the column exists, and
          // alone it is exactly the value this route says never travels — see
          // the category note below: ids are branch-specific. A title and a URL
          // are what a human can resolve in the target environment, mirroring
          // the resources precedent in the header comment.
          //
          // THE ROUND TRIP STILL DROPS THE LINK, and that is not fixed here:
          // /api/hr/training/import reads the CSV shape only (csv.ts declares a
          // fixed four-field lesson), so a JSON export re-imported comes back
          // with no linked document. A fourth CSV row_type is its own decision.
          linkedHrDocument: { select: { title: true, externalUrl: true } },
          // HR-33: externalLinkUrl and externalLinkLabel need NO line here.
          // They are plain scalars on the lesson, so the JSON response —
          // JSON.stringify over these rows — already carries them. HR-32 needed
          // the join above only because a linked document is a RELATION and the
          // bare cuid is the one value this route says never travels.
          //
          // THE CSV ROUND TRIP DROPS THEM, same as HR-32's field:
          // /api/hr/training/import reads the CSV shape only, and csv.ts
          // declares a fixed four-field lesson (title, info, videoUrl,
          // orderIndex), so a JSON export re-imported comes back with no
          // external link. Carrying them would take new CSV columns, which is
          // its own decision and was excluded from this row.
        },
      },
      quizzes: true,
      storeAssignments: true,
      // HR-20: the CSV carries the category NAME (ids are branch-specific and
      // never travel — the import resolves by name within the target org).
      category: { select: { name: true } },
    },
    // HR-29: authored order. includeArchived=true interleaves archived
    // rows on their stale index; the tie-break keeps that deterministic.
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  })

  const stamp = new Date().toISOString().slice(0, 10)

  if (format === "json") {
    return new NextResponse(JSON.stringify(modules, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="froot-training-${stamp}.json"`,
      },
    })
  }

  return new NextResponse(buildTrainingCsv(modules), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="froot-training-${stamp}.csv"`,
    },
  })
}
