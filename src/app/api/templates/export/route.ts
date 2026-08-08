import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../access"
import { NextResponse } from "next/server"

// ─── Templates Export ─────────────────────────────────────────────────────────
// GET /api/templates/export           → CSV download (one row per task)
// GET /api/templates/export?format=json → JSON (lossless, nested)
//
// This is the "pull from production" path. Sign into www.usefroot.com as an
// admin, hit this endpoint, and you get a portable file you can import into
// staging (or any environment) via /api/templates/import.
//
// NOTE: store assignments and per-task excludedStoreIds are intentionally
// OMITTED from the CSV. Store IDs (cuids) are environment-specific — a store
// row in production does not exist in staging — so carrying the IDs across
// would create dangling references. Imported templates default to appliesTo="all".
// Use format=json if you want the raw store-assignment data for reference.

const CSV_COLUMNS = [
  "template_name",
  "template_description",
  "template_type",
  "template_frequency",
  "template_availability_type",
  "template_operational_phase",
  "template_start_offset_hours",
  "template_end_offset_hours",
  "template_applies_to",
  "task_section",
  "task_description",
  "task_estimated_minutes",
  "task_requires_photo",
  "task_requires_temp",
  "task_is_critical",
  "task_order_index",
  "task_video_url",
] as const

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  // Quote if the cell contains a comma, quote, or newline; escape embedded quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const url = new URL(req.url)
  const format = url.searchParams.get("format")
  const includeArchived = url.searchParams.get("includeArchived") === "true"

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id, ...(includeArchived ? {} : { isArchived: false }) },
    include: {
      tasks: { orderBy: { orderIndex: "asc" } },
      // TPL-2 step (2). THIS JOIN IS NOT COSMETIC AND IT IS NOT OPTIONAL.
      // Step (1) stopped the rename cascade and the reassign write, so
      // Template.type is now a snapshot at insert — an export still emitting it
      // raw would put STALE TYPE NAMES in a file operators carry between
      // environments, which is the one place the divergence escapes the
      // application. Migrated in the same commit as the write paths for exactly
      // that reason (docs/prompts/TPL-2_PLAN.md §4).
      templateType: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const stamp = new Date().toISOString().slice(0, 10)

  if (format === "json") {
    return new NextResponse(JSON.stringify(templates, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="froot-templates-${stamp}.json"`,
      },
    })
  }

  // Build CSV: one row per task. Templates with zero tasks still emit one row
  // (with blank task columns) so they survive the round-trip.
  const lines: string[] = [CSV_COLUMNS.join(",")]

  for (const t of templates) {
    const templateCells = [
      t.name,
      t.description,
      // EXISTING EXPORTED FILES STAY IMPORT-VALID. /api/templates/import
      // resolves template_type BY NAME, case-insensitively, creating any type
      // the org lacks (TPL-1b's Q4 behaviour) — it never reads Template.type
      // from the database and never keys on an id. So a CSV exported before
      // this change imports exactly as it did; one exported after it carries
      // the live name, which matches even more reliably.
      t.templateType?.name ?? t.type,
      t.frequency,
      t.availabilityType,
      t.operationalPhase,
      t.startOffsetHours,
      t.endOffsetHours,
      t.appliesTo,
    ]

    if (t.tasks.length === 0) {
      lines.push([...templateCells, "", "", "", "", "", "", "", ""].map(csvCell).join(","))
      continue
    }

    for (const task of t.tasks) {
      lines.push(
        [
          ...templateCells,
          task.sectionName,
          task.description,
          task.estimatedTimeMinutes,
          task.requiresPhoto,
          task.requiresTemp,
          task.isCritical,
          task.orderIndex,
          task.videoUrl,
        ]
          .map(csvCell)
          .join(",")
      )
    }
  }

  // Prepend a UTF-8 BOM so Excel opens accented characters correctly.
  const csv = "﻿" + lines.join("\r\n")

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="froot-templates-${stamp}.csv"`,
    },
  })
}
