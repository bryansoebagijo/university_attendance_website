-- =============================================================================================
-- ISTA Presensi — optional starter data (MariaDB 10.3+ / MySQL 8.0+). Run after 001_create_tables.sql:
--   mysql -u root -p ista_absen < 010_starter_data.sql
-- Can also be done in the app (Hari Libur). Safe to run twice. QR locations are created in the
-- app (Lokasi QR), which also generates their secret signing keys.
-- The first administrator is created with the app's command, not here (see the guide):
--   sudo bash deploy.sh create-admin --email … --name "…" --nip …
-- =============================================================================================

-- Fixed-date national holidays. Holidays that move every year (Idul Fitri, Idul Adha, Nyepi,
-- Waisak, Imlek, …) are added by the admin in Hari Libur, following the official SKB 3 Menteri.
INSERT IGNORE INTO `Holiday` (`date`, `name`, `createdAt`) VALUES
  ('2026-01-01', 'Tahun Baru Masehi', NOW(3)),
  ('2026-05-01', 'Hari Buruh Internasional', NOW(3)),
  ('2026-06-01', 'Hari Lahir Pancasila', NOW(3)),
  ('2026-08-17', 'Hari Kemerdekaan Republik Indonesia', NOW(3)),
  ('2026-12-25', 'Hari Raya Natal', NOW(3)),
  ('2027-01-01', 'Tahun Baru Masehi', NOW(3)),
  ('2027-05-01', 'Hari Buruh Internasional', NOW(3)),
  ('2027-06-01', 'Hari Lahir Pancasila', NOW(3)),
  ('2027-08-17', 'Hari Kemerdekaan Republik Indonesia', NOW(3)),
  ('2027-12-25', 'Hari Raya Natal', NOW(3));
