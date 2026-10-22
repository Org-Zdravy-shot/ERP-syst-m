CREATE TABLE "ClientPriceRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "unitPriceCents" INTEGER,
    "discountBps" INTEGER,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientPriceRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClientPriceRule_version_check" CHECK ("version" > 0),
    CONSTRAINT "ClientPriceRule_kind_check" CHECK (
        ("kind" = 'FIXED' AND "unitPriceCents" IS NOT NULL AND "unitPriceCents" >= 0 AND "discountBps" IS NULL)
        OR ("kind" = 'DISCOUNT' AND "unitPriceCents" IS NULL AND "discountBps" BETWEEN 0 AND 10000)
        OR ("kind" = 'DEFAULT' AND "unitPriceCents" IS NULL AND "discountBps" IS NULL)
    )
);

CREATE UNIQUE INDEX "ClientPriceRule_clientId_productId_version_key"
    ON "ClientPriceRule"("clientId", "productId", "version");
CREATE INDEX "ClientPriceRule_clientId_productId_effectiveFrom_version_idx"
    ON "ClientPriceRule"("clientId", "productId", "effectiveFrom", "version");

ALTER TABLE "ClientPriceRule" ADD CONSTRAINT "ClientPriceRule_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientPriceRule" ADD CONSTRAINT "ClientPriceRule_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
