CREATE TABLE "PeriodPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "targetTurnoverGrossCents" INTEGER NOT NULL DEFAULT 0,
    "targetRevenueNetCents" INTEGER NOT NULL DEFAULT 0,
    "targetCostsNetCents" INTEGER NOT NULL DEFAULT 0,
    "targetCashInCents" INTEGER NOT NULL DEFAULT 0,
    "targetCashOutCents" INTEGER NOT NULL DEFAULT 0,
    "targetProductionUnits" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PeriodPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PeriodPlan_dates_check" CHECK ("startDate" <= "endDate"),
    CONSTRAINT "PeriodPlan_targets_check" CHECK (
      "targetTurnoverGrossCents" >= 0 AND "targetRevenueNetCents" >= 0 AND
      "targetCostsNetCents" >= 0 AND "targetCashInCents" >= 0 AND
      "targetCashOutCents" >= 0 AND "targetProductionUnits" >= 0
    )
);

CREATE INDEX "PeriodPlan_startDate_endDate_idx" ON "PeriodPlan"("startDate", "endDate");
