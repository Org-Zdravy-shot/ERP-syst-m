-- VRP2 extended reports contain one row per receipt item. The former unique
-- constraint on receipt+date incorrectly dropped every second item.
DROP INDEX IF EXISTS "EkasaSale_receiptNumber_saleDate_key";

ALTER TABLE "EkasaSale"
    ADD COLUMN "productCode" TEXT,
    ADD COLUMN "ean" TEXT,
    ADD COLUMN "itemType" TEXT,
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN "sourceKey" TEXT,
    ALTER COLUMN "vatRate" DROP DEFAULT,
    ALTER COLUMN "vatRate" DROP NOT NULL;

CREATE UNIQUE INDEX "EkasaSale_sourceKey_key" ON "EkasaSale"("sourceKey");
CREATE INDEX "EkasaSale_receiptNumber_saleDate_idx" ON "EkasaSale"("receiptNumber", "saleDate");
CREATE INDEX "EkasaSale_source_saleDate_idx" ON "EkasaSale"("source", "saleDate");
