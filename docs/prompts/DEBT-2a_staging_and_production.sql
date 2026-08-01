-- ═══════════════════════════════════════════════════════════════════════════
-- DEBT-2a — section field audit. SELECT ONLY. Nothing here mutates anything.
-- Run in the Neon SQL console, one branch at a time. S0 / P0 FIRST in each
-- block — a result without its identity output does not count.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- BRANCH: preview/staging      EXPECTED endpoint: ep-odd-rain-a6gr4xmm
--                             EXPECTED branch:   br-square-feather-a63z92vz
-- ───────────────────────────────────────────────────────────────────────────

-- S0 — identity. Run this first. If the endpoint is not ep-odd-rain-a6gr4xmm, STOP.
SELECT current_database()                        AS db,
       current_setting('neon.endpoint_id', true) AS endpoint_id,
       current_setting('neon.branch_id',  true)  AS branch_id,
       now() AT TIME ZONE 'UTC'                  AS now_utc;

-- S1 — is Task.sectionName the ONLY carrier? Catalog only, no data scan.
--      dev returned exactly one row: Task / sectionName / text / NO.
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name ILIKE '%section%'
 ORDER BY table_name, column_name;

-- S2 — the census. Bracketed + length, so whitespace and casing drift surface
--      instead of being masked. dev: 29 distinct values, 210 tasks.
SELECT '[' || t."sectionName" || ']'       AS value,
       length(t."sectionName")             AS len,
       count(*)                            AS tasks,
       count(DISTINCT t."templateId")      AS templates,
       count(DISTINCT tp."organizationId") AS orgs
  FROM "Task" t
  JOIN "Template" tp ON tp.id = t."templateId"
 GROUP BY 1, 2
 ORDER BY tasks DESC, value ASC;

-- S3 — anomaly counters. dev: every count 0; 29 spellings = 29 normalized.
SELECT count(*)                                                          AS total_tasks,
       count(*) FILTER (WHERE "sectionName" = '')                        AS empty_string,
       count(*) FILTER (WHERE "sectionName" <> btrim("sectionName"))     AS untrimmed,
       count(*) FILTER (WHERE strpos("sectionName", '  ')     > 0)       AS inner_double_space,
       count(*) FILTER (WHERE strpos("sectionName", chr(9))   > 0)       AS has_tab,
       count(*) FILTER (WHERE strpos("sectionName", chr(10))  > 0)       AS has_newline,
       count(*) FILTER (WHERE strpos("sectionName", chr(13))  > 0)       AS has_cr,
       count(*) FILTER (WHERE strpos("sectionName", chr(160)) > 0)       AS has_nbsp,
       count(*) FILTER (WHERE "sectionName" = 'General')                 AS general_exact,
       count(*) FILTER (WHERE lower("sectionName") = 'general')          AS general_any_case,
       count(DISTINCT "sectionName")                                     AS distinct_spellings,
       count(DISTINCT lower(btrim("sectionName")))                       AS distinct_normalized
  FROM "Task";

-- S4 — near-duplicate drift: spellings that collapse under lower(btrim()).
--      dev: 0 rows.
SELECT lower(btrim("sectionName"))                     AS normalized,
       count(DISTINCT "sectionName")                   AS variants,
       array_agg(DISTINCT '[' || "sectionName" || ']') AS spellings,
       count(*)                                        AS tasks
  FROM "Task"
 GROUP BY 1
HAVING count(DISTINCT "sectionName") > 1
 ORDER BY variants DESC, normalized;

-- S5 — drift WITHIN one template: the same section spelled two ways in one
--      checklist. This is the one that splits a heading in front of staff.
--      dev: 0 rows.
SELECT t."templateId",
       tp.name                                           AS template_name,
       lower(btrim(t."sectionName"))                     AS normalized,
       count(DISTINCT t."sectionName")                   AS variants,
       array_agg(DISTINCT '[' || t."sectionName" || ']') AS spellings
  FROM "Task" t
  JOIN "Template" tp ON tp.id = t."templateId"
 GROUP BY 1, 2, 3
HAVING count(DISTINCT t."sectionName") > 1
 ORDER BY variants DESC;

