-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employeeId" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CalendarEvent_employeeId_idx" ON "CalendarEvent"("employeeId");

-- CreateIndex
CREATE INDEX "CalendarEvent_startDate_idx" ON "CalendarEvent"("startDate");
