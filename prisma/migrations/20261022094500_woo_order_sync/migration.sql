CREATE TABLE "WooOrderSync" (
    "id" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderId" TEXT,
    "lastModifiedAt" TIMESTAMP(3),
    "lastPayloadHash" TEXT,
    "state" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "issue" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WooOrderSync_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WooOrderSync_state_check" CHECK ("state" IN ('IMPORTED', 'NEEDS_REVIEW', 'IGNORED'))
);

CREATE UNIQUE INDEX "WooOrderSync_externalOrderId_key" ON "WooOrderSync"("externalOrderId");
CREATE UNIQUE INDEX "WooOrderSync_orderId_key" ON "WooOrderSync"("orderId");

ALTER TABLE "WooOrderSync" ADD CONSTRAINT "WooOrderSync_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
