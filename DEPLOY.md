# Deploying ISTA Presensi with Docker

```
Browser ─HTTPS─▶ client web server (Nginx/Apache: HTTPS + proxy)
                       │ http://127.0.0.1:3000
                 ┌─────▼─────┐      ┌───────────┐
                 │ frontend  │─────▶│  backend  │─────▶ client's MySQL server
                 └───────────┘      └───────────┘
                     docker compose (internal network)
```

- **frontend**: Next.js standalone server. Published only on `127.0.0.1:${APP_PORT}` (default 3000).
- **backend**: Express API + nightly attendance job. Not published; only the frontend reaches it.
  On every start it applies pending database migrations (`prisma migrate deploy`).
- **Database**: the client's existing MySQL (8.0+ recommended, tested on 8.4) — a separate database for this app.
- **HTTPS**: handled by the client's existing web server. Phones only allow the camera over HTTPS.

Run **one** backend container only — the nightly job (00:05 WIB) lives inside it.

## What you need from the client

| Item | Why |
|---|---|
| A Linux server with **Docker Engine + Compose plugin** (`docker compose version`) | runs the two containers |
| A **domain/subdomain**, e.g. `absen.ista.ac.id`, pointing at the web server | HTTPS certificate; the app must be at the root of its own (sub)domain, not under a path like `/absen` |
| Access to configure the **existing web server** (Nginx or Apache) | add the proxy site — examples in `deploy/` |
| A **MySQL database + user** for this app (below) | data |
| Agreement on **database backups** | the client's MySQL backup routine should include the `absen` database |

### MySQL preparation (run by the client's DBA)

```sql
CREATE DATABASE absen CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'absen'@'%' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON absen.* TO 'absen'@'%';
FLUSH PRIVILEGES;
```

- MySQL on the **same machine** as Docker: use host `host.docker.internal` in `DATABASE_URL`, and MySQL must accept
  connections from the Docker network (its `bind-address` must not be only `127.0.0.1`, and the user host must allow
  the Docker bridge, e.g. `'absen'@'172.%'`).
- MySQL on **another server**: use its hostname; open port 3306 from the app server only.

## First installation

```bash
# 1. Get the project onto the server (git clone, or copy the folder)
cd /opt/ista-absen

# 2. Settings
cp .env.production.example .env
nano .env                              # APP_URL, DATABASE_URL, JWT_SECRET (openssl rand -hex 32)
chmod 600 .env

# 3. Build and start (first build takes a few minutes)
docker compose up -d --build
docker compose ps                      # both "healthy" after ~1 minute
docker compose logs backend            # shows "Backend listening" and the daily-rules startup run

# 4. Create the first administrator (prints a one-time password; they must change it at first sign-in)
docker compose exec backend node dist/cli/create-admin.js \
  --email admin@ista.ac.id --name "Nama Admin" --nip 1234567890 --unit "Biro SDM"
```

5. Add the web server site from `deploy/nginx.example.conf` or `deploy/apache.example.conf`, reload it,
   and get a certificate (e.g. `certbot --nginx -d absen.ista.ac.id`).
6. Open `https://absen.ista.ac.id`, sign in as the admin, change the password, then:
   - **Hari Libur**: add this year's moveable national holidays.
   - **Lokasi QR**: create the real locations and pair each kiosk screen (**Buka layar kios** on that device).
   - **Data Pegawai**: add staff (each gets a one-time password).

## Updating to a new version

```bash
cd /opt/ista-absen
git pull                               # or copy the new files
docker compose up -d --build           # rebuilds, applies new migrations on start
docker image prune -f                  # remove old images
```

Rollback: check out the previous version and run `docker compose up -d --build` again
(database migrations only add things; take a database backup before every update anyway).

## Day to day

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f backend` / `frontend` |
| Restart | `docker compose restart` |
| Stop / start | `docker compose down` / `docker compose up -d` |
| New admin | `docker compose exec backend node dist/cli/create-admin.js --email … --name "…" --nip …` |
| Database backup | `mysqldump --single-transaction -h HOST -u absen -p absen > absen-$(date +%F).sql` |

Containers restart automatically after a crash or a server reboot (`restart: unless-stopped`).
Logs are rotated (5 × 10 MB per container).

## Go-live checklist

- [ ] `https://` works and `http://` redirects to it
- [ ] Sign in as admin; one-time password forces a new password
- [ ] Profile photo upload works (proves the 5 MB upload limit on the web server)
- [ ] A real phone on campus: **Absen Masuk** → camera opens → scanning the kiosk QR succeeds
- [ ] Kiosk screen refreshes the QR every 30 s
- [ ] Leave request → approval works; email-free flow understood by staff
- [ ] `docker compose logs backend` shows the nightly job after 00:05 WIB
- [ ] Database backup of `absen` confirmed with the client

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| backend restarts, log says `Invalid backend environment` | a missing/short value in `.env` (JWT_SECRET ≥ 32 chars) |
| backend log: `Can't reach database server` | wrong host/port in DATABASE_URL; MySQL not reachable from Docker (see MySQL preparation) |
| sign-in works but you're sent back to login | the site isn't served over HTTPS (the session cookie is HTTPS-only in production) |
| camera never starts on phones | not HTTPS, or a `Permissions-Policy` header blocks `camera` |
| photo upload fails with 413 | web server upload limit (`client_max_body_size 6m` / `LimitRequestBody`) |
| 502 Bad Gateway | containers not running/healthy (`docker compose ps`), or the proxy port ≠ APP_PORT |
