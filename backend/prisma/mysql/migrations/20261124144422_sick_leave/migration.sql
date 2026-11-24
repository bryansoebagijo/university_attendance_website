-- AlterTable
ALTER TABLE `LeaveRequest` ADD COLUMN `type` ENUM('ANNUAL', 'SICK') NOT NULL DEFAULT 'ANNUAL';

-- CreateTable
CREATE TABLE `LeaveAttachment` (
    `requestId` VARCHAR(191) NOT NULL,
    `data` LONGBLOB NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LeaveAttachment` ADD CONSTRAINT `LeaveAttachment_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `LeaveRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

