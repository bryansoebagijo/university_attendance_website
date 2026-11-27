-- AlterTable
ALTER TABLE `User` ADD COLUMN `externalId` VARCHAR(191) NULL,
    ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
    MODIFY `email` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `SyncRun` (
    `id` VARCHAR(191) NOT NULL,
    `trigger` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL,
    `sourceRows` INTEGER NOT NULL DEFAULT 0,
    `added` INTEGER NOT NULL DEFAULT 0,
    `updated` INTEGER NOT NULL DEFAULT 0,
    `deactivated` INTEGER NOT NULL DEFAULT 0,
    `reactivated` INTEGER NOT NULL DEFAULT 0,
    `skipped` INTEGER NOT NULL DEFAULT 0,
    `message` TEXT NULL,
    `problems` JSON NULL,

    INDEX `SyncRun_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchemaVersion` (
    `version` INTEGER NOT NULL,
    `note` VARCHAR(191) NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_externalId_key` ON `User`(`externalId`);


-- Database script version (checked by the backend at startup).
INSERT INTO `SchemaVersion` (`version`, `note`) VALUES (1, 'Initial release: schedules, sick leave, teacher sync');
