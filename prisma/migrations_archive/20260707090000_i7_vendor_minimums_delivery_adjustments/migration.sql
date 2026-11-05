-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "deliveryDays" JSONB,
ADD COLUMN     "minOrderCases" DOUBLE PRECISION,
ADD COLUMN     "minOrderDollars" DOUBLE PRECISION;

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

-- AddForeignKey
ALTER TABLE "VendorAdjustment" ADD CONSTRAINT "VendorAdjustment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAdjustment" ADD CONSTRAINT "PurchaseOrderAdjustment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAdjustment" ADD CONSTRAINT "PurchaseOrderAdjustment_vendorAdjustmentId_fkey" FOREIGN KEY ("vendorAdjustmentId") REFERENCES "VendorAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
