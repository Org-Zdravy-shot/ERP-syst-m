-- CreateTable
CREATE TABLE "christmas_campaign" (
    "id" TEXT NOT NULL,
    "legalEntity" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "christmas_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_campaign_settings" (
    "campaignId" TEXT NOT NULL,
    "thresholdMode" TEXT NOT NULL DEFAULT 'TOTAL_SHOTS',
    "outputVatRate" DECIMAL(8,4) NOT NULL,
    "splitRate" DECIMAL(8,4) NOT NULL,
    "sweetenedDrinkTaxStatus" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "christmas_campaign_settings_pkey" PRIMARY KEY ("campaignId")
);

-- CreateTable
CREATE TABLE "christmas_pricing_version" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_pricing_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_cost_version" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_cost_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_recipe_version" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_recipe_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_order" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "legalEntity" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "submissionKey" TEXT,
    "clientId" TEXT NOT NULL,
    "contactName" TEXT,
    "deliveryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "origin" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "invoiceReference" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "christmas_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_order_item" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "listUnitNet" DECIMAL(18,4),
    "unitNet" DECIMAL(18,4),
    "priceReason" TEXT,
    "vatRate" DECIMAL(8,4) NOT NULL,

    CONSTRAINT "christmas_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_order_package" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "contents" JSONB NOT NULL,
    "brandingDescription" TEXT,
    "unitMaterialCost" DECIMAL(18,4),
    "materialVatRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "materialVatDeductible" BOOLEAN NOT NULL DEFAULT false,
    "unitBrandingCost" DECIMAL(18,4),
    "unitLaborCost" DECIMAL(18,4),
    "unitWasteCost" DECIMAL(18,4),
    "unitRevenueNet" DECIMAL(18,4),
    "vatRate" DECIMAL(8,4) NOT NULL,
    "costsConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "christmas_order_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_order_extra_cost" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPurchasePrice" DECIMAL(18,4),
    "vatRate" DECIMAL(8,4) NOT NULL,
    "vatDeductible" BOOLEAN NOT NULL DEFAULT false,
    "includeInProfit" BOOLEAN NOT NULL DEFAULT true,
    "confirmedNoCost" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "christmas_order_extra_cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_order_revenue" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitNet" DECIMAL(18,4) NOT NULL,
    "vatRate" DECIMAL(8,4) NOT NULL,

    CONSTRAINT "christmas_order_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_lead_attribution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "source" TEXT,
    "sourceCampaign" TEXT,
    "crmReference" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "christmas_lead_attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_calculation_snapshot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "pricingVersionId" TEXT NOT NULL,
    "costVersionId" TEXT NOT NULL,
    "recipeVersionId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "configuration" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "revenueNetCents" INTEGER NOT NULL,
    "revenueGrossCents" INTEGER NOT NULL,
    "directCostCents" INTEGER NOT NULL,
    "overheadCents" INTEGER NOT NULL,
    "otherCostCents" INTEGER NOT NULL,
    "divisibleProfitCents" INTEGER NOT NULL,
    "agencyShareCents" INTEGER NOT NULL,
    "companyShareCents" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_calculation_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_ad_expense" (
    "id" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orderId" TEXT,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "vatRate" DECIMAL(8,4) NOT NULL,
    "vatDeductible" BOOLEAN NOT NULL DEFAULT false,
    "supplier" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_ad_expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_settlement" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "includedOrders" JSONB NOT NULL,
    "totalAgencyCents" INTEGER NOT NULL,
    "totalCompanyCents" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "christmas_audit_log" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orderId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "christmas_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "christmas_campaign_legalEntity_year_idx" ON "christmas_campaign"("legalEntity", "year");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_campaign_legalEntity_year_name_key" ON "christmas_campaign"("legalEntity", "year", "name");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_campaign_id_legalEntity_key" ON "christmas_campaign"("id", "legalEntity");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_pricing_version_campaignId_version_key" ON "christmas_pricing_version"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_pricing_version_id_campaignId_key" ON "christmas_pricing_version"("id", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_cost_version_campaignId_version_key" ON "christmas_cost_version"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_cost_version_id_campaignId_key" ON "christmas_cost_version"("id", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_recipe_version_campaignId_version_key" ON "christmas_recipe_version"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_recipe_version_id_campaignId_key" ON "christmas_recipe_version"("id", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_order_submissionKey_key" ON "christmas_order"("submissionKey");

-- CreateIndex
CREATE INDEX "christmas_order_campaignId_status_origin_idx" ON "christmas_order"("campaignId", "status", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_order_campaignId_number_key" ON "christmas_order"("campaignId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_order_id_campaignId_key" ON "christmas_order"("id", "campaignId");

-- CreateIndex
CREATE INDEX "christmas_order_item_orderId_idx" ON "christmas_order_item"("orderId");

-- CreateIndex
CREATE INDEX "christmas_order_package_orderId_idx" ON "christmas_order_package"("orderId");

-- CreateIndex
CREATE INDEX "christmas_order_extra_cost_orderId_idx" ON "christmas_order_extra_cost"("orderId");

-- CreateIndex
CREATE INDEX "christmas_order_revenue_orderId_idx" ON "christmas_order_revenue"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_lead_attribution_orderId_campaignId_key" ON "christmas_lead_attribution"("orderId", "campaignId");

-- CreateIndex
CREATE INDEX "christmas_calculation_snapshot_campaignId_createdAt_idx" ON "christmas_calculation_snapshot"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_calculation_snapshot_orderId_revision_key" ON "christmas_calculation_snapshot"("orderId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_ad_expense_submissionKey_key" ON "christmas_ad_expense"("submissionKey");

-- CreateIndex
CREATE INDEX "christmas_ad_expense_campaignId_spentAt_idx" ON "christmas_ad_expense"("campaignId", "spentAt");

-- CreateIndex
CREATE UNIQUE INDEX "christmas_settlement_campaignId_key" ON "christmas_settlement"("campaignId");

-- CreateIndex
CREATE INDEX "christmas_audit_log_campaignId_orderId_createdAt_idx" ON "christmas_audit_log"("campaignId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "christmas_campaign_settings" ADD CONSTRAINT "christmas_campaign_settings_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_pricing_version" ADD CONSTRAINT "christmas_pricing_version_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_cost_version" ADD CONSTRAINT "christmas_cost_version_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_recipe_version" ADD CONSTRAINT "christmas_recipe_version_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_order" ADD CONSTRAINT "christmas_order_campaignId_legalEntity_fkey" FOREIGN KEY ("campaignId", "legalEntity") REFERENCES "christmas_campaign"("id", "legalEntity") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_order" ADD CONSTRAINT "christmas_order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_order_item" ADD CONSTRAINT "christmas_order_item_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_order_package" ADD CONSTRAINT "christmas_order_package_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_order_extra_cost" ADD CONSTRAINT "christmas_order_extra_cost_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_order_revenue" ADD CONSTRAINT "christmas_order_revenue_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_lead_attribution" ADD CONSTRAINT "christmas_lead_attribution_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_calculation_snapshot" ADD CONSTRAINT "christmas_calculation_snapshot_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_calculation_snapshot" ADD CONSTRAINT "christmas_calculation_snapshot_pricingVersionId_campaignId_fkey" FOREIGN KEY ("pricingVersionId", "campaignId") REFERENCES "christmas_pricing_version"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_calculation_snapshot" ADD CONSTRAINT "christmas_calculation_snapshot_costVersionId_campaignId_fkey" FOREIGN KEY ("costVersionId", "campaignId") REFERENCES "christmas_cost_version"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_calculation_snapshot" ADD CONSTRAINT "christmas_calculation_snapshot_recipeVersionId_campaignId_fkey" FOREIGN KEY ("recipeVersionId", "campaignId") REFERENCES "christmas_recipe_version"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_ad_expense" ADD CONSTRAINT "christmas_ad_expense_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_ad_expense" ADD CONSTRAINT "christmas_ad_expense_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_settlement" ADD CONSTRAINT "christmas_settlement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_audit_log" ADD CONSTRAINT "christmas_audit_log_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "christmas_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "christmas_audit_log" ADD CONSTRAINT "christmas_audit_log_orderId_campaignId_fkey" FOREIGN KEY ("orderId", "campaignId") REFERENCES "christmas_order"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

