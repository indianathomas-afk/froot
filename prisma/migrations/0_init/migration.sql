-- 0_init — baseline migration. DEBT-125 (baseline squash), closes BUG-25.
--
-- Replaces the 86 migrations archived in prisma/migrations_archive/
-- (20260627002005_init … 20261104020000_tpl3_task_retired_at).
-- Twenty tables had no CREATE TABLE in that history, so a fresh `migrate deploy`
-- could not build the schema (BUG-25). This file builds it in one step.
--
-- PART 1 is the unedited output of
--   npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
-- (Prisma 7.8.0, 2026-11-05).
-- PART 2 is hand-written (DEBT-125 R3): the 8 objects the schema can't express,
-- each copied verbatim from the archived migration named above it.
--
-- Existing databases (dev, staging, production) are MARKED as having applied
-- this file by a Neon-console INSERT into _prisma_migrations (DEBT-125 R2).
-- This SQL never runs on them. The INSERT's checksum is sha256 of this file
-- byte for byte, so ANY edit to it after marking breaks the checksum match.
-- Never edit this file once a branch is marked; make a new migration instead.
--
-- ============================================================================
-- PART 1 — generated from prisma/schema.prisma
-- ============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'STAFF', 'STORE');

-- CreateEnum
CREATE TYPE "NutritionStatus" AS ENUM ('ESTIMATED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "NutritionInboxStatus" AS ENUM ('UPLOADED', 'READ', 'FAILED', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('MILK', 'EGGS', 'FISH', 'CRUSTACEAN_SHELLFISH', 'TREE_NUTS', 'PEANUTS', 'WHEAT', 'SOYBEANS', 'SESAME');

-- CreateEnum
CREATE TYPE "GoalBasisType" AS ENUM ('SQUARE_LAST_YEAR', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "HrCheckpointType" AS ENUM ('Field', 'Initial', 'Signature', 'Acknowledgment');

-- CreateEnum
CREATE TYPE "HrAckMethod" AS ENUM ('Field', 'Initial', 'Signature', 'ReadReceipt', 'Attested');

-- CreateEnum
CREATE TYPE "HrAuthMethod" AS ENUM ('ClerkSession', 'Kiosk', 'ManagerAttested');

-- CreateEnum
CREATE TYPE "HrAnchorMarkType" AS ENUM ('Initial', 'PrintedName', 'DateStamp', 'Store', 'SignatureStamp');

-- CreateEnum
CREATE TYPE "HrAnchorPlacement" AS ENUM ('Right', 'Above', 'Below');

-- CreateEnum
CREATE TYPE "HrReturnEventType" AS ENUM ('Returned', 'Reissued');

-- CreateEnum
CREATE TYPE "LaborPayType" AS ENUM ('HOURLY', 'SALARIED');

-- CreateEnum
CREATE TYPE "LaborDenominator" AS ENUM ('IN_STORE', 'TOTAL_WITH_DELIVERY');

-- CreateEnum
CREATE TYPE "SalesForecastSource" AS ENUM ('MANUAL', 'LAST_YEAR', 'TREND');

-- CreateEnum
CREATE TYPE "LaborDailySplitPolicy" AS ENUM ('FLOOR_FIRST', 'SALES_WEIGHTED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "squareCustomerId" TEXT,
    "squareSubscriptionId" TEXT,
    "subscriptionStatus" TEXT DEFAULT 'inactive',
    "activeModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "squareAccessToken" TEXT,
    "squareRefreshToken" TEXT,
    "squareTokenExpiresAt" TIMESTAMP(3),
    "lastCatalogSyncAt" TIMESTAMP(3),
    "instagramAccessToken" TEXT,
    "instagramTokenExpiresAt" TIMESTAMP(3),
    "instagramUserId" TEXT,
    "instagramUsername" TEXT,
    "instagramEnabled" BOOLEAN NOT NULL DEFAULT false,
    "instagramConnectedAt" TIMESTAMP(3),
    "squareLaborEnabled" BOOLEAN NOT NULL DEFAULT false,
    "calendarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "milestonesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paceAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paceAlertThresholdPct" INTEGER,
    "milestoneAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "docDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "handoffNoteExpireDays" INTEGER NOT NULL DEFAULT 2,
    "hrDateStampFormat" TEXT NOT NULL DEFAULT 'dateOnly',
    "hrAckRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "nutritionServingFlOz" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "defaultStoreId" TEXT,
    "deniedCapabilities" TEXT[],
    "grantedCapabilities" TEXT[],
    "lastSeenAt" TIMESTAMP(3),
    "lastSeenLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareLocationId" TEXT,
    "storeNumber" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "contactEmail" TEXT,
    "phoneNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreHours" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openingTime" TEXT,
    "closingTime" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StoreHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreUserAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "StoreUserAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staffMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT,
    "displayName" TEXT NOT NULL,
    "fullName" TEXT,
    "fullNameLocked" BOOLEAN NOT NULL DEFAULT false,
    "squareFullName" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "terminatedAt" TIMESTAMP(3),
    "userId" TEXT,
    "signingCycle" INTEGER NOT NULL DEFAULT 1,
    "rehiredAt" TIMESTAMP(3),
    "isCorporate" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE,
    "startDateManual" BOOLEAN NOT NULL DEFAULT false,
    "squareStartDate" DATE,
    "milestoneEligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreStaffAssignment" (
    "id" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StoreStaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "typeId" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'Daily',
    "availabilityType" TEXT NOT NULL DEFAULT 'StoreHours',
    "operationalPhase" TEXT,
    "startOffsetHours" INTEGER,
    "endOffsetHours" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "TemplateStoreAssignment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "TemplateStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "sectionId" TEXT,
    "description" TEXT NOT NULL,
    "estimatedTimeMinutes" DOUBLE PRECISION,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requiresTemp" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "excludedStoreIds" TEXT[],
    "videoUrl" TEXT,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checklist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completionRate" DOUBLE PRECISION DEFAULT 0,
    "sectionsSnapshot" JSONB,
    "closedAt" TIMESTAMP(3),
    "completedLate" BOOLEAN NOT NULL DEFAULT false,
    "expectedStartAt" TIMESTAMP(3),
    "expectedEndAt" TIMESTAMP(3),
    "calendarOccurrenceId" TEXT,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLog" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sectionId" TEXT,
    "completedByUserId" TEXT,
    "completedByStaffId" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photoUrl" TEXT,
    "temperatureValue" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "TaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaceAlertLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "pacePct" DOUBLE PRECISION NOT NULL,
    "thresholdPct" DOUBLE PRECISION NOT NULL,
    "recipients" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaceAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "entityId" TEXT,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "userId" TEXT,
    "messageId" TEXT,
    "state" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "intentId" TEXT,
    "intentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipientReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "NotificationSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "sendHour" INTEGER NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "dayOfMonth" INTEGER,
    "timeZone" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationScheduleRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "slotDate" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT,
    "date" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageArea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientStorageMapping" (
    "id" TEXT NOT NULL,
    "storageAreaId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IngredientStorageMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemMetadata" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareCatalogObjId" TEXT NOT NULL,
    "vendorName" TEXT,
    "vendorId" TEXT,
    "glCode" TEXT,
    "parLevel" DOUBLE PRECISION,
    "unitCostOverride" DOUBLE PRECISION,
    "unitOfMeasure" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareItemId" TEXT,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "productType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemVariation" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "squareVariationId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "priceMoney" INTEGER,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogItemVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "terms" TEXT,
    "leadTimeDays" INTEGER,
    "minOrderCases" DOUBLE PRECISION,
    "minOrderDollars" DOUBLE PRECISION,
    "deliveryDays" JSONB,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAdjustment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "glCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderAdjustment" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "vendorAdjustmentId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "glCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIngredient" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "vendorSku" TEXT,
    "packDescription" TEXT,
    "casePrice" DOUBLE PRECISION,
    "unitsPerCase" DOUBLE PRECISION,

    CONSTRAINT "VendorIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "orderedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "enteredByUserId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "invoiceFileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "quantityOrdered" DOUBLE PRECISION NOT NULL,
    "quantityReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,
    "receivingNote" TEXT,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SquareCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareItemId" TEXT NOT NULL,
    "squareVariationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variationName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "squareCategoryId" TEXT,
    "menuGroup" TEXT,
    "priceCents" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "recipeStatus" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareModifierList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareModifierListId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordinal" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareModifierList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareModifierId" TEXT NOT NULL,
    "modifierListId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER,
    "ordinal" INTEGER,
    "onByDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "recipeStatus" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareItemModifierList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareItemId" TEXT NOT NULL,
    "modifierListId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SquareItemModifierList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "glCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IngredientCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "subcategory" TEXT,
    "sku" TEXT,
    "purchaseUnitLabel" TEXT NOT NULL,
    "packDescription" TEXT,
    "purchaseCost" DOUBLE PRECISION NOT NULL,
    "reportingUnit" TEXT NOT NULL,
    "unitsPerPurchase" DOUBLE PRECISION NOT NULL,
    "costPerReportingUnit" DOUBLE PRECISION NOT NULL,
    "glCodeOverride" TEXT,
    "productNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "lastEditedByUserId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PURCHASED',
    "preparedFromRecipeId" TEXT,
    "tareWeightOz" DOUBLE PRECISION,
    "fullWeightOz" DOUBLE PRECISION,
    "notes" TEXT,
    "nutritionExempt" BOOLEAN NOT NULL DEFAULT false,
    "allergens" "Allergen"[] DEFAULT ARRAY[]::"Allergen"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientNutrition" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "basisAmount" DOUBLE PRECISION,
    "basisUnit" TEXT,
    "calories" DOUBLE PRECISION,
    "totalFatG" DOUBLE PRECISION,
    "saturatedFatG" DOUBLE PRECISION,
    "transFatG" DOUBLE PRECISION,
    "cholesterolMg" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "totalCarbG" DOUBLE PRECISION,
    "dietaryFiberG" DOUBLE PRECISION,
    "totalSugarsG" DOUBLE PRECISION,
    "addedSugarsG" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "vitaminDMcg" DOUBLE PRECISION,
    "calciumMg" DOUBLE PRECISION,
    "ironMg" DOUBLE PRECISION,
    "potassiumMg" DOUBLE PRECISION,
    "sourceNote" TEXT,
    "updatedByUserId" TEXT,
    "status" "NutritionStatus" NOT NULL DEFAULT 'ESTIMATED',
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "labelFileUrl" TEXT,
    "labelFilePathname" TEXT,
    "labelFileName" TEXT,
    "labelContentType" TEXT,
    "labelSizeBytes" INTEGER,
    "labelFileHash" TEXT,
    "labelUploadedByUserId" TEXT,
    "labelUploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientNutrition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionLabelInboxItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "NutritionInboxStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileUrl" TEXT,
    "filePathname" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "suggestedIngredientId" TEXT,
    "ingredientId" TEXT,
    "readAuditId" TEXT,
    "readError" TEXT,
    "uploadedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionLabelInboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionSizeVolume" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variationName" TEXT NOT NULL,
    "volumeFlOz" DOUBLE PRECISION NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionSizeVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionItemServing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "salesItemId" TEXT NOT NULL,
    "perItem" BOOLEAN NOT NULL DEFAULT false,
    "volumeFlOz" DOUBLE PRECISION,
    "servingFlOz" DOUBLE PRECISION,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionItemServing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicMenu" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "disclaimer" TEXT,
    "crossContactNotice" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicMenuCategory" (
    "publicMenuId" TEXT NOT NULL,
    "squareCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicMenuCategory_pkey" PRIMARY KEY ("publicMenuId","squareCategoryId")
);

-- CreateTable
CREATE TABLE "PublicMenuHiddenItem" (
    "publicMenuId" TEXT NOT NULL,
    "squareItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicMenuHiddenItem_pkey" PRIMARY KEY ("publicMenuId","squareItemId")
);

-- CreateTable
CREATE TABLE "IngredientCostLog" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "costPerReportingUnit" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientCostLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientDuplicateDismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingredientAId" TEXT NOT NULL,
    "ingredientBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientDuplicateDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "isPartial" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "completedByUserIds" TEXT[],
    "sittingInventoryVal" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Draft',

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "storageAreaId" TEXT,
    "ingredientId" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "reportingUnit" TEXT NOT NULL,
    "quantityCounted" DOUBLE PRECISION,
    "costPerReportingUnit" DOUBLE PRECISION NOT NULL,
    "lineValue" DOUBLE PRECISION,
    "usageVariance" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountCorrection" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION,
    "newValue" DOUBLE PRECISION,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCountCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPeriodCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "grossSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unconfirmedNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tipTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiersCaptured" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SalesPeriodCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLineCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "squareVariationId" TEXT NOT NULL,
    "quantitySold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossSales" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SalesLineCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesModifierCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "squareModifierId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SalesModifierCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesHourlyCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "netSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesHourlyCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMonthlyGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "goalAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreMonthlyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salesItemId" TEXT,
    "squareModifierId" TEXT,
    "yieldQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "yieldUnit" TEXT NOT NULL DEFAULT 'serving',
    "servingSizeQty" DOUBLE PRECISION,
    "servingSizeUnit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "subRecipeId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdjustmentGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStoreId" TEXT,
    "toStoreId" TEXT,
    "destinationLabel" TEXT,
    "recipeId" TEXT,
    "batchMultiplier" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdjustmentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "costPerReportingUnit" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "lossReasonId" TEXT,
    "groupId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossReason" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LossReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VarianceAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesItemId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "qtyDelta" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VarianceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreIngredientPar" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "parLevel" DOUBLE PRECISION,
    "reorderPoint" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreIngredientPar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareCatalogObjId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemNutrition" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "servingSize" TEXT,
    "calories" INTEGER,
    "totalFatG" DOUBLE PRECISION,
    "saturatedFatG" DOUBLE PRECISION,
    "transFatG" DOUBLE PRECISION,
    "cholesterolMg" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "totalCarbG" DOUBLE PRECISION,
    "dietaryFiberG" DOUBLE PRECISION,
    "totalSugarsG" DOUBLE PRECISION,
    "addedSugarsG" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "vitaminDMcg" DOUBLE PRECISION,
    "calciumMg" DOUBLE PRECISION,
    "ironMg" DOUBLE PRECISION,
    "potassiumMg" DOUBLE PRECISION,

    CONSTRAINT "MenuItemNutrition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemAllergen" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,

    CONSTRAINT "MenuItemAllergen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "basisType" "GoalBasisType" NOT NULL,
    "basisTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "increasePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importFileUrl" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyGoal" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "basisAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DailyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorStaffId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    "shiftPhase" TEXT,
    "body" TEXT NOT NULL,
    "linkedIngredientId" TEXT,
    "postedToTemplateId" TEXT,
    "postedForDate" DATE,
    "sourceChecklistId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TeamMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "corporateUpdateId" TEXT,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pinnedUntil" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CorporateUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryId" TEXT,
    "appliesTo" TEXT NOT NULL DEFAULT 'selected',
    "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedFormId" TEXT,
    "bodyText" TEXT,
    "externalUrl" TEXT,
    "instructionsHtml" TEXT,
    "instructionsVideoUrl" TEXT,
    "tracksReturn" BOOLEAN NOT NULL DEFAULT false,
    "returnItemLabel" TEXT,
    "signWithinDays" INTEGER,
    "signWithinDaysSetAt" TIMESTAMP(3),
    "reSignEveryMonths" INTEGER,
    "reSignEveryMonthsSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL DEFAULT 'gray',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "defaultSignWithinDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDocumentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentStoreAssignment" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "granteeType" TEXT NOT NULL DEFAULT 'STORE',
    "storeId" TEXT,
    "staffMemberId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDocumentStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentVersion" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "definitionSnapshot" JSONB,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "requiresReacknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentCheckpoint" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HrCheckpointType" NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "pageRef" INTEGER,
    "attestationText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "retiredAt" TIMESTAMP(3),
    "retiredByUserId" TEXT,
    "retiredReason" TEXT,

    CONSTRAINT "HrDocumentCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAnchor" (
    "id" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "pageRotation" INTEGER NOT NULL DEFAULT 0,
    "anchorText" TEXT NOT NULL,
    "markType" "HrAnchorMarkType" NOT NULL,
    "placement" "HrAnchorPlacement" NOT NULL DEFAULT 'Right',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "generatedCheckpointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentAcknowledgment" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "staffMemberId" TEXT,
    "userId" TEXT,
    "checkpointName" TEXT NOT NULL,
    "checkpointType" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL,
    "documentVersionNumber" INTEGER NOT NULL,
    "documentFileHash" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "storeName" TEXT,
    "attestationText" TEXT,
    "method" "HrAckMethod" NOT NULL,
    "typedName" TEXT,
    "signatureImageUrl" TEXT,
    "fieldValue" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "authMethod" "HrAuthMethod" NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "consentText" TEXT,
    "consentVersion" TEXT,
    "signingCycle" INTEGER NOT NULL DEFAULT 1,
    "renewal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrDocumentAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSignedRecord" (
    "id" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "signedPdfPathname" TEXT NOT NULL,
    "signedPdfHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signingCycle" INTEGER NOT NULL DEFAULT 1,
    "renewal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrSignedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrReturnEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "type" "HrReturnEventType" NOT NULL,
    "occurredOn" DATE NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrReturnEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "employeeSignatureUrl" TEXT,
    "supervisorSignatureUrl" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PendingSupervisor',
    "supervisorUserId" TEXT,
    "employeeTypedName" TEXT,
    "supervisorTypedName" TEXT,
    "employeeSignedAt" TIMESTAMP(3),
    "supervisorSignedAt" TIMESTAMP(3),
    "supervisorIpAddress" TEXT,
    "supervisorUserAgent" TEXT,
    "formTitle" TEXT,
    "formVersionNumber" INTEGER,
    "staffName" TEXT,
    "storeName" TEXT,
    "definitionHash" TEXT,
    "consentText" TEXT,
    "consentVersion" TEXT,
    "signedPdfPathname" TEXT,
    "signedPdfHash" TEXT,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "filePathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "visibleToStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL DEFAULT 'gray',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "categoryId" TEXT,
    "description" TEXT,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModuleStoreAssignment" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "TrainingModuleStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLesson" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "info" TEXT,
    "videoUrl" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "linkedHrDocumentId" TEXT,
    "externalLinkUrl" TEXT,
    "externalLinkLabel" TEXT,

    CONSTRAINT "TrainingLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingResource" (
    "id" TEXT NOT NULL,
    "trainingLessonId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuiz" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "passThreshold" INTEGER NOT NULL DEFAULT 80,
    "questions" JSONB NOT NULL,

    CONSTRAINT "TrainingQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAssignment" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "trainerUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "hoursLogged" DOUBLE PRECISION,
    "certifiedAt" TIMESTAMP(3),
    "certPdfPathname" TEXT,
    "certPdfHash" TEXT,
    "certifiedByUserId" TEXT,
    "trainerTypedName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLessonProgress" (
    "id" TEXT NOT NULL,
    "trainingAssignmentId" TEXT NOT NULL,
    "trainingLessonId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedByStaffId" TEXT,
    "authMethod" "HrAuthMethod",
    "completedByUserId" TEXT,

    CONSTRAINT "TrainingLessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuizAttempt" (
    "id" TEXT NOT NULL,
    "trainingAssignmentId" TEXT NOT NULL,
    "questionsSnapshot" JSONB NOT NULL,
    "passThresholdSnapshot" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "scorePct" INTEGER,
    "status" TEXT NOT NULL,
    "authMethod" "HrAuthMethod" NOT NULL,
    "attestedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingQuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyDayHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "date" DATE NOT NULL,
    "hoursOverride" DECIMAL(6,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyDayHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payType" "LaborPayType" NOT NULL DEFAULT 'HOURLY',
    "defaultHourlyRate" DECIMAL(10,2) NOT NULL,
    "impliedWeeklyHours" INTEGER,
    "isSupervisory" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborPositionStoreHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "laborPositionId" TEXT NOT NULL,
    "weeklyHours" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborPositionStoreHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborSalariedPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "weeklyCost" DECIMAL(10,2) NOT NULL,
    "weeklyHours" INTEGER NOT NULL,
    "exempt" BOOLEAN,
    "squareAnnualRateSeen" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborSalariedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborSalariedAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "allocationBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborSalariedAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT,
    "laborTargetPct" DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    "roundingIncrement" DECIMAL(10,2) NOT NULL DEFAULT 1000.00,
    "denominator" "LaborDenominator" NOT NULL DEFAULT 'TOTAL_WITH_DELIVERY',
    "plannedBlendedRate" DECIMAL(10,2),
    "dailySplitPolicy" "LaborDailySplitPolicy" NOT NULL DEFAULT 'FLOOR_FIRST',
    "gmOnFloorStartMinutes" INTEGER,
    "gmOnFloorEndMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesForecast" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "projectedStoreSales" DECIMAL(10,2) NOT NULL,
    "projectedDelivery" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "source" "SalesForecastSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborDaySplit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "weightBps" INTEGER NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborDaySplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborDaypart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "startLocalMinutes" INTEGER NOT NULL,
    "endLocalMinutes" INTEGER NOT NULL,
    "minHeadcount" INTEGER NOT NULL DEFAULT 1,
    "requiresSupervisor" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborDaypart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborDayAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "adjustmentPct" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborDayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareTimecard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "squareTimecardId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "squareLocationId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "squareVersion" INTEGER NOT NULL,
    "squareCreatedAt" TIMESTAMP(3) NOT NULL,
    "squareUpdatedAt" TIMESTAMP(3) NOT NULL,
    "breakPaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakUnpaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "wageTitle" TEXT,
    "wageJobId" TEXT,
    "wageHourlyRate" DECIMAL(10,2),
    "wageTipEligible" BOOLEAN,
    "declaredCashTips" DECIMAL(10,2),
    "timezone" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareTimecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareLaborSyncState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncOkAt" TIMESTAMP(3),
    "lastWindowStart" DATE,
    "lastWindowEnd" DATE,
    "lastTimecardCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareLaborSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareTeamMemberWage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "allLocations" BOOLEAN NOT NULL DEFAULT false,
    "locationIds" TEXT[],
    "jobTitle" TEXT,
    "jobId" TEXT,
    "payType" TEXT,
    "jobAssignmentCount" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(10,2),
    "annualRate" DECIMAL(12,2),
    "squareWeeklyHours" INTEGER,
    "isOvertimeExempt" BOOLEAN,
    "wageVersion" INTEGER,
    "squareUpdatedAt" TIMESTAMP(3),
    "weeklyHoursOverride" INTEGER,
    "isSupervisory" BOOLEAN,
    "compConfidential" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareTeamMemberWage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareScheduledShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "squareScheduledShiftId" TEXT NOT NULL,
    "squareVersion" INTEGER NOT NULL,
    "squareCreatedAt" TIMESTAMP(3) NOT NULL,
    "squareUpdatedAt" TIMESTAMP(3) NOT NULL,
    "draftLocationId" TEXT NOT NULL,
    "draftJobId" TEXT NOT NULL,
    "draftStartAt" TIMESTAMP(3) NOT NULL,
    "draftEndAt" TIMESTAMP(3) NOT NULL,
    "draftTimezone" TEXT NOT NULL,
    "draftIsDeleted" BOOLEAN NOT NULL,
    "draftTeamMemberId" TEXT,
    "draftNotes" TEXT,
    "publishedLocationId" TEXT,
    "publishedJobId" TEXT,
    "publishedStartAt" TIMESTAMP(3),
    "publishedEndAt" TIMESTAMP(3),
    "publishedTimezone" TEXT,
    "publishedIsDeleted" BOOLEAN,
    "publishedTeamMemberId" TEXT,
    "publishedNotes" TEXT,
    "effectiveLocationId" TEXT NOT NULL,
    "effectiveJobId" TEXT NOT NULL,
    "effectiveStartAt" TIMESTAMP(3) NOT NULL,
    "effectiveEndAt" TIMESTAMP(3) NOT NULL,
    "effectiveTimezone" TEXT NOT NULL,
    "effectiveIsDeleted" BOOLEAN NOT NULL,
    "effectiveTeamMemberId" TEXT,
    "effectiveSource" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareScheduledShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareScheduleSyncState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncOkAt" TIMESTAMP(3),
    "lastWindowStart" DATE,
    "lastWindowEnd" DATE,
    "lastShiftCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareScheduleSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareJobColor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareJobId" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareJobColor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "url" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Standard',
    "recurrence" TEXT NOT NULL DEFAULT 'None',
    "startDate" DATE NOT NULL,
    "dueTime" TEXT,
    "endDate" DATE,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventStoreAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAttachment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarOccurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completedByStaffId" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenureMilestone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dayCount" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "recognition" TEXT NOT NULL,
    "employeeMessage" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenureMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistMilestone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskCount" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "recognition" TEXT NOT NULL,
    "employeeMessage" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "payType" TEXT,
    "hourlyRate" DECIMAL(10,2),
    "annualRate" DECIMAL(12,2),
    "jobId" TEXT,
    "wageVersion" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLastRaise" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "lastRaiseDate" DATE,
    "setByUserId" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLastRaise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "onTimeRedBelow" INTEGER NOT NULL DEFAULT 80,
    "onTimeGreenAtOrAbove" INTEGER NOT NULL DEFAULT 90,
    "onTimeLookbackDays" INTEGER NOT NULL DEFAULT 30,
    "onTimeMinShifts" INTEGER NOT NULL DEFAULT 5,
    "onTimeGraceMinutes" INTEGER NOT NULL DEFAULT 5,
    "raiseComplianceGate" BOOLEAN NOT NULL DEFAULT true,
    "raiseMinHoursPerWeek" INTEGER NOT NULL DEFAULT 20,
    "raiseConsecutiveWeeks" INTEGER NOT NULL DEFAULT 3,
    "raiseMinOnTimePct" INTEGER NOT NULL DEFAULT 90,
    "raiseCooldownDays" INTEGER NOT NULL DEFAULT 90,
    "checklistMilestonesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneRaiseTraining" (
    "milestoneSettingsId" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneRaiseTraining_pkey" PRIMARY KEY ("milestoneSettingsId","trainingModuleId")
);

-- CreateTable
CREATE TABLE "MilestoneRaiseDocument" (
    "milestoneSettingsId" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneRaiseDocument_pkey" PRIMARY KEY ("milestoneSettingsId","hrDocumentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_clerkOrgId_key" ON "Organization"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_squareLocationId_key" ON "Store"("squareLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreHours_storeId_dayOfWeek_key" ON "StoreHours"("storeId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "StoreUserAssignment_userId_storeId_key" ON "StoreUserAssignment"("userId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingInvite_organizationId_email_key" ON "PendingInvite"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_organizationId_squareTeamMemberId_key" ON "StaffMember"("organizationId", "squareTeamMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreStaffAssignment_staffMemberId_storeId_key" ON "StoreStaffAssignment"("staffMemberId", "storeId");

-- CreateIndex
CREATE INDEX "Template_typeId_idx" ON "Template"("typeId");

-- CreateIndex
CREATE INDEX "TemplateType_organizationId_idx" ON "TemplateType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateType_organizationId_name_key" ON "TemplateType"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateStoreAssignment_templateId_storeId_key" ON "TemplateStoreAssignment"("templateId", "storeId");

-- CreateIndex
CREATE INDEX "Section_templateId_idx" ON "Section"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_templateId_name_key" ON "Section"("templateId", "name");

-- CreateIndex
CREATE INDEX "Task_sectionId_idx" ON "Task"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAttachment_taskId_key" ON "TaskAttachment"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_calendarOccurrenceId_key" ON "Checklist"("calendarOccurrenceId");

-- CreateIndex
CREATE INDEX "Checklist_storeId_date_idx" ON "Checklist"("storeId", "date");

-- CreateIndex
CREATE INDEX "Checklist_organizationId_date_status_idx" ON "Checklist"("organizationId", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_storeId_templateId_date_key" ON "Checklist"("storeId", "templateId", "date");

-- CreateIndex
CREATE INDEX "TaskLog_sectionId_idx" ON "TaskLog"("sectionId");

-- CreateIndex
CREATE INDEX "TaskLog_completedByStaffId_idx" ON "TaskLog"("completedByStaffId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_createdAt_idx" ON "AuditLog"("organizationId", "entityType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaceAlertLog_storeId_month_key" ON "PaceAlertLog"("storeId", "month");

-- CreateIndex
CREATE INDEX "NotificationIntent_state_nextAttemptAt_idx" ON "NotificationIntent"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationIntent_organizationId_kind_dedupeKey_key" ON "NotificationIntent"("organizationId", "kind", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_messageId_idx" ON "NotificationDelivery"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_intentId_recipient_key" ON "NotificationDelivery"("intentId", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMessage_providerMessageId_key" ON "NotificationMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "NotificationMessage_organizationId_createdAt_idx" ON "NotificationMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationMessage_intentId_idx" ON "NotificationMessage"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_messageId_type_key" ON "NotificationEvent"("messageId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationContact_organizationId_email_key" ON "NotificationContact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "NotificationRecipientPick_organizationId_kind_idx" ON "NotificationRecipientPick"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipientPick_organizationId_kind_userId_key" ON "NotificationRecipientPick"("organizationId", "kind", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipientPick_organizationId_kind_contactId_key" ON "NotificationRecipientPick"("organizationId", "kind", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSchedule_organizationId_kind_key" ON "NotificationSchedule"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationScheduleRun_organizationId_kind_scopeKey_slotDa_key" ON "NotificationScheduleRun"("organizationId", "kind", "scopeKey", "slotDate");

-- CreateIndex
CREATE INDEX "UsageDaily_organizationId_lastAt_idx" ON "UsageDaily"("organizationId", "lastAt");

-- CreateIndex
CREATE INDEX "UsageDaily_organizationId_storeId_date_idx" ON "UsageDaily"("organizationId", "storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UsageDaily_userId_path_date_key" ON "UsageDaily"("userId", "path", "date");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientStorageMapping_storageAreaId_ingredientId_key" ON "IngredientStorageMapping"("storageAreaId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMetadata_organizationId_squareCatalogObjId_key" ON "ItemMetadata"("organizationId", "squareCatalogObjId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCategory_organizationId_squareCategoryId_key" ON "CatalogCategory"("organizationId", "squareCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_organizationId_squareItemId_key" ON "CatalogItem"("organizationId", "squareItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemVariation_catalogItemId_squareVariationId_key" ON "CatalogItemVariation"("catalogItemId", "squareVariationId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorIngredient_vendorId_ingredientId_key" ON "VendorIngredient"("vendorId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_poNumber_key" ON "PurchaseOrder"("organizationId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SquareCategory_organizationId_squareCategoryId_key" ON "SquareCategory"("organizationId", "squareCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesItem_organizationId_squareVariationId_key" ON "SalesItem"("organizationId", "squareVariationId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareModifierList_organizationId_squareModifierListId_key" ON "SquareModifierList"("organizationId", "squareModifierListId");

-- CreateIndex
CREATE INDEX "SquareModifier_modifierListId_idx" ON "SquareModifier"("modifierListId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareModifier_organizationId_squareModifierId_key" ON "SquareModifier"("organizationId", "squareModifierId");

-- CreateIndex
CREATE INDEX "SquareItemModifierList_organizationId_squareItemId_idx" ON "SquareItemModifierList"("organizationId", "squareItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareItemModifierList_organizationId_squareItemId_modifier_key" ON "SquareItemModifierList"("organizationId", "squareItemId", "modifierListId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientCategory_organizationId_name_key" ON "IngredientCategory"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_preparedFromRecipeId_key" ON "Ingredient"("preparedFromRecipeId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientNutrition_ingredientId_key" ON "IngredientNutrition"("ingredientId");

-- CreateIndex
CREATE INDEX "NutritionLabelInboxItem_organizationId_status_createdAt_idx" ON "NutritionLabelInboxItem"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionSizeVolume_organizationId_variationName_key" ON "NutritionSizeVolume"("organizationId", "variationName");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionItemServing_salesItemId_key" ON "NutritionItemServing"("salesItemId");

-- CreateIndex
CREATE INDEX "NutritionItemServing_organizationId_idx" ON "NutritionItemServing"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicMenu_organizationId_key" ON "PublicMenu"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicMenu_slug_key" ON "PublicMenu"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientDuplicateDismissal_organizationId_ingredientAId_i_key" ON "IngredientDuplicateDismissal"("organizationId", "ingredientAId", "ingredientBId");

-- CreateIndex
CREATE INDEX "SalesPeriodCache_organizationId_date_idx" ON "SalesPeriodCache"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPeriodCache_storeId_date_key" ON "SalesPeriodCache"("storeId", "date");

-- CreateIndex
CREATE INDEX "SalesLineCache_storeId_date_idx" ON "SalesLineCache"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesLineCache_storeId_date_squareVariationId_key" ON "SalesLineCache"("storeId", "date", "squareVariationId");

-- CreateIndex
CREATE INDEX "SalesModifierCache_storeId_date_idx" ON "SalesModifierCache"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesModifierCache_storeId_date_squareModifierId_key" ON "SalesModifierCache"("storeId", "date", "squareModifierId");

-- CreateIndex
CREATE INDEX "SalesHourlyCache_storeId_date_idx" ON "SalesHourlyCache"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesHourlyCache_storeId_date_hour_key" ON "SalesHourlyCache"("storeId", "date", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMonthlyGoal_storeId_month_key" ON "StoreMonthlyGoal"("storeId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_salesItemId_key" ON "Recipe"("salesItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_squareModifierId_key" ON "Recipe"("squareModifierId");

-- CreateIndex
CREATE INDEX "Recipe_organizationId_idx" ON "Recipe"("organizationId");

-- CreateIndex
CREATE INDEX "RecipeLine_recipeId_idx" ON "RecipeLine"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeLine_subRecipeId_idx" ON "RecipeLine"("subRecipeId");

-- CreateIndex
CREATE INDEX "AdjustmentGroup_organizationId_occurredAt_idx" ON "AdjustmentGroup"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_storeId_occurredAt_idx" ON "InventoryAdjustment"("storeId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_organizationId_occurredAt_idx" ON "InventoryAdjustment"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_groupId_idx" ON "InventoryAdjustment"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "LossReason_organizationId_label_key" ON "LossReason"("organizationId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "VarianceAdjustment_storeId_salesItemId_periodKey_key" ON "VarianceAdjustment"("storeId", "salesItemId", "periodKey");

-- CreateIndex
CREATE INDEX "StoreIngredientPar_organizationId_idx" ON "StoreIngredientPar"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreIngredientPar_storeId_ingredientId_key" ON "StoreIngredientPar"("storeId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemNutrition_menuItemId_key" ON "MenuItemNutrition"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemAllergen_menuItemId_allergen_key" ON "MenuItemAllergen"("menuItemId", "allergen");

-- CreateIndex
CREATE INDEX "GoalPlan_organizationId_year_idx" ON "GoalPlan"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "GoalPlan_storeId_year_key" ON "GoalPlan"("storeId", "year");

-- CreateIndex
CREATE INDEX "DailyGoal_planId_idx" ON "DailyGoal"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyGoal_storeId_date_key" ON "DailyGoal"("storeId", "date");

-- CreateIndex
CREATE INDEX "TeamMessage_storeId_createdAt_idx" ON "TeamMessage"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TeamMessage_storeId_postedToTemplateId_postedForDate_idx" ON "TeamMessage"("storeId", "postedToTemplateId", "postedForDate");

-- CreateIndex
CREATE INDEX "TeamMessage_organizationId_createdAt_idx" ON "TeamMessage"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "MessageAttachment_corporateUpdateId_idx" ON "MessageAttachment"("corporateUpdateId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "MessageRead_userId_idx" ON "MessageRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageRead_messageId_userId_key" ON "MessageRead"("messageId", "userId");

-- CreateIndex
CREATE INDEX "CorporateUpdate_organizationId_publishedAt_idx" ON "CorporateUpdate"("organizationId", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "HrDocument_organizationId_idx" ON "HrDocument"("organizationId");

-- CreateIndex
CREATE INDEX "HrDocument_categoryId_idx" ON "HrDocument"("categoryId");

-- CreateIndex
CREATE INDEX "HrDocumentCategory_organizationId_idx" ON "HrDocumentCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentCategory_organizationId_name_key" ON "HrDocumentCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "HrDocumentStoreAssignment_staffMemberId_idx" ON "HrDocumentStoreAssignment"("staffMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentStoreAssignment_hrDocumentId_storeId_key" ON "HrDocumentStoreAssignment"("hrDocumentId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentVersion_hrDocumentId_versionNumber_key" ON "HrDocumentVersion"("hrDocumentId", "versionNumber");

-- CreateIndex
CREATE INDEX "DocumentAnchor_hrDocumentVersionId_idx" ON "DocumentAnchor"("hrDocumentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key" ON "HrDocumentAcknowledgment"("checkpointId", "hrDocumentVersionId", "staffMemberId", "signingCycle", "renewal");

-- CreateIndex
CREATE INDEX "HrSignedRecord_staffMemberId_idx" ON "HrSignedRecord"("staffMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key" ON "HrSignedRecord"("hrDocumentVersionId", "staffMemberId", "signingCycle", "renewal");

-- CreateIndex
CREATE INDEX "HrReturnEvent_organizationId_idx" ON "HrReturnEvent"("organizationId");

-- CreateIndex
CREATE INDEX "HrReturnEvent_hrDocumentId_staffMemberId_createdAt_idx" ON "HrReturnEvent"("hrDocumentId", "staffMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "HrReturnEvent_staffMemberId_idx" ON "HrReturnEvent"("staffMemberId");

-- CreateIndex
CREATE INDEX "FormSubmission_staffMemberId_idx" ON "FormSubmission"("staffMemberId");

-- CreateIndex
CREATE INDEX "FormSubmission_hrDocumentVersionId_idx" ON "FormSubmission"("hrDocumentVersionId");

-- CreateIndex
CREATE INDEX "ManagerNote_staffMemberId_createdAt_idx" ON "ManagerNote"("staffMemberId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ManagerNote_organizationId_idx" ON "ManagerNote"("organizationId");

-- CreateIndex
CREATE INDEX "StaffDocument_staffMemberId_createdAt_idx" ON "StaffDocument"("staffMemberId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StaffDocument_organizationId_idx" ON "StaffDocument"("organizationId");

-- CreateIndex
CREATE INDEX "TrainingCategory_organizationId_idx" ON "TrainingCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCategory_organizationId_name_key" ON "TrainingCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TrainingModule_organizationId_idx" ON "TrainingModule"("organizationId");

-- CreateIndex
CREATE INDEX "TrainingModule_categoryId_idx" ON "TrainingModule"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModuleStoreAssignment_trainingModuleId_storeId_key" ON "TrainingModuleStoreAssignment"("trainingModuleId", "storeId");

-- CreateIndex
CREATE INDEX "TrainingLesson_linkedHrDocumentId_idx" ON "TrainingLesson"("linkedHrDocumentId");

-- CreateIndex
CREATE INDEX "TrainingAssignment_staffMemberId_idx" ON "TrainingAssignment"("staffMemberId");

-- CreateIndex
CREATE INDEX "TrainingAssignment_trainingModuleId_idx" ON "TrainingAssignment"("trainingModuleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAssignment_trainingModuleId_staffMemberId_key" ON "TrainingAssignment"("trainingModuleId", "staffMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingLessonProgress_trainingAssignmentId_trainingLessonI_key" ON "TrainingLessonProgress"("trainingAssignmentId", "trainingLessonId");

-- CreateIndex
CREATE INDEX "TrainingQuizAttempt_trainingAssignmentId_idx" ON "TrainingQuizAttempt"("trainingAssignmentId");

-- CreateIndex
CREATE INDEX "WeeklyDayHours_organizationId_storeId_weekStart_idx" ON "WeeklyDayHours"("organizationId", "storeId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDayHours_storeId_date_key" ON "WeeklyDayHours"("storeId", "date");

-- CreateIndex
CREATE INDEX "LaborPosition_organizationId_idx" ON "LaborPosition"("organizationId");

-- CreateIndex
CREATE INDEX "LaborPositionStoreHours_organizationId_storeId_idx" ON "LaborPositionStoreHours"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborPositionStoreHours_storeId_laborPositionId_key" ON "LaborPositionStoreHours"("storeId", "laborPositionId");

-- CreateIndex
CREATE INDEX "LaborSalariedPerson_organizationId_idx" ON "LaborSalariedPerson"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborSalariedPerson_organizationId_squareTeamMemberId_key" ON "LaborSalariedPerson"("organizationId", "squareTeamMemberId");

-- CreateIndex
CREATE INDEX "LaborSalariedAllocation_organizationId_storeId_idx" ON "LaborSalariedAllocation"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborSalariedAllocation_personId_storeId_key" ON "LaborSalariedAllocation"("personId", "storeId");

-- CreateIndex
CREATE INDEX "LaborAssignment_organizationId_storeId_date_idx" ON "LaborAssignment"("organizationId", "storeId", "date");

-- CreateIndex
CREATE INDEX "LaborAssignment_staffMemberId_date_idx" ON "LaborAssignment"("staffMemberId", "date");

-- CreateIndex
CREATE INDEX "LaborSettings_organizationId_idx" ON "LaborSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborSettings_organizationId_storeId_key" ON "LaborSettings"("organizationId", "storeId");

-- CreateIndex
CREATE INDEX "SalesForecast_organizationId_storeId_idx" ON "SalesForecast"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesForecast_storeId_weekStart_key" ON "SalesForecast"("storeId", "weekStart");

-- CreateIndex
CREATE INDEX "LaborDaySplit_organizationId_storeId_idx" ON "LaborDaySplit"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborDaySplit_storeId_weekday_key" ON "LaborDaySplit"("storeId", "weekday");

-- CreateIndex
CREATE INDEX "LaborDaypart_organizationId_idx" ON "LaborDaypart"("organizationId");

-- CreateIndex
CREATE INDEX "LaborDayAdjustment_organizationId_storeId_idx" ON "LaborDayAdjustment"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborDayAdjustment_storeId_date_key" ON "LaborDayAdjustment"("storeId", "date");

-- CreateIndex
CREATE INDEX "SquareTimecard_storeId_startAt_idx" ON "SquareTimecard"("storeId", "startAt");

-- CreateIndex
CREATE INDEX "SquareTimecard_organizationId_syncedAt_idx" ON "SquareTimecard"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquareTimecard_organizationId_squareTimecardId_key" ON "SquareTimecard"("organizationId", "squareTimecardId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareLaborSyncState_storeId_key" ON "SquareLaborSyncState"("storeId");

-- CreateIndex
CREATE INDEX "SquareLaborSyncState_organizationId_idx" ON "SquareLaborSyncState"("organizationId");

-- CreateIndex
CREATE INDEX "SquareTeamMemberWage_organizationId_syncedAt_idx" ON "SquareTeamMemberWage"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquareTeamMemberWage_organizationId_squareTeamMemberId_key" ON "SquareTeamMemberWage"("organizationId", "squareTeamMemberId");

-- CreateIndex
CREATE INDEX "SquareScheduledShift_storeId_effectiveStartAt_idx" ON "SquareScheduledShift"("storeId", "effectiveStartAt");

-- CreateIndex
CREATE INDEX "SquareScheduledShift_organizationId_syncedAt_idx" ON "SquareScheduledShift"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquareScheduledShift_organizationId_squareScheduledShiftId_key" ON "SquareScheduledShift"("organizationId", "squareScheduledShiftId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareScheduleSyncState_storeId_key" ON "SquareScheduleSyncState"("storeId");

-- CreateIndex
CREATE INDEX "SquareScheduleSyncState_organizationId_idx" ON "SquareScheduleSyncState"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareJobColor_organizationId_squareJobId_key" ON "SquareJobColor"("organizationId", "squareJobId");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_isArchived_idx" ON "CalendarEvent"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "CalendarEvent_templateId_idx" ON "CalendarEvent"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventStoreAssignment_eventId_storeId_key" ON "CalendarEventStoreAssignment"("eventId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventAttachment_eventId_key" ON "CalendarEventAttachment"("eventId");

-- CreateIndex
CREATE INDEX "CalendarOccurrence_organizationId_storeId_status_dueDate_idx" ON "CalendarOccurrence"("organizationId", "storeId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarOccurrence_eventId_storeId_dueDate_key" ON "CalendarOccurrence"("eventId", "storeId", "dueDate");

-- CreateIndex
CREATE INDEX "TenureMilestone_organizationId_isArchived_idx" ON "TenureMilestone"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "ChecklistMilestone_organizationId_isArchived_idx" ON "ChecklistMilestone"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "WageSnapshot_organizationId_squareTeamMemberId_capturedAt_idx" ON "WageSnapshot"("organizationId", "squareTeamMemberId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLastRaise_staffMemberId_key" ON "StaffLastRaise"("staffMemberId");

-- CreateIndex
CREATE INDEX "StaffLastRaise_organizationId_idx" ON "StaffLastRaise"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneSettings_organizationId_key" ON "MilestoneSettings"("organizationId");

-- CreateIndex
CREATE INDEX "MilestoneRaiseTraining_trainingModuleId_idx" ON "MilestoneRaiseTraining"("trainingModuleId");

-- CreateIndex
CREATE INDEX "MilestoneRaiseDocument_hrDocumentId_idx" ON "MilestoneRaiseDocument"("hrDocumentId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultStoreId_fkey" FOREIGN KEY ("defaultStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreHours" ADD CONSTRAINT "StoreHours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreUserAssignment" ADD CONSTRAINT "StoreUserAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreUserAssignment" ADD CONSTRAINT "StoreUserAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingInvite" ADD CONSTRAINT "PendingInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreStaffAssignment" ADD CONSTRAINT "StoreStaffAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreStaffAssignment" ADD CONSTRAINT "StoreStaffAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TemplateType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateType" ADD CONSTRAINT "TemplateType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateStoreAssignment" ADD CONSTRAINT "TemplateStoreAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateStoreAssignment" ADD CONSTRAINT "TemplateStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_calendarOccurrenceId_fkey" FOREIGN KEY ("calendarOccurrenceId") REFERENCES "CalendarOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaceAlertLog" ADD CONSTRAINT "PaceAlertLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaceAlertLog" ADD CONSTRAINT "PaceAlertLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationContact" ADD CONSTRAINT "NotificationContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "NotificationContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationScheduleRun" ADD CONSTRAINT "NotificationScheduleRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageArea" ADD CONSTRAINT "StorageArea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageArea" ADD CONSTRAINT "StorageArea_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStorageMapping" ADD CONSTRAINT "IngredientStorageMapping_storageAreaId_fkey" FOREIGN KEY ("storageAreaId") REFERENCES "StorageArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStorageMapping" ADD CONSTRAINT "IngredientStorageMapping_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMetadata" ADD CONSTRAINT "ItemMetadata_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMetadata" ADD CONSTRAINT "ItemMetadata_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemVariation" ADD CONSTRAINT "CatalogItemVariation_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAdjustment" ADD CONSTRAINT "VendorAdjustment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAdjustment" ADD CONSTRAINT "PurchaseOrderAdjustment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAdjustment" ADD CONSTRAINT "PurchaseOrderAdjustment_vendorAdjustmentId_fkey" FOREIGN KEY ("vendorAdjustmentId") REFERENCES "VendorAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIngredient" ADD CONSTRAINT "VendorIngredient_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIngredient" ADD CONSTRAINT "VendorIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareCategory" ADD CONSTRAINT "SquareCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesItem" ADD CONSTRAINT "SalesItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesItem" ADD CONSTRAINT "SalesItem_squareCategoryId_fkey" FOREIGN KEY ("squareCategoryId") REFERENCES "SquareCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareModifierList" ADD CONSTRAINT "SquareModifierList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareModifier" ADD CONSTRAINT "SquareModifier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareModifier" ADD CONSTRAINT "SquareModifier_modifierListId_fkey" FOREIGN KEY ("modifierListId") REFERENCES "SquareModifierList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareItemModifierList" ADD CONSTRAINT "SquareItemModifierList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareItemModifierList" ADD CONSTRAINT "SquareItemModifierList_modifierListId_fkey" FOREIGN KEY ("modifierListId") REFERENCES "SquareModifierList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCategory" ADD CONSTRAINT "IngredientCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IngredientCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_preparedFromRecipeId_fkey" FOREIGN KEY ("preparedFromRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientNutrition" ADD CONSTRAINT "IngredientNutrition_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionLabelInboxItem" ADD CONSTRAINT "NutritionLabelInboxItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionSizeVolume" ADD CONSTRAINT "NutritionSizeVolume_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionItemServing" ADD CONSTRAINT "NutritionItemServing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionItemServing" ADD CONSTRAINT "NutritionItemServing_salesItemId_fkey" FOREIGN KEY ("salesItemId") REFERENCES "SalesItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenu" ADD CONSTRAINT "PublicMenu_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenuCategory" ADD CONSTRAINT "PublicMenuCategory_publicMenuId_fkey" FOREIGN KEY ("publicMenuId") REFERENCES "PublicMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenuCategory" ADD CONSTRAINT "PublicMenuCategory_squareCategoryId_fkey" FOREIGN KEY ("squareCategoryId") REFERENCES "SquareCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenuHiddenItem" ADD CONSTRAINT "PublicMenuHiddenItem_publicMenuId_fkey" FOREIGN KEY ("publicMenuId") REFERENCES "PublicMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCostLog" ADD CONSTRAINT "IngredientCostLog_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientDuplicateDismissal" ADD CONSTRAINT "IngredientDuplicateDismissal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_storageAreaId_fkey" FOREIGN KEY ("storageAreaId") REFERENCES "StorageArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountCorrection" ADD CONSTRAINT "InventoryCountCorrection_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPeriodCache" ADD CONSTRAINT "SalesPeriodCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPeriodCache" ADD CONSTRAINT "SalesPeriodCache_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLineCache" ADD CONSTRAINT "SalesLineCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLineCache" ADD CONSTRAINT "SalesLineCache_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesModifierCache" ADD CONSTRAINT "SalesModifierCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesModifierCache" ADD CONSTRAINT "SalesModifierCache_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesHourlyCache" ADD CONSTRAINT "SalesHourlyCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesHourlyCache" ADD CONSTRAINT "SalesHourlyCache_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMonthlyGoal" ADD CONSTRAINT "StoreMonthlyGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMonthlyGoal" ADD CONSTRAINT "StoreMonthlyGoal_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_salesItemId_fkey" FOREIGN KEY ("salesItemId") REFERENCES "SalesItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_squareModifierId_fkey" FOREIGN KEY ("squareModifierId") REFERENCES "SquareModifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentGroup" ADD CONSTRAINT "AdjustmentGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentGroup" ADD CONSTRAINT "AdjustmentGroup_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentGroup" ADD CONSTRAINT "AdjustmentGroup_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_lossReasonId_fkey" FOREIGN KEY ("lossReasonId") REFERENCES "LossReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AdjustmentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossReason" ADD CONSTRAINT "LossReason_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VarianceAdjustment" ADD CONSTRAINT "VarianceAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VarianceAdjustment" ADD CONSTRAINT "VarianceAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VarianceAdjustment" ADD CONSTRAINT "VarianceAdjustment_salesItemId_fkey" FOREIGN KEY ("salesItemId") REFERENCES "SalesItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientPar" ADD CONSTRAINT "StoreIngredientPar_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientPar" ADD CONSTRAINT "StoreIngredientPar_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientPar" ADD CONSTRAINT "StoreIngredientPar_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemNutrition" ADD CONSTRAINT "MenuItemNutrition_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAllergen" ADD CONSTRAINT "MenuItemAllergen_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPlan" ADD CONSTRAINT "GoalPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPlan" ADD CONSTRAINT "GoalPlan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyGoal" ADD CONSTRAINT "DailyGoal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GoalPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyGoal" ADD CONSTRAINT "DailyGoal_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_linkedIngredientId_fkey" FOREIGN KEY ("linkedIngredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_postedToTemplateId_fkey" FOREIGN KEY ("postedToTemplateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_sourceChecklistId_fkey" FOREIGN KEY ("sourceChecklistId") REFERENCES "Checklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TeamMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_corporateUpdateId_fkey" FOREIGN KEY ("corporateUpdateId") REFERENCES "CorporateUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TeamMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TeamMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateUpdate" ADD CONSTRAINT "CorporateUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateUpdate" ADD CONSTRAINT "CorporateUpdate_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HrDocumentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentCategory" ADD CONSTRAINT "HrDocumentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "HrDocumentStoreAssignment_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "HrDocumentStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "HrDocumentStoreAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentVersion" ADD CONSTRAINT "HrDocumentVersion_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentCheckpoint" ADD CONSTRAINT "HrDocumentCheckpoint_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnchor" ADD CONSTRAINT "DocumentAnchor_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentAcknowledgment" ADD CONSTRAINT "HrDocumentAcknowledgment_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "HrDocumentCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentAcknowledgment" ADD CONSTRAINT "HrDocumentAcknowledgment_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSignedRecord" ADD CONSTRAINT "HrSignedRecord_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSignedRecord" ADD CONSTRAINT "HrSignedRecord_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrReturnEvent" ADD CONSTRAINT "HrReturnEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrReturnEvent" ADD CONSTRAINT "HrReturnEvent_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrReturnEvent" ADD CONSTRAINT "HrReturnEvent_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerNote" ADD CONSTRAINT "ManagerNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerNote" ADD CONSTRAINT "ManagerNote_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCategory" ADD CONSTRAINT "TrainingCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModule" ADD CONSTRAINT "TrainingModule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModule" ADD CONSTRAINT "TrainingModule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TrainingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleStoreAssignment" ADD CONSTRAINT "TrainingModuleStoreAssignment_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleStoreAssignment" ADD CONSTRAINT "TrainingModuleStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_linkedHrDocumentId_fkey" FOREIGN KEY ("linkedHrDocumentId") REFERENCES "HrDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingResource" ADD CONSTRAINT "TrainingResource_trainingLessonId_fkey" FOREIGN KEY ("trainingLessonId") REFERENCES "TrainingLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuiz" ADD CONSTRAINT "TrainingQuiz_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_trainingLessonId_fkey" FOREIGN KEY ("trainingLessonId") REFERENCES "TrainingLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuizAttempt" ADD CONSTRAINT "TrainingQuizAttempt_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDayHours" ADD CONSTRAINT "WeeklyDayHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDayHours" ADD CONSTRAINT "WeeklyDayHours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborPosition" ADD CONSTRAINT "LaborPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborPositionStoreHours" ADD CONSTRAINT "LaborPositionStoreHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborPositionStoreHours" ADD CONSTRAINT "LaborPositionStoreHours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborPositionStoreHours" ADD CONSTRAINT "LaborPositionStoreHours_laborPositionId_fkey" FOREIGN KEY ("laborPositionId") REFERENCES "LaborPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedPerson" ADD CONSTRAINT "LaborSalariedPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedAllocation" ADD CONSTRAINT "LaborSalariedAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedAllocation" ADD CONSTRAINT "LaborSalariedAllocation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "LaborSalariedPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedAllocation" ADD CONSTRAINT "LaborSalariedAllocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSettings" ADD CONSTRAINT "LaborSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSettings" ADD CONSTRAINT "LaborSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesForecast" ADD CONSTRAINT "SalesForecast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesForecast" ADD CONSTRAINT "SalesForecast_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaySplit" ADD CONSTRAINT "LaborDaySplit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaySplit" ADD CONSTRAINT "LaborDaySplit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaypart" ADD CONSTRAINT "LaborDaypart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaypart" ADD CONSTRAINT "LaborDaypart_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDayAdjustment" ADD CONSTRAINT "LaborDayAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDayAdjustment" ADD CONSTRAINT "LaborDayAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareTimecard" ADD CONSTRAINT "SquareTimecard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareTimecard" ADD CONSTRAINT "SquareTimecard_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareLaborSyncState" ADD CONSTRAINT "SquareLaborSyncState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareLaborSyncState" ADD CONSTRAINT "SquareLaborSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareTeamMemberWage" ADD CONSTRAINT "SquareTeamMemberWage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduledShift" ADD CONSTRAINT "SquareScheduledShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduledShift" ADD CONSTRAINT "SquareScheduledShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduleSyncState" ADD CONSTRAINT "SquareScheduleSyncState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduleSyncState" ADD CONSTRAINT "SquareScheduleSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareJobColor" ADD CONSTRAINT "SquareJobColor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStoreAssignment" ADD CONSTRAINT "CalendarEventStoreAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStoreAssignment" ADD CONSTRAINT "CalendarEventStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttachment" ADD CONSTRAINT "CalendarEventAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenureMilestone" ADD CONSTRAINT "TenureMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistMilestone" ADD CONSTRAINT "ChecklistMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageSnapshot" ADD CONSTRAINT "WageSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLastRaise" ADD CONSTRAINT "StaffLastRaise_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLastRaise" ADD CONSTRAINT "StaffLastRaise_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSettings" ADD CONSTRAINT "MilestoneSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseTraining" ADD CONSTRAINT "MilestoneRaiseTraining_milestoneSettingsId_fkey" FOREIGN KEY ("milestoneSettingsId") REFERENCES "MilestoneSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseTraining" ADD CONSTRAINT "MilestoneRaiseTraining_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseDocument" ADD CONSTRAINT "MilestoneRaiseDocument_milestoneSettingsId_fkey" FOREIGN KEY ("milestoneSettingsId") REFERENCES "MilestoneSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseDocument" ADD CONSTRAINT "MilestoneRaiseDocument_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- PART 2 — HAND-WRITTEN (DEBT-125 R3). Invisible to `prisma migrate diff`:
-- a regenerated baseline silently omits every object below. Each is copied
-- verbatim from its archived migration. Keep this list in step with
-- docs/MIGRATIONS.md § Protected indexes.
-- ============================================================================

-- Partial unique index.
-- Source: prisma/migrations_archive/20260720000000_labor0_positions_settings_forecast
CREATE UNIQUE INDEX "LaborSettings_org_default_key" ON "LaborSettings"("organizationId") WHERE "storeId" IS NULL;

-- Partial unique index.
-- Source: prisma/migrations_archive/20260729145504_build2_staff_one_primary_store
CREATE UNIQUE INDEX "StoreStaffAssignment_one_primary_key"
  ON "StoreStaffAssignment"("staffMemberId")
  WHERE "isPrimary";

-- Partial unique index.
-- Source: prisma/migrations_archive/20260812171500_doc1a_document_audience_grants
CREATE UNIQUE INDEX "HrDocumentStoreAssignment_staff_grant_key"
  ON "HrDocumentStoreAssignment"("hrDocumentId", "staffMemberId")
  WHERE "granteeType" = 'STAFF';

-- CHECK constraint.
-- Source: prisma/migrations_archive/20260812171500_doc1a_document_audience_grants
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "hrdoc_grant_shape" CHECK (
  ("granteeType" = 'STORE' AND "storeId" IS NOT NULL AND "staffMemberId" IS NULL)
  OR
  ("granteeType" = 'STAFF' AND "staffMemberId" IS NOT NULL AND "storeId" IS NULL)
);

-- CHECK constraint.
-- Source: prisma/migrations_archive/20260824193000_doc3_document_links_and_instructions
ALTER TABLE "HrDocument" ADD CONSTRAINT "hrdoc_link_shape"
  CHECK (("kind" = 'Link') = ("externalUrl" IS NOT NULL));

-- CHECK constraint.
-- Source: prisma/migrations_archive/20261023200000_notify12_recipients
ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_one_target_check"
    CHECK (("userId" IS NULL) <> ("contactId" IS NULL));

-- CHECK constraint.
-- Source: prisma/migrations_archive/20261030200242_l4a_labor_assignment
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_minutes_check"
    CHECK ("startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440);

-- CHECK constraint.
-- Source: prisma/migrations_archive/20261102220000_n1d_proof_only_nutrition
ALTER TABLE "IngredientNutrition" ADD CONSTRAINT "IngredientNutrition_basis_together"
  CHECK (("basisAmount" IS NULL) = ("basisUnit" IS NULL));
