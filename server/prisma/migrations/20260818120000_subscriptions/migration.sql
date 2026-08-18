-- CreateTable: recurring subscriptions (auto-generate a Bill each cycle).
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "chartAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "cadence" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "startDate" TEXT NOT NULL,
    "nextRunDate" TEXT NOT NULL,
    "endDate" TEXT,
    "dueDays" INTEGER NOT NULL DEFAULT 0,
    "autoIssue" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'aktif',
    "businessUnitId" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_nextRunDate_idx" ON "Subscription"("nextRunDate");

CREATE TABLE "SubscriptionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "cycleDate" TEXT NOT NULL,
    "billId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionRun_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionRun_subscriptionId_cycleDate_key" ON "SubscriptionRun"("subscriptionId", "cycleDate");
CREATE INDEX "SubscriptionRun_subscriptionId_idx" ON "SubscriptionRun"("subscriptionId");
