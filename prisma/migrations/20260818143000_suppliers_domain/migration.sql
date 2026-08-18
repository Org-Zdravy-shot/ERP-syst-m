-- Dodávatelia: adresár, ponuky/ceny, nákupné objednávky, príjmy,
-- finančný ledger a vratné obaly. Migrácia je aditívna; existujúce doklady
-- a skladové pohyby ostávajú platné s nullable supplierId.

ALTER TABLE "Invoice" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "Material" ADD COLUMN "targetStock" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "targetStock" DOUBLE PRECISION;
ALTER TABLE "StockMovement" ADD COLUMN "supplierId" TEXT;

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "ico" TEXT,
    "dic" TEXT,
    "icDph" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "source" TEXT NOT NULL DEFAULT 'OTHER',
    "sourceDetail" TEXT,
    "rating" INTEGER,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Supplier_kind_check" CHECK ("kind" IN ('COMPANY', 'PERSON')),
    CONSTRAINT "Supplier_paymentTermsDays_check" CHECK ("paymentTermsDays" >= 0 AND "paymentTermsDays" <= 3650),
    CONSTRAINT "Supplier_currency_check" CHECK ("currency" = 'EUR'),
    CONSTRAINT "Supplier_source_check" CHECK ("source" IN ('REFERRAL', 'WEB', 'FAIR', 'MARKETPLACE', 'EXISTING', 'OTHER')),
    CONSTRAINT "Supplier_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)
);

CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierLocation" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "street" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SK',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "openingHours" TEXT,
    "deliveryInstructions" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierLocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierLocation_type_check" CHECK ("type" IN ('REGISTERED', 'WAREHOUSE', 'PICKUP', 'BILLING', 'OTHER')),
    CONSTRAINT "SupplierLocation_country_check" CHECK (char_length("country") = 2),
    CONSTRAINT "SupplierLocation_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
    CONSTRAINT "SupplierLocation_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
);

CREATE TABLE "SupplierBankAccount" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierBankAccount_currency_check" CHECK ("currency" = 'EUR')
);

CREATE TABLE "SupplierTag" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierCatalogItem" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "materialId" TEXT,
    "productId" TEXT,
    "supplierSku" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "packQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "minOrderQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderMultiple" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "originCountry" TEXT,
    "qualityNote" TEXT,
    "note" TEXT,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierCatalogItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierCatalogItem_single_target_check" CHECK (NOT ("materialId" IS NOT NULL AND "productId" IS NOT NULL)),
    CONSTRAINT "SupplierCatalogItem_packQuantity_check" CHECK ("packQuantity" > 0),
    CONSTRAINT "SupplierCatalogItem_minOrderQuantity_check" CHECK ("minOrderQuantity" >= 0),
    CONSTRAINT "SupplierCatalogItem_orderMultiple_check" CHECK ("orderMultiple" > 0),
    CONSTRAINT "SupplierCatalogItem_leadTimeDays_check" CHECK ("leadTimeDays" >= 0 AND "leadTimeDays" <= 3650),
    CONSTRAINT "SupplierCatalogItem_originCountry_check" CHECK ("originCountry" IS NULL OR char_length("originCountry") = 2)
);

CREATE TABLE "SupplierPrice" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "pricePerQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "minimumQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priceType" TEXT NOT NULL DEFAULT 'NET',
    "vatRate" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierPrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierPrice_unitPriceCents_check" CHECK ("unitPriceCents" >= 0),
    CONSTRAINT "SupplierPrice_pricePerQuantity_check" CHECK ("pricePerQuantity" > 0),
    CONSTRAINT "SupplierPrice_minimumQuantity_check" CHECK ("minimumQuantity" >= 0),
    CONSTRAINT "SupplierPrice_currency_check" CHECK ("currency" = 'EUR'),
    CONSTRAINT "SupplierPrice_priceType_check" CHECK ("priceType" IN ('NET', 'GROSS')),
    CONSTRAINT "SupplierPrice_vatRate_check" CHECK ("vatRate" IS NULL OR "vatRate" BETWEEN 0 AND 100),
    CONSTRAINT "SupplierPrice_validity_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE TABLE "SupplierOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedDeliveryDate" TIMESTAMP(3),
    "confirmedDeliveryDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "supplierSnapshot" JSONB,
    "deliveryLocationSnapshot" JSONB,
    "note" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierOrder_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT "SupplierOrder_currency_check" CHECK ("currency" = 'EUR'),
    CONSTRAINT "SupplierOrder_shippingCents_check" CHECK ("shippingCents" >= 0),
    CONSTRAINT "SupplierOrder_discountCents_check" CHECK ("discountCents" >= 0)
);

