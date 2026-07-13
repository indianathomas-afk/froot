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
