-- CHK-1 Migration A — Sections become a first-class per-template entity.
--
-- ADDITIVE ONLY. Nothing is dropped and nothing is narrowed. "Task"."sectionName"
-- is untouched and keeps being written alongside "sectionId"; retiring it is a
-- later row, and only after this backfill is proven on all three branches.
-- See docs/prompts/CHK-1_PLAN.md §2.1.

CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Section_templateId_idx" ON "Section"("templateId");
CREATE UNIQUE INDEX "Section_templateId_name_key" ON "Section"("templateId", "name");

ALTER TABLE "Task"    ADD COLUMN "sectionId" TEXT;
ALTER TABLE "TaskLog" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "Checklist" ADD COLUMN "sectionsSnapshot" JSONB;

CREATE INDEX "Task_sectionId_idx"    ON "Task"("sectionId");
CREATE INDEX "TaskLog_sectionId_idx" ON "TaskLog"("sectionId");

ALTER TABLE "Section" ADD CONSTRAINT "Section_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA MIGRATION — idempotent (ON CONFLICT DO NOTHING; backfill touches only
-- rows where "sectionId" IS NULL). Section ids are generated PER BRANCH and
-- will NOT match across dev/staging/production. Never paste one across
-- (CLAUDE.md § Database Evidence, inverted — the TPL-1a note applies verbatim).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. One Section per distinct (templateId, sectionName) already in use.
--    ORDER IS RECOVERED FROM THE DATA, not invented: sortOrder is the section's
--    smallest orderIndex, which is exactly what the adjacency render at
--    template-form.tsx:482 was approximating. A section whose tasks are
--    non-contiguous therefore collapses to ONE heading afterwards instead of
--    rendering twice — that is DEBT-36's second defect being fixed, and it is
--    the one visible change this migration makes.
INSERT INTO "Section" ("id", "templateId", "name", "sortOrder", "createdAt")
SELECT
    'sec' || replace(gen_random_uuid()::text, '-', ''),
    d."templateId",
    d."sectionName",
    d."minOrder",
    NOW()
FROM (
    SELECT "templateId", "sectionName", MIN("orderIndex") AS "minOrder"
    FROM "Task"
    WHERE btrim("sectionName") <> ''
    GROUP BY "templateId", "sectionName"
) d
ON CONFLICT ("templateId", "name") DO NOTHING;

-- 2. Backfill Task.sectionId by exact name match, within the same template.
UPDATE "Task" t
SET "sectionId" = s."id"
FROM "Section" s
WHERE s."templateId" = t."templateId"
  AND s."name" = t."sectionName"
  AND t."sectionId" IS NULL;

-- 3. Backfill TaskLog.sectionId from the task it logged. This is NOT an
--    as-executed record — it is the section the task belongs to TODAY, which is
--    the best that exists for rows written before this migration. The
--    as-executed record starts at the first snapshot written after deploy.
--    See §2.4 for why historical rows are deliberately not fabricated.
UPDATE "TaskLog" tl
SET "sectionId" = t."sectionId"
FROM "Task" t
WHERE t."id" = tl."taskId"
  AND tl."sectionId" IS NULL;
