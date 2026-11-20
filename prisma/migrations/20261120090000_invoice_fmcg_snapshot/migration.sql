-- Additive: legacy invoices retain NULL; no live product data is backfilled.
ALTER TABLE "InvoiceItem" ADD COLUMN "fmcgSnapshot" JSONB;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_fmcgSnapshot_object"
  CHECK ("fmcgSnapshot" IS NULL OR jsonb_typeof("fmcgSnapshot") = 'object');
