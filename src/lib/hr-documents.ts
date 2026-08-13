// HR document-library domain constants. Client-safe (no node imports) so both
// the API routes and the /hr/documents UI share one source of truth.

export const HR_DOCUMENT_CATEGORIES = [
  "Handbook",
  "PayAgreement",
  "Policy",
  "HRManagement",
  "Other",
] as const
export type HrDocumentCategory = (typeof HR_DOCUMENT_CATEGORIES)[number]

export const HR_CATEGORY_LABELS: Record<HrDocumentCategory, string> = {
  Handbook: "Handbook",
  PayAgreement: "Pay Agreement",
  Policy: "Policy",
  HRManagement: "HR Management",
  Other: "Other",
}

// Chip styles — same shape as the /users ROLE_STYLES map.
export const HR_CATEGORY_STYLES: Record<HrDocumentCategory, string> = {
  Handbook: "bg-orange-100 text-orange-700 border border-orange-200",
  PayAgreement: "bg-green-100 text-green-700 border border-green-200",
  Policy: "bg-blue-100 text-blue-700 border border-blue-200",
  HRManagement: "bg-purple-100 text-purple-700 border border-purple-200",
  Other: "bg-gray-100 text-gray-600 border border-gray-200",
}

// Kinds creatable through the library upload dialog. FillableForm (HR-5) is
// deliberately NOT here — forms are built at /hr/forms, never uploaded, and
// never appear in the all-user library.
export const HR_DOCUMENT_KINDS = ["Reference", "Acknowledgment"] as const
export type HrDocumentKind = (typeof HR_DOCUMENT_KINDS)[number]

export const HR_KIND_LABELS: Record<HrDocumentKind, string> = {
  Reference: "Reference",
  Acknowledgment: "Requires signature",
}

// ── DOC-1 B: the audience chip ──────────────────────────────────────────────
// A row's reach at a glance. Before this, an admin could not tell a locked
// document from a company-wide one by looking — the library rendered both
// identically while the policy treated them as opposites.
//
// IT COUNTS GRANT ROWS, NOT PEOPLE, AND THAT IS THE DECISION. The reach of a
// store ("reaches 7") is the assign dialog's number, computed server-side by
// asking the policy predicate itself; putting a people-count here would mean
// either a second read on every library render or a browser-side copy of the
// corporate-exclusion rule, and the second is the drift this phase exists to
// avoid. "2 stores" is a fact the row already holds.
//
// This lives here rather than in lib/hr-documents-access.ts on purpose: it is
// display, not policy, and the policy module's semantics are out of scope for
// Phase B. It is also client-safe, which that module is not obliged to be.
export type HrAudienceSummary = {
  appliesTo: string
  storeGrants: number
  staffGrants: number
}

const storesLabel = (n: number) => `${n} ${n === 1 ? "store" : "stores"}`
const peopleLabel = (n: number) => `${n} ${n === 1 ? "person" : "people"}`

export function hrAudienceLabel({ appliesTo, storeGrants, staffGrants }: HrAudienceSummary): string {
  // Dormant grant rows under "all" read as Everyone, deliberately — the chip
  // states who the document reaches TODAY. That rows are being preserved
  // underneath, and will govern again if the audience is narrowed, is disclosed
  // in the assign dialog where it is actionable, not in a one-word badge.
  if (appliesTo === "all") return "Everyone"
  if (storeGrants === 0 && staffGrants === 0) return "Unassigned"
  if (storeGrants === 0) return peopleLabel(staffGrants)
  if (staffGrants === 0) return storesLabel(storeGrants)
  return `${storesLabel(storeGrants)} · ${peopleLabel(staffGrants)}`
}

// "Unassigned" is the WARNING state, not a neutral one: it means the document
// is visible to admins and to nobody else, which is the condition this whole
// phase was built to make visible. Everything else is informational.
export function hrAudienceChipStyle(summary: HrAudienceSummary): string {
  const unassigned =
    summary.appliesTo !== "all" && summary.storeGrants === 0 && summary.staffGrants === 0
  return unassigned
    ? "bg-amber-100 text-amber-800 border border-amber-200"
    : "bg-gray-100 text-gray-600 border border-gray-200"
}

// ── HR-5: fillable agreement forms ──────────────────────────────────────────

export const FORM_FIELD_TYPES = ["Text", "Date", "Email", "Phone", "Number", "Select"] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  Text: "Text",
  Date: "Date",
  Email: "Email",
  Phone: "Phone",
  Number: "Number",
  Select: "Dropdown",
}

// FormSubmission lifecycle. A submission is finalized — and its signed PDF
// generated — only at Completed, which requires BOTH signatures.
export const FORM_SUBMISSION_STATUSES = ["PendingSupervisor", "Completed"] as const
export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number]

