import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../access"
import { NextResponse } from "next/server"
import { z } from "zod"
import { OPERATIONAL_PHASES, isOperationalPhase, normalizePhase } from "@/lib/phases"

// ─── Templates Import ─────────────────────────────────────────────────────────
// POST /api/templates/import
// Body: a flat array of task rows (the CSV parsed to objects). Rows are grouped
// by template_name; each group becomes one Template with its Tasks.
//
// Mirrors the shape produced by /api/templates/export (CSV). Store assignments
// are NOT imported by ID (env-specific); every imported template is created
// org-wide (appliesTo = "all", isActive = false so nothing goes live until you
// review it). Re-importing the same file creates duplicates unless you pass
// { mode: "replace" } to first archive same-named templates — see below.

// Accept booleans as real booleans OR the strings CSV produces ("true"/"1"/"yes").
const boolish = z.preprocess((v) => {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    const s = v.trim().toLowerCase()
    if (["true", "1", "yes", "y"].includes(s)) return true
    if (["false", "0", "no", "n", ""].includes(s)) return false
  }
  return v
}, z.boolean())

// Accept numbers as numbers OR numeric strings; empty → undefined.
const numish = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  return v
}, z.number().optional())

const RowSchema = z.object({
  template_name: z.string().min(1, "template_name is required"),
  template_description: z.string().optional().nullable(),
  template_type: z.string().optional().nullable(),
  template_frequency: z.string().optional().nullable(),
  template_availability_type: z.string().optional().nullable(),
  // DEBT-1b: validated here so a bad cell reports through the per-row errors
  // channel with its row number, rather than importing an unknown variant.
  // The one known legacy value ("During Hours") is corrected on the way in —
  // CSVs exported before the backfill still import.
  template_operational_phase: z
    .string()
    .optional()
    .nullable()
    .refine((v) => isOperationalPhase(normalizePhase(v)), {
      message: `template_operational_phase must be one of: ${OPERATIONAL_PHASES.join(", ")}`,
    }),
  template_start_offset_hours: numish,
  template_end_offset_hours: numish,
  template_applies_to: z.string().optional().nullable(),
  task_section: z.string().optional().nullable(),
  task_description: z.string().optional().nullable(),
  task_estimated_minutes: numish,
  task_requires_photo: boolish.optional().default(false),
  task_requires_temp: boolish.optional().default(false),
  task_is_critical: boolish.optional().default(false),
  task_order_index: numish,
  task_video_url: z.string().optional().nullable(),
})

type Row = z.infer<typeof RowSchema>

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const body = await req.json()
  const rows: unknown[] = Array.isArray(body) ? body : body?.rows
  const mode: "append" | "replace" = body?.mode === "replace" ? "replace" : "append"
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Expected an array of rows (or { rows: [...] })" }, { status: 400 })
  }

  // Validate every row up front. Row numbers are 1-based over the data rows.
  const validRows: Row[] = []
  const errors: { row: number; error: string }[] = []
  rows.forEach((raw, i) => {
    const parsed = RowSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push({ row: i + 1, error: parsed.error.issues.map((e) => e.message).join(", ") })
    } else {
      validRows.push(parsed.data)
    }
  })

  // Group rows into templates by template_name, preserving first-seen order.
  const groups = new Map<string, Row[]>()
  for (const r of validRows) {
    const key = r.template_name
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  // TPL-1b (Gary, Q4, 2026-08-08): resolve every type name the file mentions
  // BEFORE the per-template loop, creating the ones this org does not have.
  //
  // UP FRONT, NOT INSIDE THE TRANSACTIONS, and that ordering is the point: each
  // template is created in its own transaction, so a type created inside one
  // would be rolled back by an unrelated failure in that template — taking it
  // away from every later template that also needed it.
  //
  // Matching is case-insensitive against the org's existing types, so a file
  // saying "opener" links to "Opener" instead of creating a near-duplicate.
  // A blank cell resolves under the name "Mid-Shift", which is the behaviour
  // this route has always had, now expressed as a real row.
  const existingTypes = await prisma.templateType.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true },
  })
  const typesByLower = new Map(existingTypes.map((t) => [t.name.toLowerCase(), t]))
  const typesCreated: string[] = []

  const wantedNames = new Set<string>()
  for (const r of validRows) {
    wantedNames.add(r.template_type?.trim() || "Mid-Shift")
  }
  for (const wanted of wantedNames) {
    if (typesByLower.has(wanted.toLowerCase())) continue
    // Neutral grey: the file said what the type is CALLED, not what colour it
    // should be, and inventing one would be a decision nobody made. The
    // operator recolours it in Manage Types.
    const row = await prisma.templateType.create({
      data: { organizationId: org.id, name: wanted, colorKey: "gray", sortOrder: existingTypes.length + typesCreated.length },
      select: { id: true, name: true },
    })
    typesByLower.set(row.name.toLowerCase(), row)
    typesCreated.push(row.name)
  }

  let templatesCreated = 0
  let tasksCreated = 0
  const created: { name: string; tasks: number }[] = []

  for (const [name, groupRows] of groups) {
    // Template-level fields come from the first row of the group.
    const head = groupRows[0]

    // A row counts as a real task only if it has a description.
    const taskRows = groupRows.filter((r) => (r.task_description ?? "").trim().length > 0)

    // Resolved in the pre-pass above, so this is a map lookup and cannot fail.
    const resolvedType = typesByLower.get((head.template_type?.trim() || "Mid-Shift").toLowerCase())!

    try {
      await prisma.$transaction(async (tx) => {
        if (mode === "replace") {
          // Archive any existing same-named templates so the new one is the source of truth.
          await tx.template.updateMany({
            where: { organizationId: org.id, name, isArchived: false },
            data: { isArchived: true, isActive: false },
          })
        }

        const template = await tx.template.create({
          data: {
            organizationId: org.id,
            name,
            description: head.template_description?.trim() || null,
            // TPL-1b closed the TPL-1a window: imports now carry a real typeId
            // and are duplicable like any other template. Both columns are
            // written from the SAME resolved row, so the legacy string and the
            // FK cannot disagree — the rule every other write path follows.
            typeId: resolvedType.id,
            type: resolvedType.name,
            frequency: head.template_frequency?.trim() || "Daily",
            availabilityType: head.template_availability_type?.trim() || "StoreHours",
            operationalPhase: normalizePhase(head.template_operational_phase),
            startOffsetHours: head.template_start_offset_hours ?? null,
            endOffsetHours: head.template_end_offset_hours ?? null,
            appliesTo: "all",
            isActive: false, // imported templates arrive inactive; review before going live
            tasks: {
              create: taskRows.map((t, idx) => ({
                sectionName: t.task_section?.trim() || "General",
                description: t.task_description!.trim(),
                estimatedTimeMinutes: t.task_estimated_minutes ?? null,
                requiresPhoto: t.task_requires_photo ?? false,
                requiresTemp: t.task_requires_temp ?? false,
                isCritical: t.task_is_critical ?? false,
                orderIndex: t.task_order_index ?? idx,
                excludedStoreIds: [],
                videoUrl: t.task_video_url?.trim() || null,
              })),
            },
          },
          include: { tasks: true },
        })

        templatesCreated++
        tasksCreated += template.tasks.length
        created.push({ name: template.name, tasks: template.tasks.length })
      })
    } catch (err) {
      console.error("Failed to import template", name, err)
      errors.push({ row: 0, error: `Failed to create template "${name}"` })
    }
  }

  return NextResponse.json({ templatesCreated, tasksCreated, created, typesCreated, errors })
}
