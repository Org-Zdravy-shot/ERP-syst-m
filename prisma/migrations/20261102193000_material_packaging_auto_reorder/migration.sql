ALTER TABLE "Material" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INGREDIENT';
ALTER TABLE "Material" ADD COLUMN "autoReorder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Material" ADD COLUMN "autoOrderLegalEntity" TEXT;
ALTER TABLE "SupplierOrder" ADD COLUMN "legalEntity" TEXT;

CREATE INDEX "Material_kind_isActive_idx" ON "Material"("kind", "isActive");
CREATE INDEX "Material_autoReorder_isActive_idx" ON "Material"("autoReorder", "isActive");
