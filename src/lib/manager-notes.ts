// Shared between the manager-notes API routes and the Notes tab UI.
// Client-safe — keep server-only imports out of this file.

export const NOTE_CATEGORIES = ["Conversation", "Attendance", "Coaching", "Feedback", "General"] as const

export type NoteCategory = (typeof NOTE_CATEGORIES)[number]
