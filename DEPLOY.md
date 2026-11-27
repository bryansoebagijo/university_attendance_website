# ISTA Presensi — Deployment Guide (Linux server, Docker, PostgreSQL + campus MariaDB)

This guide installs ISTA Presensi (attendance, leave and work schedules for lecturers) on a Linux server. The app brings **its own database** (PostgreSQL, inside Docker) and only **reads** staff data from the campus HR database (MariaDB). It is written for the campus IT administrator and the database administrator (DBA).

## Quick start — what to run, in order

Do these steps **in this order** after the release files (`ista-absen-<version>.zip`, `deploy.sh`, `SHA256SUMS`) and the **license file** from the developer (e.g. `ista-al-kamal-2029-11-27.key`) are on the server in the folder `~/ista` (how to copy them: section 4). Each step says who does it, what to type, and what you should see. The numbered sections later in this guide explain each step in detail.

Keep only **one** release zip in `~/ista`: then `ista-absen-*.zip` in the commands below always means that file, and you never have to type the version.

### Step 1 — Check that the files arrived intact (you)

```
cd ~/ista
sha256sum -c SHA256SUMS
```

You should see: `ista-absen-….zip: OK` and `deploy.sh: OK`. If anything says FAILED, copy the files again.

### Step 2 — Make sure Docker is installed (you)

```
docker compose version
```

If this prints a version, go to step 3. If it says "command not found", install Docker from the zip (no internet needed):

```
sudo bash deploy.sh install-docker ista-absen-*.zip
```

You should see: `✔ Docker version …` and `✔ Docker Compose version …`. Details: section 3.

### Step 3 — Give the app read access to the HR table (DBA)

Take the script out of the zip:

```
unzip -o ista-absen-*.zip 'ista-absen-*/deploy/mariadb/*'
```

No `unzip` on the server? Use `python3 -m zipfile -e ista-absen-*.zip .` instead. Then find the name of the HR database that holds `hr_staff_info`:

```
mysql -u root -p -e "SELECT table_schema FROM information_schema.tables WHERE table_name = 'hr_staff_info'"
```

Open `ista-absen-*/deploy/mariadb/hr_read_access.sql` and change: the **password** (write it down — you need it in step 5), **which hosts may connect**, and **`NAMA_DATABASE_HR`** → the database name from above. Then run it:

```
mysql -u root -p < ista-absen-*/deploy/mariadb/hr_read_access.sql
```

You should see no error message. If MariaDB runs on this same server, also make it accept connections from Docker (section 5). **No HR access yet?** Skip this step: the app works without it, and staff are then added by hand in Data Pegawai.

### Step 4 — First run of the installer: it prepares the configuration (you)

```
cd ~/ista
sudo bash deploy.sh install ista-absen-*.zip
```

You should see: `✔ Unpacked to /opt/ista-absen/releases/…`, `✔ Created /opt/ista-absen/config/app.env`, `✔ Generated a new session secret`, `✔ Generated the password of the app's own database`, then **"! Configuration needed before the first start"** with a short list. That is expected — the app is not started yet.

### Step 5 — Fill in the configuration and the license (you)

```
sudo nano /opt/ista-absen/config/app.env
```

