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

// ── HR-11d 2a: what the upload's field scan actually did ─────────────────────
// R2 (Gary, 2026-08-14), the same rule already shipped on rescan: a scan states
// WHICH of the outcomes below happened. A bare zero must never stand in for all
// of them — "0 fields" reads as "this document has no fields" when it can just
// as easily mean "pdfjs threw" or "nobody scanned it".
//
// Client-safe: the routes return the shape, the upload dialog renders the copy.
export const HR_SCAN_OUTCOMES = [
  "carriedForward", // identical bytes ⇒ the prior version's confirmed anchors travelled (2e)
  "needsConfirm", // fields found, none active yet — the operator's to-do
  "noFieldsMatched", // text layer present, no vocabulary token matched
  "noTextLayer", // image-only / scanned PDF
  "scanFailed", // detection threw — NOT the same as finding nothing
  "notScanned", // never attempted (bytes unavailable)
] as const
export type HrScanOutcome = (typeof HR_SCAN_OUTCOMES)[number]

export interface HrVersionScanReport {
  outcome: HrScanOutcome
  matched: number // fields detected in the file
  stored: number // NEW unconfirmed proposals written
  confirmed: number // active anchors on this version after the upload
  carriedForward: number // confirmed anchors copied from an identical prior file (2e)
  pagesScanned: number
  error: string | null
}

/**
 * The line the operator reads when the upload finishes. It ends by telling the
 * person standing there WHAT IS LEFT TO DO — this is a to-do handed to a human,
 * not a success message. The two certificate-only outcomes say so plainly, so
 * "nothing to confirm" cannot be misread as "something went wrong".
 */
export function hrScanMessage(r: HrVersionScanReport): string {
  switch (r.outcome) {
    case "carriedForward":
      return `${r.confirmed} field${r.confirmed === 1 ? "" : "s"} carried forward from the identical previous file — already active. Nothing to confirm.`
    case "needsConfirm":
      return `${r.matched} field${r.matched === 1 ? "" : "s"} found. None are active yet — confirm them before anyone signs.`
    case "noFieldsMatched":
      return `Scanned ${r.pagesScanned} page${r.pagesScanned === 1 ? "" : "s"} — a text layer was found, but none of the field labels matched. Signing works; execution is recorded on the Certificate of Acknowledgment.`
    case "noTextLayer":
      return "No text layer found — this looks like a scanned or image-only PDF. Signing works; execution is recorded on the Certificate of Acknowledgment."
    case "scanFailed":
      return `The version was saved, but field scanning failed${r.error ? `: ${r.error}` : ""}. Use "Scan for fields" on this document before anyone signs — until it runs, nothing can be stamped onto the page body.`
    case "notScanned":
      return 'The version was saved, but its file could not be read for field scanning. Use "Scan for fields" on this document before anyone signs.'
  }
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

// ─── R4: the assignability refusal ───────────────────────────────────────────
//
// Ruled verbatim by Gary 2026-08-15. Shown when an admin tries to give a
// document an audience while its current version's detected fields are
// unconfirmed. It lives HERE rather than beside isSigningBlocked because
// hr-anchors.ts is server-side (unpdf, prisma) and the assign dialog is a client
// component — this file exists precisely to be the shared, client-safe half.
//
// R4 SUPERSEDES THE HR-11d §2b CARVE-OUT, which reads "THE GUARD IS AT THE
// CEREMONY, NEVER AT THE GRANT" (hr/acknowledge/[documentId]/page.tsx). The
// guard moves upstream: a document whose anchors are unconfirmed cannot be
// granted to anyone in the first place.
//
// Admin-facing by construction — only an ADMIN can reach the audience write —
// so this needs no signer variant, unlike the R1 copy pair.
export const HR_ASSIGN_BLOCKED_COPY = "Confirm this document's fields before assigning it."

/**
 * Would this audience selection give the document to anyone? R4 gates GRANTING
 * and never REVOKING.
 *
 * An audience that reaches nobody — "selected" with an empty selection — is how
 * an admin WITHDRAWS a document, and it is exactly what they need when a version
 * has gone unconfirmed underneath a live grant. Refusing that would trap the
 * document in the audience it already has: blocking the grant while forbidding
 * the retreat is worse than not blocking at all, and it is the same dead-end
 * shape the Q1 ruling rejected for image-only PDFs.
 *
 * EXPORTED, PURE, AND SHARED BY THE ROUTE AND THE DIALOG ON PURPOSE. The PUT is
 * the gate and the dialog's disabled Save is only an affordance, so the two are
 * allowed to be different layers — but they are NOT allowed to be different
 * RULES. A Next route file may export nothing but handlers, so a rule defined
 * there could only reach the client as a retyped copy, and a copy of
 * "would this grant to anyone" that drifts by one condition either disables Save
 * on a withdrawal or offers Save on a refusal. Same reason DOC-1 B extracted
 * computeAudienceDelta rather than testing a copy of it.
 *
 * THE "all" LITERAL IS COMPANY_WIDE'S VALUE, restated rather than imported.
 * COMPANY_WIDE lives in lib/hr-documents-access.ts, which reaches prisma through
 * lib/hr and so cannot be imported by a client component — this file is the
 * client-safe half by design. The restatement is contained: the route's Zod
 * union already guarantees `appliesTo` is COMPANY_WIDE or "selected", and the
 * dialog's own Mode type is `"all" | "selected"`, so both callers are typed
 * against the same two strings. The verification script asserts the pairing.
 */
export function audienceWouldGrant(selection: {
  appliesTo: string
  storeIds?: string[]
  staffMemberIds?: string[]
}): boolean {
  if (selection.appliesTo === "all") return true
  return (selection.storeIds?.length ?? 0) + (selection.staffMemberIds?.length ?? 0) > 0
}

// Manager-attested variant: the manager is recording that the staff member
// completed the document (e.g. on paper) — a weaker method, recorded as such.
export const HR_ATTEST_CONSENT_VERSION = "attest-2026-07"
export const HR_ATTEST_CONSENT_TEXT =
  "I attest, as a manager of this organization, that the named team member completed every " +
  "checkpoint of this document in my presence or provided me the completed document, and that " +
  "I am recording it on their behalf. This record is marked as manager-attested."