CREATE TABLE "SupplierOrderItem" (
    "id" TEXT NOT NULL,
    "supplierOrderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "materialId" TEXT,
    "productId" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "supplierSku" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "priceType" TEXT NOT NULL DEFAULT 'NET',
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierOrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierOrderItem_single_target_check" CHECK (NOT ("materialId" IS NOT NULL AND "productId" IS NOT NULL)),
    CONSTRAINT "SupplierOrderItem_lineNumber_check" CHECK ("lineNumber" > 0),
    CONSTRAINT "SupplierOrderItem_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "SupplierOrderItem_unitPriceCents_check" CHECK ("unitPriceCents" >= 0),
    CONSTRAINT "SupplierOrderItem_priceType_check" CHECK ("priceType" IN ('NET', 'GROSS')),
    CONSTRAINT "SupplierOrderItem_vatRate_check" CHECK ("vatRate" BETWEEN 0 AND 100)
);

CREATE TABLE "SupplierDelivery" (
    "id" TEXT NOT NULL,
    "supplierOrderId" TEXT NOT NULL,
    "deliveryNoteNumber" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierDeliveryItem" (
    "id" TEXT NOT NULL,
    "supplierDeliveryId" TEXT NOT NULL,
    "supplierOrderItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "stockMovementId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierDeliveryItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierDeliveryItem_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "SupplierReturnableType" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ks',
    "owner" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "depositCents" INTEGER,
    "expectedReturnDays" INTEGER,
    "reminderNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierReturnableType_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierReturnableType_owner_check" CHECK ("owner" IN ('SUPPLIER', 'COMPANY')),
    CONSTRAINT "SupplierReturnableType_depositCents_check" CHECK ("depositCents" IS NULL OR "depositCents" >= 0),
    CONSTRAINT "SupplierReturnableType_expectedReturnDays_check" CHECK ("expectedReturnDays" IS NULL OR ("expectedReturnDays" > 0 AND "expectedReturnDays" <= 3650))
);

CREATE TABLE "SupplierReturnableMovement" (
    "id" TEXT NOT NULL,
    "returnableTypeId" TEXT NOT NULL,
    "supplierDeliveryId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierReturnableMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierReturnableMovement_quantity_check" CHECK ("quantity" <> 0)
);

CREATE TABLE "SupplierAccountEntry" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierAccountEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierAccountEntry_type_check" CHECK ("type" IN ('OPENING_BALANCE', 'DEPOSIT', 'CREDIT', 'ADJUSTMENT', 'OTHER')),
    CONSTRAINT "SupplierAccountEntry_amountCents_check" CHECK ("amountCents" <> 0)
);

