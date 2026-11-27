-- =============================================================================================
-- ISTA Presensi — database and application user (MariaDB 10.3+ / MySQL 8.0+)
-- =============================================================================================
-- Run once as root (or another admin account) on the campus database server:
--   mysql -u root -p < 000_create_database_and_user.sql
--
-- BEFORE RUNNING, edit the marked places:
--   (1) the password
--   (2) which hosts may connect
--   (3) NAMA_DATABASE_HR → the name of the database that holds hr_staff_info (2 places)
--       Find it with:  SELECT table_schema FROM information_schema.tables WHERE table_name = 'hr_staff_info';
--
-- Design: this app gets its OWN database (ista_absen). The existing HR database is untouched; the
-- app may only READ five columns of hr_staff_info — never the fingerprints, faces, cards, passwords
-- or photos stored in the same table.
-- =============================================================================================

CREATE DATABASE IF NOT EXISTS `ista_absen`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- (1) Choose a strong password (store it in /opt/ista-absen/config/db_password on the app server).
-- (2) Which hosts may connect as this user — use the same value in all lines below:
--       '%'          any host (simplest; protect port 3306 with the firewall)
--       '172.%'      only Docker networks on the same machine (database on the same server as Docker)
--       '10.0.0.15'  only the app server's IP (database on a different server)
CREATE USER IF NOT EXISTS 'ista_absen'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

-- Day-to-day rights only: read and write rows. No CREATE/ALTER/DROP — table changes come as
-- numbered SQL files that the DBA runs (001, 002, …).
GRANT SELECT, INSERT, UPDATE, DELETE ON `ista_absen`.* TO 'ista_absen'@'%';

-- (3) Teacher sync: read-only access to exactly these columns of the HR staff table.
--     FID = the link to this app's account, NIK = login ID, Nama, DEPT_NAME = unit,
--     tgL_Keluar = exit date (filled in → the account is deactivated).
--     Biometric data (SidikJari…, Wajah…), cards, passwords and PHOTO are NOT granted.
GRANT SELECT (`FID`, `NIK`, `Nama`, `DEPT_NAME`, `tgL_Keluar`)
  ON `NAMA_DATABASE_HR`.`hr_staff_info` TO 'ista_absen'@'%';

-- Check: SHOW GRANTS FOR 'ista_absen'@'%';
