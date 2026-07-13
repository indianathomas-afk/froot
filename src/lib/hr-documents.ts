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

// Document kinds shipped so far. FillableForm joins in HR-5.
export const HR_DOCUMENT_KINDS = ["Reference", "Acknowledgment"] as const
export type HrDocumentKind = (typeof HR_DOCUMENT_KINDS)[number]

export const HR_KIND_LABELS: Record<HrDocumentKind, string> = {
  Reference: "Reference",
  Acknowledgment: "Requires signature",
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
