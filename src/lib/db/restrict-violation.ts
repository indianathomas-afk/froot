import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"

// ── BUG-24 — A DELETE BLOCKED BY HISTORY IS A 409, NEVER A 500 ───────────────
//
// R1 (draft): a delete that a RESTRICT foreign key refuses returns 409 with one
// plain sentence naming what blocks it, and the UI shows that sentence.
// R3 (draft): ONE matcher for that refusal, used everywhere. It started life in
// api/templates/history.ts (BUG-23), which now re-exports it under its old name.
//
// ── P2003 ALONE DOES NOT CATCH THIS. MEASURED, NOT ASSUMED ─────────────────────
// Postgres reports an ON DELETE RESTRICT violation as SQLSTATE 23001
// (restrict_violation), NOT 23503 (foreign_key_violation). Under
// @prisma/adapter-neon the 23001 is NOT mapped to a P2003
// PrismaClientKnownRequestError: it arrives as a `DriverAdapterError` with
// `cause: { kind: "postgres", code: "23001" }` and no `.code` of its own.
// Observed on dev br-broad-wave-a6vpjdw0, 2026-11-04, by scripts/verify-bug23.ts
// (B5), and again by scripts/verify-bug24.ts. The older comments that say the
// adapter's error "carries no .code to sniff" were right about `.code` and
// wrong about the conclusion: the code is on `.cause`.
//
// So: the Prisma code (for a NO ACTION FK the adapter does map) OR either raw
// SQLSTATE on the adapter's cause.
export function isRestrictViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return true
  const cause = (err as { cause?: { kind?: unknown; code?: unknown } } | null)?.cause
  return cause?.kind === "postgres" && (cause.code === "23001" || cause.code === "23503")
}

// The 409 sentences, one per route, in one place so the fixture asserts the
// exact text the route sends. Route files cannot export them (Next only lets a
// route module export its handlers and config).
export const RESTRICT_MESSAGES = {
  // BUG-24 row 1. No pre-check: three tables block a store, so it is not one
  // `exists`-style query — the catch alone decides.
  store: "This store has checklists, purchase orders or inventory counts — it can't be deleted.",
  // BUG-24 row 3. The pre-check's own sentence, reused for the catch.
  staff: "This staff member has records and cannot be deleted — terminate them instead",
  // BUG-24 row 2, Ruling A, in Gary's words (2026-11-05). Access is already
  // removed in Clerk by the time this can fire, so the sentence says so.
  user: "Access removed. Their record stays because they posted corporate updates",
  // Rows 8–13: the race behind an existing pre-check. Each reuses its route's
  // pre-check sentence; the counted ones drop the count, which the race cannot know.
  templateType: "Templates still use this type — reassign them first",
  trainingCategory: "Modules still use this category — reassign them first",
  hrDocumentCategory: "Documents still use this category — reassign them first",
  trainingModule: "This module has training records — archive it instead",
  trainingAssignment: "This assignment has progress records and cannot be removed",
  hrCheckpoint: "This checkpoint has been signed and is part of the permanent record — mark it not required instead",
} as const

// Runs a delete. Returns null when it succeeded, so the route sends its own
// success shape. Returns a 409 with `message` when a RESTRICT FK refused it.
// Any other error is logged and returns a 500. It is never swallowed into a 409.
export async function refuseIfRestricted(
  run: () => Promise<unknown>,
  message: string,
  context: string,
): Promise<NextResponse | null> {
  try {
    await run()
    return null
  } catch (err) {
    if (isRestrictViolation(err)) return NextResponse.json({ error: message }, { status: 409 })
    console.error(`${context}: delete failed`, err)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
