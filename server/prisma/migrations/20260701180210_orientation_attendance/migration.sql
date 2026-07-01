-- CreateTable
CREATE TABLE "OrientationAttendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkIn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'present',
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeHours" REAL NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OrientationAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OrientationAttendance_employeeId_idx" ON "OrientationAttendance"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrientationAttendance_employeeId_date_key" ON "OrientationAttendance"("employeeId", "date");
