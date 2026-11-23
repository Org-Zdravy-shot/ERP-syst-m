-- CreateTable
CREATE TABLE "RecurringInvoiceSchedule" (
    "id" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "nextDate" TIMESTAMP(3),
    "intervalMonths" INTEGER NOT NULL,
    "dueDays" INTEGER NOT NULL,
    "maxCount" INTEGER,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringInvoiceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceRun" (
    "scheduleId" TEXT NOT NULL,
    "occurrence" TIMESTAMP(3) NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringInvoiceRun_pkey" PRIMARY KEY ("scheduleId","occurrence")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoiceSchedule_submissionKey_key" ON "RecurringInvoiceSchedule"("submissionKey");

-- CreateIndex
CREATE INDEX "RecurringInvoiceSchedule_paused_nextDate_idx" ON "RecurringInvoiceSchedule"("paused", "nextDate");

-- CreateIndex
CREATE INDEX "RecurringInvoiceSchedule_sourceInvoiceId_idx" ON "RecurringInvoiceSchedule"("sourceInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoiceRun_invoiceId_key" ON "RecurringInvoiceRun"("invoiceId");

-- AddForeignKey
ALTER TABLE "RecurringInvoiceSchedule" ADD CONSTRAINT "RecurringInvoiceSchedule_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RecurringInvoiceSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
