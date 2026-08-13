import { createHash } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// HR-5 fillable-form definition service. A FillableForm HrDocument is rendered
// natively (body text + FormField inputs) — no uploaded file. Its
// HrDocumentVersion snapshots the DEFINITION instead: definitionSnapshot holds
// the canonical { bodyText, fields } JSON and fileHash holds that JSON's
// sha256, so submissions pin to a definition hash exactly the way HR-4
// acknowledgments pin to file bytes. The file columns carry the sentinels
// below (they are NOT NULL for real uploads and HR-4 must keep its types).

export const FORM_DEFINITION_CONTENT_TYPE = "application/x-froot-form-definition"
export const FORM_DEFINITION_FILE_NAME = "form-definition"

export interface FormFieldDef {
  label: string
  fieldType: string
  required: boolean
  orderIndex: number
  options: string[] | null
}

export interface FormDefinition {
  bodyText: string
  fields: FormFieldDef[]
}

export interface FormFieldInput {
  label: string
  fieldType: string
  required: boolean
  options?: string[] | null
}

// Shape of the FormSubmission.values rows: self-describing (label + type +
// value, in field order) so signed PDFs and readers never depend on live
// FormField rows.
export interface SubmittedFormValue {
  label: string
  fieldType: string
  value: string
}

// Canonical form: keys in fixed literal order, fields re-indexed by array
// position, options normalized to null when absent — the same definition
// always serializes to the same bytes, so the hash is a stable pin.
export function buildFormDefinition(
  bodyText: string,
  fields: FormFieldInput[]
): { snapshot: FormDefinition; json: string; hash: string } {
  const snapshot: FormDefinition = {
    bodyText,
    fields: fields.map((f, i) => ({
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      orderIndex: i,
      options: f.fieldType === "Select" && f.options?.length ? f.options : null,
    })),
  }
  const json = JSON.stringify(snapshot)
  const hash = createHash("sha256").update(json, "utf8").digest("hex")
  return { snapshot, json, hash }
}

// The version-row column values a definition occupies (see sentinel note above).
function definitionVersionColumns(json: string, hash: string, snapshot: FormDefinition) {
  return {
    fileUrl: "",
    fileName: FORM_DEFINITION_FILE_NAME,
    contentType: FORM_DEFINITION_CONTENT_TYPE,
    sizeBytes: Buffer.byteLength(json, "utf8"),
    fileHash: hash,
    definitionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
  }
}

// Create a kind:"FillableForm" document with its v1 definition version.
export async function createFillableForm({
  organizationId,
  createdByUserId,
  title,
  category,
  bodyText,
  fields,
}: {
  organizationId: string
  createdByUserId: string
  title: string
  category: string
  bodyText: string
  fields: FormFieldInput[]
}) {
  const { snapshot, json, hash } = buildFormDefinition(bodyText, fields)
  return prisma.hrDocument.create({
    data: {
      organizationId,
      kind: "FillableForm",
      title,
      category,
      bodyText,
      requiresAcknowledgment: false,
      isActive: true,
      // DOC-1 B FIX NOW (Gary, 2026-08-12) — REPAIRING A PHASE A REGRESSION,
      // NOT ADOPTING FORMS INTO THE AUDIENCE MECHANISM.
      //
      // Phase A flipped HrDocument.appliesTo's DEFAULT from "all" to "selected"
      // and left this create call setting it explicitly nowhere, so every form
      // built after 2026-08-12 was born with an empty audience. /hr/forms never
      // noticed — canReadHrDocument's FillableForm branch does not consult the
      // audience at all — but /staff/[id]'s Agreements tab filters through
      // staffAudienceWhere (ruled IN by Phase A so both tabs of one page share
      // one rule), and NOTHING IN THE APPLICATION CAN GRANT A FORM AN AUDIENCE:
      // the assign dialog is scoped to the document library, which excludes
      // FillableForm by construction. New forms were therefore invisible on
      // every staff member's Agreements tab, permanently and unfixably.
      //
      // "all" restores the pre-DOC-1 behaviour exactly — every form that
      // predates the migration carries it, and the clause that tab used before
      // Phase A was the appliesTo "all" disjunct. Forms stay OUT of the grant
      // mechanism, which is the point: this is the value that makes the
      // audience layer a no-op for them, not a foothold for it.
      appliesTo: "all",
      formFields: {
        create: snapshot.fields.map((f) => ({
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          orderIndex: f.orderIndex,
          options: f.options === null ? Prisma.JsonNull : (f.options as unknown as Prisma.InputJsonValue),
        })),
      },
      versions: {
        create: {
          versionNumber: 1,
          isCurrent: true,
          uploadedByUserId: createdByUserId,
          ...definitionVersionColumns(json, hash, snapshot),
        },
      },
    },
    include: { versions: true, formFields: { orderBy: { orderIndex: "asc" } } },
  })
}

// Save an edited definition, HR-4 re-upload semantics without draft noise:
// while the current version has ZERO submissions it is updated in place; the
// first edit after any submission exists demotes it and mints the next
// version, leaving every prior submission pinned to the definition it signed.
// Returns the (possibly new) current version and whether one was minted.
export async function saveFormDefinition({
  documentId,
  savedByUserId,
  bodyText,
  fields,
}: {
  documentId: string
  savedByUserId: string
  bodyText: string
  fields: FormFieldInput[]
}): Promise<{ versionId: string; versionNumber: number; hash: string; minted: boolean }> {
  const current = await prisma.hrDocumentVersion.findFirst({
    where: { hrDocumentId: documentId, isCurrent: true },
    orderBy: { versionNumber: "desc" },
  })
  if (!current) throw new Error("FillableForm document has no current version")

  const { snapshot, json, hash } = buildFormDefinition(bodyText, fields)

  // Unchanged definition — nothing to version, nothing to rewrite.
  if (hash === current.fileHash) {
    return {
      versionId: current.id,
      versionNumber: current.versionNumber,
      hash,
      minted: false,
    }
  }

  const submissionCount = await prisma.formSubmission.count({
    where: { hrDocumentVersionId: current.id },
  })

  return prisma.$transaction(async (tx) => {
    await tx.formField.deleteMany({ where: { hrDocumentId: documentId } })
    await tx.formField.createMany({
      data: snapshot.fields.map((f) => ({
        hrDocumentId: documentId,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        orderIndex: f.orderIndex,
        options: f.options === null ? Prisma.JsonNull : (f.options as unknown as Prisma.InputJsonValue),
      })),
    })
    await tx.hrDocument.update({ where: { id: documentId }, data: { bodyText } })

    if (submissionCount === 0) {
      await tx.hrDocumentVersion.update({
        where: { id: current.id },
        data: definitionVersionColumns(json, hash, snapshot),
      })
      return { versionId: current.id, versionNumber: current.versionNumber, hash, minted: false }
    }

    await tx.hrDocumentVersion.updateMany({
      where: { hrDocumentId: documentId, isCurrent: true },
      data: { isCurrent: false },
    })
    const minted = await tx.hrDocumentVersion.create({
      data: {
        hrDocumentId: documentId,
        versionNumber: current.versionNumber + 1,
        isCurrent: true,
        uploadedByUserId: savedByUserId,
        ...definitionVersionColumns(json, hash, snapshot),
      },
    })
    return { versionId: minted.id, versionNumber: minted.versionNumber, hash, minted: true }
  })
}
