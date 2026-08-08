import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// TPL-1a. The one place a client-supplied typeId is turned into a TemplateType.
//
// TWO JOBS, AND THE SECOND ONE IS A TENANT BOUNDARY.
//
// (1) Reject the missing/unknown case with a 400 that names the field, in the
//     same shape as the operationalPhase rejection this route already carries.
//     NO SILENT DEFAULT. The `type: templateData.type || "Mid-Shift"` this
//     replaces is precisely what stamped "Mid-Shift" on every template made
//     through the Create form — docs/prompts/TYPE-1_AUDIT.md §2.1, §6.
//
// (2) Scope the lookup to organizationId. PATCH /api/templates/[id] spreads its
//     body wholesale into template.update (§2.2 of the audit), so an unresolved
//     typeId would reach the DB unchecked and a hand-crafted body could point
//     one org's template at another org's type. THIS RESOLVE MUST RUN BEFORE
//     THE SPREAD, and the caller must write the resolved id rather than the
//     one it was handed.
//
// Returns the row on success so callers can write "type" (the legacy string
// column) from its name. Both columns are written together, always: the six
// read sites and the CSV export still read the string, and TPL-2 does not
// retire it until this backfill is proven on all three branches.
export async function resolveTemplateType(
  organizationId: string,
  typeId: unknown
): Promise<{ ok: true; type: { id: string; name: string } } | { ok: false; response: NextResponse }> {
  if (typeof typeId !== "string" || !typeId.trim()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "typeId is required — choose a template type" }, { status: 400 }),
    }
  }

  const type = await prisma.templateType.findFirst({
    where: { id: typeId, organizationId },
    select: { id: true, name: true },
  })

  // A type belonging to another org is reported as unknown, not as forbidden —
  // the caller learns nothing about whether the id exists elsewhere.
  if (!type) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unknown template type" }, { status: 400 }),
    }
  }

  return { ok: true, type }
}
