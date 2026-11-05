-- AlterTable
ALTER TABLE "NotificationMessage" ADD COLUMN     "recipientReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "NotificationContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipientPick" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipientPick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationContact_organizationId_email_key" ON "NotificationContact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "NotificationRecipientPick_organizationId_kind_idx" ON "NotificationRecipientPick"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipientPick_organizationId_kind_userId_key" ON "NotificationRecipientPick"("organizationId", "kind", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipientPick_organizationId_kind_contactId_key" ON "NotificationRecipientPick"("organizationId", "kind", "contactId");

-- AddForeignKey
ALTER TABLE "NotificationContact" ADD CONSTRAINT "NotificationContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "NotificationContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── HAND-APPENDED BELOW THIS LINE (NOTIFY-12). migrate diff did not generate it. ───
-- docs/prompts/NOTIFY-RCPT_AUDIT.md § 7 and F1; every lean approved by Gary 2026-10-23.

-- Exactly one target per pick. Prisma does not model CHECK constraints and
-- ignores them in later diffs, so this does not register as drift.
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_one_target_check"
    CHECK (("userId" IS NULL) <> ("contactId" IS NULL));

-- F1 BACKFILL, step 1: every hrAckRecipients address becomes an address-book
-- contact. The column holds no names, so the name IS the address; an admin can
-- rename it afterwards. Lower-cased, trimmed and de-duplicated per org — the
-- write route already stored that form, but fixtures wrote the column directly,
-- so the migration does not trust it. The column itself is NOT touched
-- (preserve-and-mark; DEBT-121 drops it later).
INSERT INTO "NotificationContact" ("id", "organizationId", "name", "email", "createdAt", "updatedAt")
SELECT
    'ncn' || replace(gen_random_uuid()::text, '-', ''),
    s."organizationId",
    s."email",
    s."email",
    NOW(),
    NOW()
FROM (
    SELECT DISTINCT o."id" AS "organizationId", lower(trim(a."addr")) AS "email"
    FROM "Organization" o
    CROSS JOIN LATERAL unnest(o."hrAckRecipients") AS a("addr")
    WHERE trim(a."addr") <> ''
) s
ON CONFLICT ("organizationId", "email") DO NOTHING;

-- F1 BACKFILL, step 2: each of those contacts becomes an "hr.ack" pick, so the
-- signed-ack email reaches exactly the addresses it reached before. Joined back
-- to the column rather than taking every contact, so this statement means the
-- same thing whatever else the table holds.
INSERT INTO "NotificationRecipientPick" ("id", "organizationId", "kind", "contactId", "createdAt")
SELECT
    'nrp' || replace(gen_random_uuid()::text, '-', ''),
    c."organizationId",
    'hr.ack',
    c."id",
    NOW()
FROM "NotificationContact" c
JOIN "Organization" o ON o."id" = c."organizationId"
WHERE EXISTS (
    SELECT 1 FROM unnest(o."hrAckRecipients") AS a("addr")
    WHERE lower(trim(a."addr")) = c."email"
)
ON CONFLICT ("organizationId", "kind", "contactId") DO NOTHING;
