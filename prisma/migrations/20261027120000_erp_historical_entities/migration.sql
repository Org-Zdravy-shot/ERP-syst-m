-- Aditívna migrácia: staré objednávky, doklady a profily zostávajú nepriradené.
ALTER TABLE "CompanyProfile" ADD COLUMN "legalEntity" TEXT;
CREATE INDEX "CompanyProfile_legalEntity_validFrom_validTo_idx" ON "CompanyProfile"("legalEntity", "validFrom", "validTo");

ALTER TABLE "Product" ADD COLUMN "shelfLifeConfirmedAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD COLUMN "legalEntity" TEXT;
ALTER TABLE "Order" ADD COLUMN "platformPaymentStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPaidAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "platformSettledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "platformSettlementCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN "platformCommissionCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN "shipmentStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "deliveredAt" TIMESTAMP(3);

ALTER TABLE "OrderCharge" ADD COLUMN "recipient" TEXT NOT NULL DEFAULT 'SELLER';
ALTER TABLE "OrderCharge" ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "OrderCharge" ADD COLUMN "includedInSellerTotal" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Invoice" ADD COLUMN "legalEntity" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "historicalKind" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "taxCountry" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "foreignVatRateBps" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "taxCurrency" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "taxBaseMinor" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "taxAmountMinor" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "taxTotalMinor" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "paymentConfirmation" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "externallyPaidAt" TIMESTAMP(3);
CREATE INDEX "Invoice_legalEntity_direction_issueDate_idx" ON "Invoice"("legalEntity", "direction", "issueDate");
CREATE INDEX "Invoice_supplierName_externalNumber_idx" ON "Invoice"("supplierName", "externalNumber");