ALTER TABLE "Material" ADD CONSTRAINT "Material_targetStock_check" CHECK ("targetStock" IS NULL OR "targetStock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_targetStock_check" CHECK ("targetStock" IS NULL OR "targetStock" >= 0);

CREATE UNIQUE INDEX "Supplier_ico_key" ON "Supplier"("ico");
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");
CREATE INDEX "Supplier_source_isActive_idx" ON "Supplier"("source", "isActive");
CREATE INDEX "SupplierContact_supplierId_isPrimary_idx" ON "SupplierContact"("supplierId", "isPrimary");
CREATE INDEX "SupplierLocation_supplierId_type_idx" ON "SupplierLocation"("supplierId", "type");
CREATE INDEX "SupplierLocation_city_idx" ON "SupplierLocation"("city");
CREATE INDEX "SupplierBankAccount_iban_idx" ON "SupplierBankAccount"("iban");
CREATE UNIQUE INDEX "SupplierBankAccount_supplierId_iban_key" ON "SupplierBankAccount"("supplierId", "iban");
CREATE INDEX "SupplierTag_name_idx" ON "SupplierTag"("name");
CREATE UNIQUE INDEX "SupplierTag_supplierId_name_key" ON "SupplierTag"("supplierId", "name");
CREATE INDEX "SupplierCatalogItem_supplierId_isActive_idx" ON "SupplierCatalogItem"("supplierId", "isActive");
CREATE INDEX "SupplierCatalogItem_materialId_isPreferred_idx" ON "SupplierCatalogItem"("materialId", "isPreferred");
CREATE INDEX "SupplierCatalogItem_productId_isPreferred_idx" ON "SupplierCatalogItem"("productId", "isPreferred");
CREATE INDEX "SupplierPrice_catalogItemId_validFrom_validTo_idx" ON "SupplierPrice"("catalogItemId", "validFrom", "validTo");
CREATE UNIQUE INDEX "SupplierPrice_catalogItemId_validFrom_minimumQuantity_key" ON "SupplierPrice"("catalogItemId", "validFrom", "minimumQuantity");
CREATE UNIQUE INDEX "SupplierOrder_orderNumber_key" ON "SupplierOrder"("orderNumber");
CREATE INDEX "SupplierOrder_supplierId_orderDate_idx" ON "SupplierOrder"("supplierId", "orderDate");
CREATE INDEX "SupplierOrder_status_requestedDeliveryDate_idx" ON "SupplierOrder"("status", "requestedDeliveryDate");
CREATE INDEX "SupplierOrderItem_materialId_idx" ON "SupplierOrderItem"("materialId");
CREATE INDEX "SupplierOrderItem_productId_idx" ON "SupplierOrderItem"("productId");
CREATE UNIQUE INDEX "SupplierOrderItem_supplierOrderId_lineNumber_key" ON "SupplierOrderItem"("supplierOrderId", "lineNumber");
CREATE UNIQUE INDEX "SupplierDelivery_idempotencyKey_key" ON "SupplierDelivery"("idempotencyKey");
CREATE INDEX "SupplierDelivery_supplierOrderId_receivedAt_idx" ON "SupplierDelivery"("supplierOrderId", "receivedAt");
CREATE UNIQUE INDEX "SupplierDeliveryItem_stockMovementId_key" ON "SupplierDeliveryItem"("stockMovementId");
CREATE INDEX "SupplierDeliveryItem_supplierOrderItemId_idx" ON "SupplierDeliveryItem"("supplierOrderItemId");
CREATE UNIQUE INDEX "SupplierDeliveryItem_supplierDeliveryId_supplierOrderItemId_key" ON "SupplierDeliveryItem"("supplierDeliveryId", "supplierOrderItemId");
CREATE INDEX "SupplierReturnableType_supplierId_isActive_idx" ON "SupplierReturnableType"("supplierId", "isActive");
CREATE UNIQUE INDEX "SupplierReturnableType_supplierId_name_key" ON "SupplierReturnableType"("supplierId", "name");
CREATE INDEX "SupplierReturnableMovement_returnableTypeId_occurredAt_idx" ON "SupplierReturnableMovement"("returnableTypeId", "occurredAt");
CREATE INDEX "SupplierReturnableMovement_dueDate_idx" ON "SupplierReturnableMovement"("dueDate");
CREATE INDEX "SupplierAccountEntry_supplierId_occurredAt_idx" ON "SupplierAccountEntry"("supplierId", "occurredAt");
CREATE INDEX "SupplierAccountEntry_dueDate_idx" ON "SupplierAccountEntry"("dueDate");
CREATE INDEX "Invoice_supplierId_issueDate_idx" ON "Invoice"("supplierId", "issueDate");
CREATE INDEX "StockMovement_supplierId_createdAt_idx" ON "StockMovement"("supplierId", "createdAt");

ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierLocation" ADD CONSTRAINT "SupplierLocation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierTag" ADD CONSTRAINT "SupplierTag_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierDelivery" ADD CONSTRAINT "SupplierDelivery_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierDeliveryItem" ADD CONSTRAINT "SupplierDeliveryItem_supplierDeliveryId_fkey" FOREIGN KEY ("supplierDeliveryId") REFERENCES "SupplierDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierDeliveryItem" ADD CONSTRAINT "SupplierDeliveryItem_supplierOrderItemId_fkey" FOREIGN KEY ("supplierOrderItemId") REFERENCES "SupplierOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierDeliveryItem" ADD CONSTRAINT "SupplierDeliveryItem_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnableType" ADD CONSTRAINT "SupplierReturnableType_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnableMovement" ADD CONSTRAINT "SupplierReturnableMovement_returnableTypeId_fkey" FOREIGN KEY ("returnableTypeId") REFERENCES "SupplierReturnableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnableMovement" ADD CONSTRAINT "SupplierReturnableMovement_supplierDeliveryId_fkey" FOREIGN KEY ("supplierDeliveryId") REFERENCES "SupplierDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierAccountEntry" ADD CONSTRAINT "SupplierAccountEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
