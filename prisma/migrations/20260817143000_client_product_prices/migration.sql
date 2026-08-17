-- B2B ceny sa líšia podľa odberateľa. Globálna cena produktu ostáva len
-- voliteľným fallbackom pre staršie dáta.
ALTER TABLE "Product" ALTER COLUMN "priceB2bCents" DROP NOT NULL;

CREATE TABLE "ClientProductPrice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProductPrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClientProductPrice_unitPriceCents_check" CHECK ("unitPriceCents" >= 0)
);

CREATE UNIQUE INDEX "ClientProductPrice_clientId_productId_key"
    ON "ClientProductPrice"("clientId", "productId");
CREATE INDEX "ClientProductPrice_productId_idx"
    ON "ClientProductPrice"("productId");

ALTER TABLE "ClientProductPrice"
    ADD CONSTRAINT "ClientProductPrice_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientProductPrice"
    ADD CONSTRAINT "ClientProductPrice_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
