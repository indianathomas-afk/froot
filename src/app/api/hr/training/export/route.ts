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
        include: { resources: { orderBy: { orderIndex: "asc" } } },
      },
      quizzes: true,
      storeAssignments: true,
    },
    orderBy: { createdAt: "asc" },
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