-- S6 — a section whose tasks are NOT contiguous in orderIndex. The template
--      form draws its header row on adjacency (template-form.tsx:489), so
--      these render two identical headings with no drift in the data at all.
--      dev: 0 rows.
WITH ordered AS (
  SELECT t."templateId", t."sectionName", t."orderIndex",
         row_number() OVER (PARTITION BY t."templateId" ORDER BY t."orderIndex")                  AS rn_all,
         row_number() OVER (PARTITION BY t."templateId", t."sectionName" ORDER BY t."orderIndex") AS rn_sec
    FROM "Task" t
)
SELECT "templateId", "sectionName", count(DISTINCT (rn_all - rn_sec)) AS runs
  FROM ordered
 GROUP BY 1, 2
HAVING count(DISTINCT (rn_all - rn_sec)) > 1
 ORDER BY runs DESC;

-- S7 — scale context. dev: 210 tasks / 8 templates / 8 live / 4 orgs / 38 logs.
SELECT (SELECT count(*) FROM "Task")                                AS tasks,
       (SELECT count(*) FROM "Template")                            AS templates,
       (SELECT count(*) FROM "Template" WHERE "isArchived" = false) AS templates_live,
       (SELECT count(*) FROM "Organization")                        AS orgs,
       (SELECT count(*) FROM "TaskLog")                             AS task_logs;

-- S8 — Task column types + constraints. Included because dev shows a
--      migration-ledger drift on a NEIGHBOURING column, not on sectionName:
--      live dev has estimatedTimeMinutes = double precision, but the only
--      migration that ever creates it says INTEGER. Measuring, not assuming.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Task'
 ORDER BY ordinal_position;

SELECT con.conname, pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
 WHERE rel.relname = 'Task'
 ORDER BY con.conname;

-- S9 — JSON sweep. Bounded to the eight Json columns in schema.prisma, so this
--      is NOT the unbounded query_to_xml pattern. STAGING ONLY, per the DEBT-1
--      precedent. dev: 0 hits in all eight.
SELECT 'AuditLog.metadata' AS col, count(*) AS hits FROM "AuditLog" WHERE "metadata"::text ILIKE '%section%'
UNION ALL SELECT 'Vendor.deliveryDays',                   count(*) FROM "Vendor"              WHERE "deliveryDays"::text       ILIKE '%section%'
UNION ALL SELECT 'HrDocumentVersion.definitionSnapshot',  count(*) FROM "HrDocumentVersion"   WHERE "definitionSnapshot"::text ILIKE '%section%'
UNION ALL SELECT 'FormField.options',                     count(*) FROM "FormField"           WHERE "options"::text            ILIKE '%section%'
UNION ALL SELECT 'FormSubmission.values',                 count(*) FROM "FormSubmission"      WHERE "values"::text             ILIKE '%section%'
UNION ALL SELECT 'TrainingQuiz.questions',                count(*) FROM "TrainingQuiz"        WHERE "questions"::text          ILIKE '%section%'
UNION ALL SELECT 'TrainingQuizAttempt.questionsSnapshot', count(*) FROM "TrainingQuizAttempt" WHERE "questionsSnapshot"::text  ILIKE '%section%'
UNION ALL SELECT 'TrainingQuizAttempt.answers',           count(*) FROM "TrainingQuizAttempt" WHERE "answers"::text            ILIKE '%section%'
 ORDER BY 1;


-- ───────────────────────────────────────────────────────────────────────────
-- BRANCH: production           EXPECTED endpoint: ep-green-smoke-a6xthq4r
--                             EXPECTED branch:   br-sparkling-block-a620qvg4
--
-- S9 (the JSON data sweep) is deliberately NOT repeated here — DEBT-1
-- precedent, expensive sweeps are staging-only. P1 is the catalog query and
-- answers the structural question for production on its own.
-- ───────────────────────────────────────────────────────────────────────────

-- P0 — identity. Run this first. If the endpoint is not ep-green-smoke-a6xthq4r, STOP.
SELECT current_database()                        AS db,
       current_setting('neon.endpoint_id', true) AS endpoint_id,
       current_setting('neon.branch_id',  true)  AS branch_id,
       now() AT TIME ZONE 'UTC'                  AS now_utc;

