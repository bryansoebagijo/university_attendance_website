-- AlterTable
ALTER TABLE `SyncRun` ADD COLUMN `photos` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `UserPhoto` ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'UPLOAD',
    ADD COLUMN `sourceHash` VARCHAR(191) NULL;


-- Database script version (checked by the backend at startup).
INSERT INTO `SchemaVersion` (`version`, `note`) VALUES (2, 'Profile photos imported from HR');
