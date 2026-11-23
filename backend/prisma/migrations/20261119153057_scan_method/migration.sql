-- CreateEnum
CREATE TYPE "ScanMethod" AS ENUM ('CAMERA', 'UPLOAD');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "inMethod" "ScanMethod" NOT NULL DEFAULT 'CAMERA',
ADD COLUMN     "outMethod" "ScanMethod";
