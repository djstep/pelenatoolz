-- CreateTable
CREATE TABLE "CashPayment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "taxPercent" DECIMAL(5,2),
    "taxAmount" DECIMAL(14,2),
    "amountWithTax" DECIMAL(14,2) NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashPaymentBreakdown" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "comment" TEXT,
    "sortOrder" INT NOT NULL DEFAULT 0,

    CONSTRAINT "CashPaymentBreakdown_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashPayment_projectId_date_idx" ON "CashPayment"("projectId", "date");
CREATE INDEX "CashPayment_projectId_counterpartyId_idx" ON "CashPayment"("projectId", "counterpartyId");
CREATE INDEX "CashPayment_projectId_companyId_idx" ON "CashPayment"("projectId", "companyId");
CREATE INDEX "CashPayment_projectId_isLocked_idx" ON "CashPayment"("projectId", "isLocked");
CREATE INDEX "CashPaymentBreakdown_paymentId_sortOrder_idx" ON "CashPaymentBreakdown"("paymentId", "sortOrder");
CREATE INDEX "CashPaymentBreakdown_budgetLineId_idx" ON "CashPaymentBreakdown"("budgetLineId");

ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashPaymentBreakdown" ADD CONSTRAINT "CashPaymentBreakdown_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CashPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashPaymentBreakdown" ADD CONSTRAINT "CashPaymentBreakdown_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
