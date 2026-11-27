-- =============================================================================================
-- ISTA Presensi — read-only access to the campus HR table (MariaDB 10.3+ / 12.x, MySQL 8)
-- =============================================================================================
-- The app keeps all its own data in its own PostgreSQL (inside Docker). From the campus database it
-- only READS staff data from hr_staff_info. This script creates that read-only user. Nothing else in
-- the campus database is created or changed.
--
-- Run once as root (or another admin account):
--   mysql -u root -p < hr_read_access.sql
--
-- BEFORE RUNNING, edit:
--   (1) the password            → also write it into /opt/ista-absen/config/hr_db_password on the app server
--   (2) which hosts may connect → '%' any host; '172.%' only Docker on this same machine;
--                                 '10.0.0.15' only the app server's IP (use the same value in both lines)
--   (3) NAMA_DATABASE_HR        → the database that holds hr_staff_info. Find it with:
--       SELECT table_schema FROM information_schema.tables WHERE table_name = 'hr_staff_info';
-- =============================================================================================

CREATE USER IF NOT EXISTS 'ista_absen_reader'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

-- Exactly these columns, read-only:
--   FID = link to the app account · NIK = login ID · Nama · DEPT_NAME = unit
--   tgL_Keluar = exit date (filled in → the account is deactivated) · PHOTO = profile picture
-- Fingerprints (SidikJari…), faces (Wajah…), cards, machine passwords etc. are NOT granted:
-- the app cannot read them, not even by mistake.
GRANT SELECT (`FID`, `NIK`, `Nama`, `DEPT_NAME`, `tgL_Keluar`, `PHOTO`)
  ON `NAMA_DATABASE_HR`.`hr_staff_info` TO 'ista_absen_reader'@'%';

-- Check:  SHOW GRANTS FOR 'ista_absen_reader'@'%';
