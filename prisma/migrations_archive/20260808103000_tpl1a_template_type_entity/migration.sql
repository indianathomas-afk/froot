-- TPL-1a — Template types become a managed per-org entity.
--
-- ADDITIVE ONLY. Nothing is dropped and nothing is narrowed. "Template"."type"
-- (the legacy free-text column) is untouched and keeps being written alongside
-- "typeId"; retiring it is TPL-2, and only after this backfill is proven on all
-- three branches. See docs/prompts/TYPE-1_AUDIT.md.

-- CreateTable
CREATE TABLE "TemplateType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL DEFAULT 'gray',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateType_organizationId_idx" ON "TemplateType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateType_organizationId_name_key" ON "TemplateType"("organizationId", "name");

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "typeId" TEXT;

-- CreateIndex
CREATE INDEX "Template_typeId_idx" ON "Template"("typeId");

-- AddForeignKey
ALTER TABLE "TemplateType" ADD CONSTRAINT "TemplateType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TemplateType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA MIGRATION
--
-- Runs in the same transaction as the structural half, and replays per
-- environment through `prisma migrate deploy` in the Vercel build. It is
-- idempotent: ON CONFLICT DO NOTHING on the seeds, and the backfill only
-- touches rows where "typeId" IS NULL.
--
-- TemplateType ids are generated PER BRANCH, so unlike the inherited
-- Organization/Store rows they will NOT match across dev/staging/production.
-- Never paste a TemplateType id from one branch into a query against another
-- (CLAUDE.md § Database Evidence, inverted).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Seed one TemplateType per distinct (organizationId, type) already in use.
--    Colours carry from the hardcoded map at templates-client.tsx:12-22 where a
--    key matches, neutral 'gray' where not. "Audit" is deliberately NOT seeded:
--    it is a style with no data behind it (Gary, Q1, 2026-08-08). If any row
--    turns out to carry it, this statement picks it up like any other value.
INSERT INTO "TemplateType" ("id", "organizationId", "name", "colorKey", "sortOrder", "createdAt", "updatedAt")
SELECT
    'ttp' || replace(gen_random_uuid()::text, '-', ''),
    d."organizationId",
    d."type",
    COALESCE(m."colorKey", 'gray'),
    0,
    NOW(),
    NOW()
FROM (
    SELECT DISTINCT "organizationId", "type"
    FROM "Template"
    WHERE "type" IS NOT NULL AND btrim("type") <> ''
) d
LEFT JOIN (VALUES
    ('Opener',         'orange'),
    ('Closer',         'purple'),
    ('Mid-Shift',      'blue'),
    ('Cleaning',       'green'),
    ('Management',     'red'),
    ('Coffee',         'amber'),
    ('Berries',        'pink'),
    ('Peet''s Coffee', 'amber')
) AS m("name", "colorKey") ON m."name" = d."type"
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- 2. Starter set for any org that would otherwise end at zero types (Gary, Q5,
--    2026-08-08). Without it the required Type select has nothing to pick and a
--    fresh org cannot create a template at all. These are RENAMEABLE AND
--    DELETABLE DEFAULTS offered to the operator, not a value stamped silently
--    onto a record — which is what distinguishes them from the DEBT-59 offsets.
INSERT INTO "TemplateType" ("id", "organizationId", "name", "colorKey", "sortOrder", "createdAt", "updatedAt")
SELECT
    'ttp' || replace(gen_random_uuid()::text, '-', ''),
    o."id",
    s."name",
    s."colorKey",
    s."sortOrder",
    NOW(),
    NOW()
FROM "Organization" o
CROSS JOIN (VALUES
    ('Opener',    'orange', 0),
    ('Mid-Shift', 'blue',   1),
    ('Closer',    'purple', 2),
    ('Cleaning',  'green',  3)
) AS s("name", "colorKey", "sortOrder")
WHERE NOT EXISTS (
    SELECT 1 FROM "TemplateType" tt WHERE tt."organizationId" = o."id"
)
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- 3. Backfill Template.typeId by exact string match, within the same org.
UPDATE "Template" t
SET "typeId" = tt."id"
FROM "TemplateType" tt
WHERE tt."organizationId" = t."organizationId"
  AND tt."name" = t."type"
  AND t."typeId" IS NULL;
