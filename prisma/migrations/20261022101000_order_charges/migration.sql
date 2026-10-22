CREATE TABLE "OrderCharge" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderCharge_kind_check" CHECK ("kind" IN ('SHIPPING', 'FEE')),
    CONSTRAINT "OrderCharge_amount_check" CHECK ("unitPriceCents" >= 0 AND "vatRate" BETWEEN 0 AND 100)
);

CREATE INDEX "OrderCharge_orderId_idx" ON "OrderCharge"("orderId");
ALTER TABLE "OrderCharge" ADD CONSTRAINT "OrderCharge_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
