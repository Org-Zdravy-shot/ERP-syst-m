-- No backfill: internal ERP order numbers are not references supplied by the buyer.
ALTER TABLE "Invoice" ADD COLUMN "buyerReference" TEXT;