Set `CORS_ORIGIN` (the https:// address of the app). For the HR connection set `HR_DB_HOST`, `HR_DB_NAME` (from step 3) and keep `HR_DB_USER=ista_absen_reader`. Save with Ctrl+O, Enter, then exit with Ctrl+X. Then the HR password from step 3 (one line, nothing else):

```
sudo nano /opt/ista-absen/config/hr_db_password
```

Install the license file:

```
sudo bash deploy.sh license ~/ista/*.key
```

You should see: `✔ License installed` with the customer name and expiry date. Details: sections 6 and 17.

### Step 6 — Second run of the installer: it starts the app (you)

```
cd ~/ista
sudo bash deploy.sh install ista-absen-*.zip
```

Within about a minute you should see `✔ backend: healthy, frontend: healthy`, `✔ ISTA Presensi … is running.`, `✔ Daily database backup scheduled` and the license with `State VALID`. On this first start the app creates its own database and **imports the staff from the HR database** (with photos). Check it:

```
curl -I http://127.0.0.1:3000/login
```

The first line must be `HTTP/1.1 200 OK`. If the installer shows errors instead, read the log lines it prints and section 14; then run `sudo bash deploy.sh restart`. Details: section 7.

### Step 7 — Publish the app on the web server with HTTPS (you)

Copy the Apache (or Nginx) example, put in the real domain name and certificate paths, and reload the web server (section 8). Then open **https://<your domain>/login** on a PC and on a phone: the login page must appear with a valid padlock.

### Step 8 — Create the first administrator (you)

```
sudo bash ~/ista/deploy.sh create-admin --email admin@kampus.ac.id --name "Nama Admin" --nip 198800000000
```

It prints a **one-time password**. Sign in with the email and that password at https://<your domain>; the app asks you to choose a new password.

### Step 9 — Set up the app (administrator, in the browser)

In this order: check **Sinkronisasi data dosen** on the dashboard (the import from step 6 — or add staff by hand in Data Pegawai if there is no HR connection) → **Buat sandi sementara** and download the list (first passwords for the staff) → roles in Data Pegawai → work schedules (**Atur jadwal**) → moving holidays (Hari Libur) → QR locations and kiosk screens (Lokasi QR) → test a scan with a phone. Details: section 9.

**Done.** From now on, use `sudo bash deploy.sh status`, `logs`, `restart` and `backup` (section 10), and install new versions with the same `install` command (section 11).

## 1. How it fits together

```
 Phones / PCs ──HTTPS──▶ Existing web server (Apache, port 443)
                              │  proxies to 127.0.0.1:3000
                              ▼
                 ┌───────── Docker (this app) ──────────┐
                 │ frontend  (Next.js, port 3000)       │
                 │     │ internal network               │
                 │ backend   (Express API, port 4000)   │
                 │     │                                │
                 │ db        (PostgreSQL 17, own data)  │
                 └──────────────┬───────────────────────┘
                                │ read-only, 6 columns (port 3306)
                                ▼
                 Campus MariaDB server
                   └─ <HR database>.hr_staff_info   (existing, never changed)
```

| Part | What it is |
|---|---|
| frontend | The website. Only reachable from the server itself (127.0.0.1:3000); the existing web server publishes it with HTTPS. |
| backend | The API and the nightly jobs (attendance rules, staff sync at 00:05 WIB). Not reachable from outside Docker. |
| db | **The app's own PostgreSQL database.** All attendance, leave, schedules, accounts and photos live here (Docker volume `ista-absen_pgdata`). Created and updated automatically; backed up daily by deploy.sh. Not reachable from outside Docker. |
| hr_staff_info | The campus's existing HR staff table (from the fingerprint attendance software). The app only **reads** six columns of it — never fingerprints, faces, cards or passwords — and never writes to it. |

**Fully offline: delivered as a zip, run with Docker.** Each version comes as one release zip (about 285 MB) plus the installer `deploy.sh`. The server needs **no internet access at all**. The application is mounted read-only into the containers, never baked into an image, so a new version is just a new zip: install, update and roll back are each one `deploy.sh` command.

| Inside the zip | What it is |
|---|---|
| app/backend, app/frontend | The application, compiled and with all its packages for Linux x86-64 |
| images/ista-absen-node.tar | The app runtime (Google distroless Node.js 22): Node.js and OpenSSL only — no shell, no package manager |
| images/ista-absen-postgres.tar | The database (official PostgreSQL 17) |
| offline/docker/ | Docker Engine and the Compose plugin (official static binaries), used only by `deploy.sh install-docker` |
| deploy/ | The installer, the HR access script, config templates, web server examples and this guide |
| docker-compose.yml, VERSION | How the three containers run; which version this is |

## 2. What you need

| Item | Requirement |
|---|---|
| Server | Linux x86-64 with systemd (Ubuntu 22.04/24.04, Debian 12, RHEL/Rocky 8–9, …), 2 CPU, **4 GB RAM**, 10 GB free disk (more over the years: photos and doctor's notes are stored in the database) |
| Docker | Docker Engine 24+ with the Compose plugin — or none: the zip can install it (section 3) |
| Internet | **Not needed.** Everything is in the zip. |
| Tools | Normally present: `bash`, `tar`, `sha256sum`, and `unzip` *or* `python3` to open the zip; `iptables` (needed by Docker) |
| HR database | The campus **MariaDB** (tested design for 10.3 – 12.x) with `hr_staff_info`, and someone with root/DBA access to create one read-only user. Optional: without it, staff are added by hand. |
| Web server | The existing **Apache** (also serving the campus's PHP 8 applications, which are not affected) — or Nginx or any other reverse proxy — with a domain name and an HTTPS certificate |
| Domain | e.g. absen.kampus.ac.id — HTTPS is required: phones only allow the camera (QR scanning) on HTTPS |

Folder layout on the server used in this guide:

```
/opt/ista-absen/
├── releases/
│   ├── ista-absen-2026.11.28-1200-abc1234/   one folder per installed version (last 3 kept)
│   └── …
├── app -> releases/ista-absen-…/             the version that runs (managed by deploy.sh)
├── config/                                   app.env + secret files — never inside a release
└── backups/                                  daily database backups (last 14 kept)
```

Everything is created by `deploy.sh`; you only edit `config/app.env` and `config/hr_db_password`.

## 3. Docker

**If Docker is already installed** (`docker compose version` works), skip this section.

**If not, install it from the zip** — no internet needed. The zip contains the official Docker Engine static binaries and the Compose plugin; the installer copies them to `/usr/bin`, creates the systemd services and starts Docker:

```
cd ~/ista
sudo bash deploy.sh install-docker ista-absen-<version>.zip
```

Expected end: `✔ Docker version 29.…` and `✔ Docker Compose version v5.…`. It refuses to overwrite an existing Docker installation. Requirements: systemd and the `iptables` command (part of almost every server installation).

Optional: let your admin user run Docker without sudo (log out and in afterwards): `sudo usermod -aG docker $USER`.

## 4. Copy the release to the server

You receive these files (from the developer, on a USB stick, shared drive, e-mail, …):

| File | Purpose |
|---|---|
| ista-absen-<version>.zip | Everything for the server (about 285 MB, see section 1) |
| deploy.sh | The installer: install, update, roll back, status, logs, backups |
| SHA256SUMS | Checksums; deploy.sh uses them to detect a damaged copy |
| <customer>-<expiry>.key | The license file (only for the first installation and for renewals) — see section 17 |

Copy them into the folder `~/ista` (in your home folder on the server). You need an SSH login for the server (user name, password or key, and its IP address); the server itself needs no internet. Choose one way:

**WinSCP (Windows, graphical — easiest):** New Session → protocol **SFTP**, host = server IP, port 22, your user and password → Login. On the server side create the folder `ista` in your home folder and drag the files into it. (FileZilla works the same way; choose SFTP, not FTP.)

**scp from PowerShell or a Linux/Mac terminal** (replace user and IP):

```
ssh admin@10.0.0.15 "mkdir -p ~/ista"
scp ista-absen-*.zip deploy.sh SHA256SUMS *.key admin@10.0.0.15:~/ista/
```

**USB stick** (server not reachable over the network): copy the files to the stick, plug it into the server, then:

```
lsblk                                   # find the stick, e.g. /dev/sdb1
sudo mount /dev/sdb1 /mnt
mkdir -p ~/ista && cp /mnt/ista-absen-*.zip /mnt/deploy.sh /mnt/SHA256SUMS /mnt/*.key ~/ista/
sudo umount /mnt
```

Then check the copy: `cd ~/ista && sha256sum -c SHA256SUMS` must print `OK` twice.

The installer can be run from anywhere; it installs into `/opt/ista-absen` (change with `ISTA_HOME=/other/path`). The zip also contains `deploy/deploy.sh`, so the installer is never lost.

## 5. HR database access (DBA)

The app keeps all its own data in its own PostgreSQL. From the campus MariaDB it only needs **one read-only user** that may read six columns of `hr_staff_info`. That is the only change in the campus database — no new database, no tables, no updates later.

**Step 1 — edit `deploy/mariadb/hr_read_access.sql`** (from the zip) in three places: the password, which hosts may connect (see below), and `NAMA_DATABASE_HR` → the database that holds `hr_staff_info`. To find it:

```
mysql -u root -p -e "SELECT table_schema FROM information_schema.tables WHERE table_name = 'hr_staff_info'"
```

The script grants **only** `SELECT` on the columns `FID`, `NIK`, `Nama`, `DEPT_NAME`, `tgL_Keluar` and `PHOTO`. The same table also holds fingerprint templates, face data, card numbers and machine passwords; with this column-level grant the app cannot read them, even by mistake (MariaDB refuses with "SELECT command denied … for column").

**Step 2 — run it and check:**

```
mysql -u root -p < hr_read_access.sql
mysql -u root -p -e "SHOW GRANTS FOR 'ista_absen_reader'@'%'"
```

The grants must show `GRANT SELECT (DEPT_NAME, FID, NIK, Nama, PHOTO, tgL_Keluar) ON <HR database>.hr_staff_info`.

**Step 3 — test it as the new user** (replace the database name):

```
mysql -h 127.0.0.1 -u ista_absen_reader -p -e "SELECT CAST(FID AS UNSIGNED), NIK, Nama, DEPT_NAME, tgL_Keluar FROM NAMA_DATABASE_HR.hr_staff_info LIMIT 5"
```

**If MariaDB runs on the same server as Docker,** the app reaches it at `host.docker.internal` (the Docker bridge, usually 172.17.0.1). MariaDB usually only listens on 127.0.0.1, so:

1. In the MariaDB server config (Debian/Ubuntu: `/etc/mysql/mariadb.conf.d/50-server.cnf`; RHEL/Rocky: `/etc/my.cnf.d/mariadb-server.cnf`) set `bind-address = 127.0.0.1,172.17.0.1` (MariaDB 10.11+ accepts several addresses) and restart it: `sudo systemctl restart mariadb`. The PHP applications keep using 127.0.0.1 as before.
2. In `hr_read_access.sql`, use `'ista_absen_reader'@'172.%'` instead of `'%'`, so only Docker networks can use the account.
3. If the firewall is on: `sudo ufw allow from 172.16.0.0/12 to any port 3306 proto tcp`.

Then set `HR_DB_HOST=host.docker.internal` in app.env.

**If MariaDB runs on another server,** set `HR_DB_HOST` to its host name or IP, create the user for the app server's IP address (both lines of the script), and allow port 3306 from the app server only.

## 6. Configuration and secrets

All settings live in `/opt/ista-absen/config/`, outside the release folders, so installing a new version never touches them. **The first run of the installer creates this folder for you** and fills in everything it can.

| File | Contents | Created by |
|---|---|---|
| app.env | Settings (table below) | Installer, from the template — **you edit it** |
| hr_db_password | One line: the password of `ista_absen_reader` (section 5) | Installer creates it empty — **you fill it in** |
| db_password | Password of the app's own PostgreSQL | Installer generates it. **Never change it by hand** after the first start. |
| jwt_secret | Key that signs login sessions (64 hex characters) | Installer generates it |
| license.key | The license | `deploy.sh license <file>` (section 17) |

The secret files are mounted into the containers as Docker secrets (`/run/secrets/…`), so they don't show up in `docker inspect`, in environment listings or in logs. The folder itself is readable by root only. Keep a copy of `jwt_secret`, `db_password` and `hr_db_password` in the institution's password manager; never email them or put them in chat.

The settings in `app.env`:

| Setting | Example | Meaning |
|---|---|---|
| CORS_ORIGIN | https://absen.kampus.ac.id | The public HTTPS address of the app |
| SESSION_HOURS | 12 | How long a login lasts |
| HR_DB_HOST | host.docker.internal | Where the campus MariaDB is. **Empty = no HR connection** (staff are added by hand) |
| HR_DB_PORT | 3306 | MariaDB port |
| HR_DB_NAME | hr_db | The database that holds hr_staff_info (section 5) |
| HR_DB_USER | ista_absen_reader | The read-only user from section 5 |
| HR_PHOTO_IMPORT | true | Import profile photos from HR (only for people who didn't upload their own) |
| SYNC_NIGHTLY | true | Run the staff sync every night at 00:05 WIB |
| SYNC_DEFAULT_QUOTA | 12 | Annual leave days for newly imported staff |
| SYNC_MAX_DEACTIVATE_PERCENT | 20 | Safety stop if a sync would deactivate more than this share of staff |
| TEACHER_SOURCE_QUERY | (empty) | Advanced: another SELECT for a different HR table. Empty = the built-in query for hr_staff_info |

After changing `app.env` or `hr_db_password`, apply it with `sudo bash deploy.sh restart`.

### How staff come from the HR database

| hr_staff_info column | Becomes in the app | Note |
|---|---|---|
| FID | The link between the HR record and the app account | Never changes; a corrected NIK updates the same account |
| NIK | NIP / login ID | Staff sign in with their NIK (there is no email column) |
| Nama | Name | Extra spaces are cleaned up |
| DEPT_NAME | Unit | |
| tgL_Keluar (exit date) | Active or not | Filled in → the account is deactivated. Empty, `0`, `-` or `0000-00-00` → active |
| PHOTO | Profile picture | JPEG, PNG or WebP; converted to a small square JPEG. Only used if the person hasn't uploaded their own photo |
| BE_Active, JABATAN, COSTUM_1…16, fingerprints, … | — | Not used and not readable by the app |

**Everyone in the table is imported with the role "Dosen"** — lecturers and other staff alike. Administrators then change roles where needed in Data Pegawai (Penyetuju, Administrator), and can deactivate accounts of staff who don't need the app.

**When the sync runs:** at the first start of a new installation (and at every start until one import has succeeded), every night at 00:05 WIB, and whenever an administrator clicks **Sinkronkan sekarang** on the dashboard.

What the sync does:

- **New person in hr_staff_info** → an account is created, role Dosen, with no password yet.
- **Changed name/NIK/department** → updated in the app.
- **Exit date filled in, or removed from hr_staff_info** → deactivated in the app (never deleted; attendance history stays).
- **Photos:** imported for people without a photo of their own; replaced only when HR changes the photo (each photo is fingerprinted, so unchanged photos aren't read again). A photo a person uploaded in the app is never replaced. Photos in other formats (e.g. BMP) are skipped and listed under "rows need attention".
- **Owned by this app and never overwritten:** role, leave quota, password, language, theme, work schedule, own photo.
- **Accounts created by hand** in Data Pegawai are kept. When HR later has a person with the same NIK, the hand-made account is **linked** to the HR record instead of duplicated (and keeps its password).
- **HR database unreachable:** nothing changes in the app; the dashboard shows the error (e.g. "Cannot connect to the HR database at …"). The next nightly run or a click on Sinkronkan sekarang tries again.
- **Safety stops:** an empty result, or a run that would deactivate more than 20 % of synced staff, changes nothing. An admin can force it from the dashboard after checking.

## 7. Install and start the app

```
cd ~/ista
sudo bash deploy.sh install ista-absen-<version>.zip
```

**First run:** the installer checks Docker and the checksum, unpacks the release to `/opt/ista-absen/releases/`, creates `/opt/ista-absen/config/` (with generated passwords) and stops with a list of what to fill in (section 6). Fill it in, then run **the same command again**.

**Second run:** it loads the two images into Docker (`docker load`, from the zip), activates the version and starts the three containers. On this first start the backend **creates its own database tables**, then **imports the staff from the HR database**. The installer waits until everything is healthy (usually within a minute) and schedules the daily backup. Expected end:

```
✔ backend: healthy, frontend: healthy (41 s)
✔ ISTA Presensi ista-absen-2026.11.28-1200-abc1234 is running.
✔ Daily database backup scheduled (01:30, last 14 kept in /opt/ista-absen/backups)
  Staff are imported from the HR database at the first start (see Dashboard → Sinkronisasi data dosen).
```

Check from the server: `curl -I http://127.0.0.1:3000/login` returns `200`. The import result is in the logs (`sudo bash deploy.sh logs backend`, line `[teacher-sync:startup]`) and on the dashboard.

**If the HR database can't be reached** the app still starts normally — the dashboard shows why the import failed, and staff can be added by hand meanwhile. Fix the connection (section 5), then click **Sinkronkan sekarang** or run `sudo bash deploy.sh restart`.

If the app doesn't become healthy, the installer prints the last log lines; see section 14, fix the cause and run `sudo bash deploy.sh restart`.

## 8. Publish it with the existing web server (HTTPS)

Example configurations are in `/opt/ista-absen/app/deploy/apache.example.conf` and `nginx.example.conf`. Copy the one that matches, change the domain and certificate paths, and reload the web server.

**Apache** (the campus server — the PHP 8 sites keep working; this adds one more virtual host):

```
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo cp /opt/ista-absen/app/deploy/apache.example.conf /etc/apache2/sites-available/ista-absen.conf
sudo nano /etc/apache2/sites-available/ista-absen.conf      # domain + certificate paths
sudo a2ensite ista-absen && sudo apachectl configtest && sudo systemctl reload apache2
```

On RHEL/Rocky the Apache config is in `/etc/httpd/conf.d/` (copy the file there as `ista-absen.conf`, then `sudo apachectl configtest && sudo systemctl reload httpd`).

**Nginx:**

```
sudo cp /opt/ista-absen/app/deploy/nginx.example.conf /etc/nginx/sites-available/ista-absen.conf
sudo nano /etc/nginx/sites-available/ista-absen.conf
sudo ln -s /etc/nginx/sites-available/ista-absen.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Use the campus's own certificate for the domain (or a wildcard certificate such as *.kampus.ac.id). Let's Encrypt (`certbot`) only works if the server can reach the internet.

Use a **separate subdomain** (e.g. `absen.istaalkamal.ac.id`), not a sub-folder of an existing site. Other web servers (LiteSpeed, Caddy, HAProxy, …) work too, if they forward all paths to `http://127.0.0.1:3000`, send `Host`, `X-Forwarded-For` and `X-Forwarded-Proto: https`, and allow uploads up to 6 MB.

Important details already in the examples: the upload limit is raised to 6 MB (photos and doctor's notes up to 5 MB), and the `X-Forwarded-*` headers are passed so the login rate limit sees each user's real IP. Ports 3000 and 4000 must not be opened in the firewall.

## 9. First use

**1. Create the first administrator** (prints a one-time password):

```
sudo bash deploy.sh create-admin --email admin@kampus.ac.id --name "Nama Admin" --nip 198800000000
```

**2. Sign in** at https://absen.kampus.ac.id with that email and the one-time password, and choose a new password.

**3. Staff:** Dashboard → **Sinkronisasi data dosen** shows the import from the first start (new / updated / deactivated / photos / rows that need attention). Click **Sinkronkan sekarang** to run it again. Without an HR connection, add staff in **Data Pegawai → Tambah pegawai**.

**4. Give staff their first password:** click **Buat sandi sementara**, then **Unduh daftar (CSV)**. Each person signs in with their NIK and the one-time password, and must choose their own. The list is shown only once — store it safely and delete it after handing out.

**5. Roles:** everyone starts as Dosen. In Data Pegawai, give approvers (who approve leave) the role Penyetuju, and other administrators the role Administrator.

**6. Work schedules:** in Data Pegawai → **Atur jadwal**, set the weekdays for part-time lecturers (everyone else stays Monday–Friday).

**7. Holidays:** in Hari Libur, add this year's moving holidays (Idul Fitri, Idul Adha, Nyepi, Waisak, Imlek, …).

**8. Kiosk screens:** each location shows its rotating QR code on a screen (a TV or tablet with a browser in full-screen mode). In Lokasi QR, create the locations. Then, in the kiosk screen's own browser: sign in as an administrator → Lokasi QR → **Buka layar kios** → **Buat kunci & buka kios**. The screen is now paired and keeps showing codes after you sign out. Pairing a new screen for the same location stops the old one.

**9. Test with a phone:** open the site, sign in as a teacher, press Absen Masuk and scan the kiosk QR.

## 10. Daily operation

All commands run from the folder that holds `deploy.sh` (or use `/opt/ista-absen/app/deploy/deploy.sh`).

| Task | Command / place |
|---|---|
| Status: version, containers, health, last backup, license | `sudo bash deploy.sh status` |
| Follow the logs | `sudo bash deploy.sh logs` (or `logs backend` / `logs frontend` / `logs db`; Ctrl+C to stop) |
| Restart (e.g. after editing app.env) | `sudo bash deploy.sh restart` |
| Stop / start | `sudo bash deploy.sh stop` / `sudo bash deploy.sh start` |
| Back up the database now | `sudo bash deploy.sh backup` (also runs daily at 01:30) |
| Create another administrator | `sudo bash deploy.sh create-admin --email … --name "…" --nip …` |
| Run the staff sync now | Dashboard → Sinkronkan sekarang (also runs nightly at 00:05 WIB) |
| New staff without password | Data Pegawai shows "Belum ada sandi" → Dashboard → Buat sandi sementara, or Reset sandi per person |
| Someone forgot their password | Data Pegawai → Reset sandi (one-time password) |
| License status / renewal | Pengaturan → Lisensi · `sudo bash deploy.sh license <new file>` (section 17) |

The containers start again automatically after a server reboot (`restart: unless-stopped`) once Docker is running. Stopping or updating never deletes the data: it lives in the Docker volume `ista-absen_pgdata`.

## 11. Updating to a new version

1. Copy the new `ista-absen-<version>.zip`, `deploy.sh` and `SHA256SUMS` to the server (section 4).
2. **Make a backup first:** `sudo bash deploy.sh backup`.
3. Install it:

```
cd ~/ista
sudo bash deploy.sh install ista-absen-<new-version>.zip
```

The installer unpacks the new version next to the old one, loads its images, switches to it and recreates the containers. **Database changes are applied automatically** when the backend starts — no DBA work. It waits until everything is healthy (usually under a minute of downtime). Settings in `config/` and all data are kept.

**Going back:** `sudo bash deploy.sh rollback` returns to the previous installed version. If the new version had changed the database, the older app may not work with the newer tables: then restore the backup from step 2 after rolling back (section 12). The last 3 versions are kept in `/opt/ista-absen/releases/`.

## 12. Backups and restore

Everything the app stores — accounts, attendance, leave, schedules, photos, doctor's notes, the admin log — is in its own PostgreSQL database. The HR database is not part of it (it stays the campus's responsibility).

**Automatic:** every day at 01:30 a backup is written to `/opt/ista-absen/backups/ista_absen-<date>-<time>.dump`; the last 14 are kept. `sudo bash deploy.sh status` shows the latest one. (Systemd timer `ista-absen-backup.timer`; check with `systemctl list-timers | grep ista`.)

**Manual:** `sudo bash deploy.sh backup` — always before an update.

**Copy backups off the server** regularly (e.g. weekly to the campus backup storage): a backup on the same disk doesn't help if the disk fails.

**Restore** (replaces all current data; a safety backup of the current state is made first):

```
sudo bash deploy.sh restore /opt/ista-absen/backups/ista_absen-20261201-013000.dump
```

Also keep a copy of the `/opt/ista-absen/config/` folder (it holds the secrets and the license — store it encrypted or in the password manager) and the release zip of the running version. To move to a new server: install the same version there (section 7), copy `config/` over, then restore the latest backup.

## 13. Security notes

- **Secrets:** only in `/opt/ista-absen/config/` (folder readable by root only) and the password manager.
- **Rotating the JWT secret** (e.g. if it leaked): delete `/opt/ista-absen/config/jwt_secret` and run `sudo bash deploy.sh install <current zip>` (a new one is generated). Everyone is signed out once.
- **Changing the HR password:** `ALTER USER 'ista_absen_reader'@'%' IDENTIFIED BY '…';` on MariaDB, then update `hr_db_password` and `sudo bash deploy.sh restart`.
- **The app's own database password** (`db_password`) is set when the database is first created; don't change the file afterwards.
- **Least privilege towards the campus:** the HR user can only read six columns of `hr_staff_info` — not the biometric data, cards or passwords in the same table — and can't write anything.
- **Network:** only the web server is public. The app's database is not exposed at all; ports 3000/4000 only on 127.0.0.1. The app needs no outbound internet access.
- **Containers:** the app runs as an unprivileged user (uid 1000) on a read-only file system, from a minimal image without shell or package manager, with the application code mounted read-only.
- **Release files:** the installer checks the zip against `SHA256SUMS` when it lies next to it.
- **Admin log:** every admin correction (schedule, attendance added/edited/deleted, excused days, issued passwords) is stored with who, when and why.

## 14. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| deploy.sh: "Checksum mismatch" / "not a valid zip file" | The copy is damaged or incomplete. Copy the zip and SHA256SUMS again (binary mode in FTP clients). |
| deploy.sh: "Run as root" | Use sudo: `sudo bash deploy.sh …` |
| deploy.sh: "Neither unzip nor python3 is available" | Copy `unzip` from the OS installation media, or open the zip on another machine and copy the folder over. |
| deploy.sh: "Docker is not installed" | `sudo bash deploy.sh install-docker ista-absen-<version>.zip` (section 3) |
| install-docker: "Docker did not start" | `journalctl -u docker -n 50`. Usually missing `iptables` or an old kernel (needs 4.x+ with overlay support). |
| deploy.sh: "HR_DB_HOST is set, so HR_DB_NAME … is needed" / "hr_db_password is empty" | Fill in app.env / hr_db_password (section 6), or empty HR_DB_HOST to run without HR. |
| Dashboard: "Cannot connect to the HR database at …" | MariaDB not reachable from Docker: bind-address, firewall, or wrong HR_DB_HOST/port (section 5). The app keeps working. |
| Dashboard: "Reading staff … failed: Access denied for user 'ista_absen_reader'" | Wrong password in hr_db_password, or the user's host part doesn't match (use '172.%' or '%'). |
| Dashboard: "… SELECT command denied … for column" | The column grant is missing or names the wrong database: `SHOW GRANTS FOR 'ista_absen_reader'@'%';` (section 5). |
| Sync: "rows need attention … PHOTO_FORMAT_BMP" | The HR software stored that photo as BMP. The person is imported without a photo; ask the developer for BMP support, or let them upload their own photo. |
| Sync stopped ("would deactivate …") | HR returned far fewer staff than before. Check the HR data; force only if correct. |
| Backend: "Database … not set up" / migration errors | The app's own database couldn't be created or updated: `sudo bash deploy.sh logs backend` and `logs db`. Check free disk space (`df -h`). |
| Backend: "password authentication failed for user ista_absen" | `config/db_password` was changed after the database was created. Put the original back (password manager / backup of config). |
| Red banner "Mode baca-saja" (read-only) | The license is missing, invalid, expired (after the grace period), or the server clock was turned back. Install a valid license: `sudo bash deploy.sh license <file>`; check the server date with `date` (section 17). |
| deploy.sh: "not an ISTA Presensi license file" | You gave it a different file. Use the `.key` file from the developer, unchanged. |
| "cannot read /run/secrets/…" | Run `sudo bash deploy.sh install <current zip>` again: it repairs the owners and permissions of the config files. |
| Backend: "Query engine library … could not be found" or OpenSSL errors | The runtime image wasn't loaded from this release: `sudo bash deploy.sh install <zip>` again (it runs `docker load`). |
| Phone camera doesn't open | The site must be opened over HTTPS with a valid certificate. |
| Uploading a photo or doctor's note fails | Raise the web server's upload limit (LimitRequestBody / client_max_body_size 6m). |
| 502 Bad Gateway from the web server | The app is starting or stopped: `sudo bash deploy.sh status`, `sudo bash deploy.sh logs frontend`. |
| Everyone appears to come from one IP / logins blocked | The web server must send X-Forwarded-For (see the example configs). |

## 15. Quick reference

| What | Where |
|---|---|
| Installer | deploy.sh (next to the zip; also /opt/ista-absen/app/deploy/deploy.sh) |
| Install / update | `sudo bash deploy.sh install ista-absen-<version>.zip` |
| Status / logs / restart | `sudo bash deploy.sh status` · `logs` · `restart` |
| Backup / restore | `sudo bash deploy.sh backup` · `restore <file>` (daily automatic backup at 01:30) |
| Roll back | `sudo bash deploy.sh rollback` |
| Create an admin | `sudo bash deploy.sh create-admin --email … --name "…" --nip …` |
| Install / renew the license | `sudo bash deploy.sh license <file>` |
| Running version | /opt/ista-absen/app → releases/ista-absen-<version> (also: the VERSION file in it) |
| Settings and secrets | /opt/ista-absen/config/ (app.env, hr_db_password, db_password, jwt_secret, license.key) |
| Database backups | /opt/ista-absen/backups/ |
| HR access script | /opt/ista-absen/app/deploy/mariadb/hr_read_access.sql |
| Web server examples | /opt/ista-absen/app/deploy/apache.example.conf, nginx.example.conf |

## 16. For the developer: making a release

On the development PC (it needs internet; the server doesn't), in the repository — commit first, so the version names a real commit:

```
node deploy/release/make-release.mjs                         # full release, ~285 MB
node deploy/release/make-release.mjs --no-docker-installer   # without offline/docker, ~180 MB
```

It compiles the backend, installs its production packages for Linux x86-64, generates the Prisma client for PostgreSQL with the Debian/OpenSSL 3 engine and bundles the migrations (applied by the app itself at startup); builds the frontend as a Next.js standalone server; downloads the distroless Node.js 22 image, PostgreSQL 17 and (optionally) Docker's static binaries; checks that every native binary in the bundle is a Linux one; and writes `release/ista-absen-<date>-<commit>.zip`, `release/deploy.sh` and `release/SHA256SUMS`. Downloads are cached in `release/.cache`. The zip never contains `.env` files or secrets. A version ending in `-dirty` was built from uncommitted changes.

## 17. License

The app needs a license file from the developer. It states who may use the app and until when, and it is digitally signed: changing anything in it (for example the date) makes it invalid. It is checked on the server itself — no internet needed.

**Install or renew** (also when the app is running; it takes effect within a minute, no restart):

```
sudo bash deploy.sh license ~/ista/<file>.key
```

The file is stored as `/opt/ista-absen/config/license.key`. Always install it with this command (not with `mv`), so the running app sees the new file. Administrators see the current license in **Pengaturan → Lisensi**; `sudo bash deploy.sh status` shows it too.

**What happens over time:**

| When | What the users see | What works |
|---|---|---|
| Valid | Nothing | Everything |
| From 30 days before the expiry date | Administrators: a reminder banner with the date | Everything |
| After the expiry date, during the grace period (normally 14 days) | Everyone: a warning banner | Everything |
| After the grace period | Everyone: red banner "Mode baca-saja" | **Read-only:** signing in, viewing and exporting data work; clocking in/out, leave requests and all changes don't |
| No license / damaged or edited file | Red banner | Read-only |

Data is never deleted or hidden because of the license — read-only mode only stops changes, and installing a valid license ends it immediately.

**The server clock:** the app remembers the newest date it has stored. If the server clock is set back before that date (for example to get around the expiry date), it switches to read-only mode. Keep the server's date and time correct (`timedatectl`); a wrong clock also gives wrong attendance times.

**For the developer:** licenses are created with `node tools/license/issue.mjs --customer "…" --expires YYYY-MM-DD [--grace 14]` and the private key in `~/.ista-license/` (created once with `tools/license/keygen.mjs`). The private key never leaves the developer's PC; back it up. A license is not bound to a domain or server; the customer name is shown in the app.
