ALTER TABLE "Product" ALTER COLUMN "shelfLifeDays" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "shelfLifeDays" DROP DEFAULT;

ALTER TABLE "Order" ADD COLUMN "latestDeliveryDate" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "deliveryStreet" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryCity" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryZip" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryCountry" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryContact" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Order" ADD COLUMN "paymentTermDays" INTEGER;
ALTER TABLE "Order" ADD COLUMN "submissionKey" TEXT;
CREATE UNIQUE INDEX "Order_submissionKey_key" ON "Order"("submissionKey");

ALTER TABLE "OrderItem" ADD COLUMN "unitPriceExact" DECIMAL(18,4);
ALTER TABLE "OrderItem" ADD COLUMN "priceSource" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "minimumExpiryDate" TIMESTAMP(3);
ALTER TABLE "InvoiceItem" ADD COLUMN "unitPriceExact" DECIMAL(18,4);
