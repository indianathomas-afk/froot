-- AlterTable
ALTER TABLE "TrainingModule" ADD COLUMN     "orderIndex" INTEGER NOT NULL DEFAULT 0;

-- ─── HAND-WRITTEN BELOW THIS LINE — NOT GENERATED, NOT REGENERABLE ──────────
--
-- HR-29 BACKFILL. Seeds every existing row from the order admins see on
-- /hr/training TODAY (api/hr/training/route.ts:65, `createdAt asc`), so the
-- deploy changes no visible order anywhere until somebody drags. The one order
-- it deliberately does NOT preserve is the Assign dialog's `title asc`
-- (staff/[id]/page.tsx:496) — that dialog leading with "Equipment: How to
-- assemble a Crathco Bubbler" while the list leads with Day 1 is the symptom
-- this row exists to remove.
--
-- IT LIVES IN THE MIGRATION RATHER THAN A SCRIPT, for three reasons. (a)
-- `migrate deploy` runs in the Vercel build, so staging and production each get
-- the seed exactly once, automatically, with no separate human step to forget
-- on the promotion. (b) The column lands NOT NULL DEFAULT 0, so between the
-- ALTER and the backfill every row in an org is tied on 0 and the list order is
-- arbitrary; one file means one transaction and that window never exists. (c)
-- It is idempotent by construction — ROW_NUMBER() recomputes the same answer
-- from "createdAt", which no code path ever rewrites.
--
-- PARTITION BY "organizationId" AND NOTHING ELSE. GLOBAL across the org, never
-- per-category — Gary's ruling of 2026-08-24, recorded verbatim in
-- docs/DECISIONS.md. "categoryId" is nullable, most real modules are
-- uncategorized, and Postgres groups all NULLs into one partition, so a
-- per-category seed would ship as one giant NULL bucket while arming a trap:
-- categorizing a module later would move it into a bucket where its index means
-- nothing. Under GLOBAL, recategorizing moves a badge and nothing else.
--
-- `, "id" ASC` IS NOT DECORATION. "createdAt" is a DateTime and two modules
-- created by one import can share a millisecond. Without a total tie-break
-- ROW_NUMBER() is free to order those two either way, and this file runs
-- SEPARATELY on staging and on production — the same row could land on a
-- different index in each environment, which is the kind of drift that is only
-- ever noticed long after it is cheap to fix. "id" is the primary key, so the
-- ordering is total and both runs agree.
--
-- ARCHIVED AND INACTIVE ROWS ARE SEEDED TOO, deliberately. They are numbered in
-- the same sequence as live rows here, and the reorder endpoint then never
-- rewrites them (it scopes to isActive = true AND isArchived = false). Tabs on
-- /hr/training are mutually exclusive, so an archived row's index is never
-- ranked against a live one on screen; the one place they mix is
-- export?includeArchived=true, where the createdAt tie-break keeps the output
-- deterministic. Consequence, accepted and recorded on HR-29 rather than
-- mechanised: un-archiving a module drops it wherever its stale index falls in
-- the live list, not at the end. One drag fixes it.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "organizationId" ORDER BY "createdAt" ASC, "id" ASC
  ) - 1 AS rn
  FROM "TrainingModule"
)
UPDATE "TrainingModule" t SET "orderIndex" = ranked.rn
FROM ranked WHERE t.id = ranked.id;
