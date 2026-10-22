ALTER TABLE "EkasaSale" ADD COLUMN "matchedInvoiceId" TEXT;
CREATE INDEX "EkasaSale_matchedInvoiceId_idx" ON "EkasaSale"("matchedInvoiceId");
ALTER TABLE "EkasaSale" ADD CONSTRAINT "EkasaSale_matchedInvoiceId_fkey"
    FOREIGN KEY ("matchedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
