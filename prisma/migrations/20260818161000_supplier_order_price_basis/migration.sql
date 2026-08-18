-- Objednávka musí uchovať aj cenovú jednotku (napr. 90 EUR / 30 kg),
-- inak by sa historická suma po zmene ponuky nedala reprodukovať.
ALTER TABLE "SupplierOrderItem"
ADD COLUMN "pricePerQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- Nakupovaný hotový produkt potrebuje rovnaký údaj o poslednej nákupnej cene
-- ako surovina. Hodnota je normalizovaná na jednu skladovú jednotku.
ALTER TABLE "Product"
ADD COLUMN "lastPurchasePriceCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SupplierOrderItem"
ADD CONSTRAINT "SupplierOrderItem_pricePerQuantity_positive"
CHECK ("pricePerQuantity" > 0);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_lastPurchasePriceCents_nonnegative"
CHECK ("lastPurchasePriceCents" >= 0);