export const FORM_STATUS_LABELS: Record<FormSubmissionStatus, string> = {
  PendingSupervisor: "Awaiting supervisor",
  Completed: "Completed",
}

export const FORM_STATUS_STYLES: Record<FormSubmissionStatus, string> = {
  PendingSupervisor: "bg-amber-100 text-amber-700 border border-amber-200",
  Completed: "bg-green-100 text-green-700 border border-green-200",
}

// Mirrors the Prisma HrCheckpointType enum — client-safe copy for the editor.
export const HR_CHECKPOINT_TYPES = ["Field", "Initial", "Signature", "Acknowledgment"] as const
export type HrCheckpointTypeName = (typeof HR_CHECKPOINT_TYPES)[number]

export const HR_CHECKPOINT_TYPE_LABELS: Record<HrCheckpointTypeName, string> = {
  Field: "Fill-in field",
  Initial: "Initials",
  Signature: "Signature",
  Acknowledgment: "Acknowledgment",
}

export const HR_CHECKPOINT_TYPE_STYLES: Record<HrCheckpointTypeName, string> = {
  Field: "bg-blue-100 text-blue-700 border border-blue-200",
  Initial: "bg-amber-100 text-amber-700 border border-amber-200",
  Signature: "bg-green-100 text-green-700 border border-green-200",
  Acknowledgment: "bg-purple-100 text-purple-700 border border-purple-200",
}

// ── HR-11b: field anchors ────────────────────────────────────────────────────
// Client-safe mirrors of the Prisma HrAnchorMarkType / HrAnchorPlacement enums,
// so the Document Library confirm UI shares one source of truth with the
// server-only detector (hr-anchors.ts).

export const HR_ANCHOR_MARK_TYPES = [
  "Initial",
  "PrintedName",
  "DateStamp",
  "Store",
  "SignatureStamp",
] as const
export type HrAnchorMarkTypeName = (typeof HR_ANCHOR_MARK_TYPES)[number]

export const HR_ANCHOR_MARK_LABELS: Record<HrAnchorMarkTypeName, string> = {
  Initial: "Signer initials",
  PrintedName: "Printed full name",
  DateStamp: "Date stamp",
  Store: "Store assignment",
  SignatureStamp: "Signature stamp",
}

export const HR_ANCHOR_MARK_HINTS: Record<HrAnchorMarkTypeName, string> = {
  Initial: "e.g. TPT",
  PrintedName: "e.g. Tommy Thomas",
  DateStamp: "date, or date + time (org setting)",
  Store: "e.g. Las Brisas",
  SignatureStamp: "stylized name + electronic-signature notation + timestamp + record ref",
}

export const HR_ANCHOR_PLACEMENTS = ["Right", "Above", "Below"] as const
export type HrAnchorPlacementName = (typeof HR_ANCHOR_PLACEMENTS)[number]

export const HR_ANCHOR_PLACEMENT_LABELS: Record<HrAnchorPlacementName, string> = {
  Right: "On the line (right of label)",
  Above: "Above the line",
  Below: "Below the line",
}

// Org-level inline Date: rendering (Organization.hrDateStampFormat). Validation
// stamps and certificates always render full date+time regardless (DECISIONS F5b).
export const HR_DATE_STAMP_FORMATS = ["dateOnly", "dateTime"] as const
export type HrDateStampFormat = (typeof HR_DATE_STAMP_FORMATS)[number]

// Default attestation for the auto-generated final Acknowledgment checkpoint;
// admins can edit it per checkpoint in the editor.
export function defaultAttestationText(documentTitle: string): string {
  return `I acknowledge that I have received, read, and understand the ${documentTitle}. I agree to comply with its contents as a condition of my employment.`
}

// ESIGN consent shown at the top of the capture flow and snapshotted verbatim
// onto every acknowledgment row (consentText/consentVersion). Bump the version
// whenever the wording changes — never edit a stored row.
export const HR_ESIGN_CONSENT_VERSION = "esign-2026-07"
export const HR_ESIGN_CONSENT_TEXT =
  "I consent to complete and sign this document electronically. I agree that my typed name, " +
  "initials, and acknowledgments are the legal equivalent of my handwritten signature, that I " +
  "have been given access to read the full document before signing, and that I may request a " +
  "paper copy at any time."

// Manager-attested variant: the manager is recording that the staff member
// completed the document (e.g. on paper) — a weaker method, recorded as such.
export const HR_ATTEST_CONSENT_VERSION = "attest-2026-07"
export const HR_ATTEST_CONSENT_TEXT =
  "I attest, as a manager of this organization, that the named team member completed every " +
  "checkpoint of this document in my presence or provided me the completed document, and that " +
  "I am recording it on their behalf. This record is marked as manager-attested."
