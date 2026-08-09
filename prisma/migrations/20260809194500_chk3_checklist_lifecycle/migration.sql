-- CHK-3 Migration B — Checklist lifecycle, plus the two keys that were owed.
--
-- ADDITIVE ONLY. Nothing is dropped and nothing is narrowed.
-- See docs/prompts/CHK-1_PLAN.md §2.2 and §5, and the CHK-3 row in
-- docs/ROADMAP.yaml for the two carried-in items (a) and (b).
--
-- Every structural statement below was checked against
--   npx prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma --script
-- and matches its output exactly, so the migration and the schema cannot have
-- drifted. The order differs (the columns are grouped with their comments here);
-- the statements do not.

ALTER TABLE "Checklist" ADD COLUMN "closedAt"        TIMESTAMP(3);
ALTER TABLE "Checklist" ADD COLUMN "completedLate"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Checklist" ADD COLUMN "expectedStartAt" TIMESTAMP(3);
ALTER TABLE "Checklist" ADD COLUMN "expectedEndAt"   TIMESTAMP(3);

-- The day-close job scans by (storeId, date). Without this it is a seq scan on
-- the whole table every hour, forever.
CREATE INDEX "Checklist_storeId_date_idx" ON "Checklist"("storeId", "date");

-- Report surface: "missed, by day, across the org".
CREATE INDEX "Checklist_organizationId_date_status_idx"
    ON "Checklist"("organizationId", "date", "status");

-- ─────────────────────────────────────────────────────────────────────────────
-- THE TWO UNIQUE INDEXES ARE THE ONLY STATEMENTS HERE THAT CAN FAIL ON EXISTING
-- DATA, and both are gated on a precheck Gary runs per LIVE branch — dev,
-- preview/staging, production — immediately before this migration is applied.
-- `preview/main` is an archived fossil; do not query it and do not treat a
-- result from it as evidence (plan §0a, DEBT-62).
--
--   SELECT current_setting('neon.branch_id', true) AS branch,
--          (SELECT count(*) FROM (SELECT 1 FROM "Checklist"
--                                 GROUP BY "storeId","templateId","date"
--                                 HAVING count(*) > 1) d) AS checklist_dupes,
--          (SELECT count(*) FROM (SELECT 1 FROM "StoreHours"
--                                 GROUP BY "storeId","dayOfWeek"
--                                 HAVING count(*) > 1) d) AS storehours_dupes;
--
-- ZERO EVERYWHERE → both ship. NON-ZERO for either → DELETE THAT ONE STATEMENT
-- FROM THIS FILE **AND** ITS @@unique FROM prisma/schema.prisma (Checklist ~:560
-- / StoreHours ~:200), report the rows, and let the rest of the migration go.
-- A non-zero re-measure DROPS THE INDEX; IT DOES NOT DELAY THE MIGRATION. Both
-- edits are needed or schema and database drift — that is the whole cost of the
-- fallback, and it is cheaper than a failing migration blocking a Vercel build
-- on every branch.
--
-- The code does not depend on either index. The cron creates its rows with
-- read-then-write plus a unique-violation catch, and the StoreHours writer
-- replaces the whole week in a transaction; both are correct with or without
-- the constraint. The index makes the duplicate unrepresentable rather than
-- merely unlikely.
-- ─────────────────────────────────────────────────────────────────────────────

-- Closes the findFirst-then-create race at api/checklists/route.ts:125-130
-- (single) and :163-167 (bulk), which the hourly cron becomes a third racer
-- against. Gary's precheck returned duplicate_groups 0 on all three live
-- branches 2026-08-09 (plan §0a) — RE-MEASURED, not cited, before this ran.
CREATE UNIQUE INDEX "Checklist_storeId_templateId_date_key"
    ON "Checklist"("storeId", "templateId", "date");

-- CHK-3 row item (a), carried in from S2's triage. StoreHours has had no key
-- since 20260627002005_init, so the table can hold two rows for one weekday and
-- both readers resolve that with `.find()` — whichever comes back first wins,
-- silently. CHK-2's editor has been writing this table on staging since
-- 2026-08-09, which is why this one needs re-measuring at least as much as the
-- one above.
CREATE UNIQUE INDEX "StoreHours_storeId_dayOfWeek_key"
    ON "StoreHours"("storeId", "dayOfWeek");

-- NO BACKFILL. Every pre-existing row keeps closedAt NULL, completedLate false
-- and both expectations NULL. That is correct rather than lazy: no expected
-- window existed before this phase, so no historical row can be said to have met
-- or missed one, and inventing expectations for them would manufacture exactly
-- the retroactive data DEBT-59 spent a session preventing. The lifecycle starts
-- at deploy. The report says so on its face (plan §6.3/§7).
