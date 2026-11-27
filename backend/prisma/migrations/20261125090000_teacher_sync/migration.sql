-- AlterTable
ALTER TABLE "User" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "sourceRows" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "reactivated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "problems" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaVersion" (
    "version" INTEGER NOT NULL,
    "note" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaVersion_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");


-- Database script version (checked by the backend at startup).
INSERT INTO "SchemaVersion" ("version", "note") VALUES (1, 'Initial release: schedules, sick leave, teacher sync');