-- P1 — only carrier?
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name ILIKE '%section%'
 ORDER BY table_name, column_name;

-- P2 — census.
SELECT '[' || t."sectionName" || ']'       AS value,
       length(t."sectionName")             AS len,
       count(*)                            AS tasks,
       count(DISTINCT t."templateId")      AS templates,
       count(DISTINCT tp."organizationId") AS orgs
  FROM "Task" t
  JOIN "Template" tp ON tp.id = t."templateId"
 GROUP BY 1, 2
 ORDER BY tasks DESC, value ASC;

-- P3 — anomaly counters.
SELECT count(*)                                                          AS total_tasks,
       count(*) FILTER (WHERE "sectionName" = '')                        AS empty_string,
       count(*) FILTER (WHERE "sectionName" <> btrim("sectionName"))     AS untrimmed,
       count(*) FILTER (WHERE strpos("sectionName", '  ')     > 0)       AS inner_double_space,
       count(*) FILTER (WHERE strpos("sectionName", chr(9))   > 0)       AS has_tab,
       count(*) FILTER (WHERE strpos("sectionName", chr(10))  > 0)       AS has_newline,
       count(*) FILTER (WHERE strpos("sectionName", chr(13))  > 0)       AS has_cr,
       count(*) FILTER (WHERE strpos("sectionName", chr(160)) > 0)       AS has_nbsp,
       count(*) FILTER (WHERE "sectionName" = 'General')                 AS general_exact,
       count(*) FILTER (WHERE lower("sectionName") = 'general')          AS general_any_case,
       count(DISTINCT "sectionName")                                     AS distinct_spellings,
       count(DISTINCT lower(btrim("sectionName")))                       AS distinct_normalized
  FROM "Task";

-- P4 — near-duplicate drift.
SELECT lower(btrim("sectionName"))                     AS normalized,
       count(DISTINCT "sectionName")                   AS variants,
       array_agg(DISTINCT '[' || "sectionName" || ']') AS spellings,
       count(*)                                        AS tasks
  FROM "Task"
 GROUP BY 1
HAVING count(DISTINCT "sectionName") > 1
 ORDER BY variants DESC, normalized;

-- P5 — drift within one template.
SELECT t."templateId",
       tp.name                                           AS template_name,
       lower(btrim(t."sectionName"))                     AS normalized,
       count(DISTINCT t."sectionName")                   AS variants,
       array_agg(DISTINCT '[' || t."sectionName" || ']') AS spellings
  FROM "Task" t
  JOIN "Template" tp ON tp.id = t."templateId"
 GROUP BY 1, 2, 3
HAVING count(DISTINCT t."sectionName") > 1
 ORDER BY variants DESC;

-- P6 — non-contiguous section runs.
WITH ordered AS (
  SELECT t."templateId", t."sectionName", t."orderIndex",
         row_number() OVER (PARTITION BY t."templateId" ORDER BY t."orderIndex")                  AS rn_all,
         row_number() OVER (PARTITION BY t."templateId", t."sectionName" ORDER BY t."orderIndex") AS rn_sec
    FROM "Task" t
)
SELECT "templateId", "sectionName", count(DISTINCT (rn_all - rn_sec)) AS runs
  FROM ordered
 GROUP BY 1, 2
HAVING count(DISTINCT (rn_all - rn_sec)) > 1
 ORDER BY runs DESC;

-- P7 — scale context.
SELECT (SELECT count(*) FROM "Task")                                AS tasks,
       (SELECT count(*) FROM "Template")                            AS templates,
       (SELECT count(*) FROM "Template" WHERE "isArchived" = false) AS templates_live,
       (SELECT count(*) FROM "Organization")                        AS orgs,
       (SELECT count(*) FROM "TaskLog")                             AS task_logs;

-- P8 — Task column types + constraints (the estimatedTimeMinutes ledger check).
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Task'
 ORDER BY ordinal_position;

SELECT con.conname, pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
 WHERE rel.relname = 'Task'
 ORDER BY con.conname;
