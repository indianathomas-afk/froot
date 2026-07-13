// Shared between the manager-notes API routes and the Notes tab UI.
// Client-safe — keep server-only imports out of this file.

export const NOTE_CATEGORIES = ["Conversation", "Attendance", "Coaching", "Feedback", "General"] as const

export type NoteCategory = (typeof NOTE_CATEGORIES)[number]

// Color-coded category chips, same shape as ROLE_STYLES on /users.
export const CATEGORY_STYLES: Record<NoteCategory, string> = {
  Conversation: "bg-blue-100 text-blue-700 border border-blue-200",
  Attendance: "bg-amber-100 text-amber-700 border border-amber-200",
  Coaching: "bg-purple-100 text-purple-700 border border-purple-200",
  Feedback: "bg-green-100 text-green-700 border border-green-200",
  General: "bg-gray-100 text-gray-600 border border-gray-200",
}
