-- AlterTable
ALTER TABLE "UserPhoto" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'UPLOAD',
ADD COLUMN     "sourceHash" TEXT;


-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "photos" INTEGER NOT NULL DEFAULT 0;

-- Database script version (checked by the backend at startup).
INSERT INTO "SchemaVersion" ("version", "note") VALUES (2, 'Profile photos imported from HR');
