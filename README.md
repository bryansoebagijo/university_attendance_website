# ISTA — Presensi & SDM

Attendance (rotating-QR clock in / out) and annual-leave app for ISTA Al-Kamal lecturers.

```
absen_website/
├── frontend/   Next.js 15 + TypeScript + Tailwind v4 (UI, proxies /api/* to the backend)
├── backend/    Express + TypeScript + Prisma + PostgreSQL (API)
└── ISTA_Dummy_Interaktif.html   design reference
```

> **Production:** Docker (frontend + backend containers, code mounted from the server) behind the client's web
> server, using a separate database on their MySQL and syncing teachers from their existing teacher table.
> See **[DEPLOY.md](DEPLOY.md)** — also as a PDF: `deploy/ISTA_Presensi_Deployment_Guide.pdf`
> (rebuild with `node deploy/guide/build-pdf.mjs`).
> The client server has **no internet**: `node deploy/release/make-release.mjs` builds an offline release in `release/`
> (zip with the app prebuilt for Linux, the runtime image and Docker's static binaries + `deploy.sh` + `SHA256SUMS`);
> on the server `sudo bash deploy.sh install ista-absen-<version>.zip`.
>
> **License:** production needs a signed license (`config/license.key`, or the `LICENSE` env var on hosting).
> Without one the app is read-only. Key pair once: `node tools/license/keygen.mjs` (private key stays in
> `~/.ista-license/`, never in git); licenses: `node tools/license/issue.mjs --customer "…" --expires YYYY-MM-DD`.

## Run locally

Needs Node 22 and PostgreSQL 17 (on this machine it runs as the Windows service `postgresql-x64-17`).

First time only:

1. Create a database user and databases (psql as `postgres`):
   `CREATE ROLE absen LOGIN CREATEDB PASSWORD '…'; CREATE DATABASE absen OWNER absen; CREATE DATABASE absen_test OWNER absen;`
2. Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env.local`.
   Fill in `DATABASE_URL` and the **same** long random `JWT_SECRET` in both files.
   For tests, also create `backend/.env.test` with `NODE_ENV=test`, `JWT_SECRET`, and a `DATABASE_URL` pointing at `absen_test`.
3. `cd backend && npm install && npm run db:migrate && npm run db:seed`
4. `cd frontend && npm install`

Every time:

```bash
cd backend && npm run dev     # http://localhost:4000/api/health
cd frontend && npm run dev    # http://localhost:3000
```

Backend scripts: `npm test` (resets and uses the `absen_test` database), `npm run db:studio` (browse data),
`npm run db:reset` (wipe and re-seed the dev database).

> On this machine the local secrets are already set up: `backend/.env`, `backend/.env.test`, `frontend/.env.local`,
> and the PostgreSQL superuser password in `backend/.pg-superuser-password`. None of these are committed.

Demo accounts (dev seed, password `demo123`): `siti@ista.ac.id` (lecturer), `bambang@ista.ac.id` (approver),
`admin@ista.ac.id` (admin). The demo list on the login page is hidden in production builds.

## Database: PostgreSQL (default) or MySQL

The backend runs on **PostgreSQL** or **MySQL 8**. It picks the database from `DATABASE_URL` in `backend/.env`:

```
DATABASE_URL=postgresql://absen:PASSWORD@localhost:5432/absen?schema=public   # PostgreSQL
DATABASE_URL=mysql://absen:PASSWORD@localhost:3306/absen                     # MySQL
```

- `prisma/schema.prisma` is the single source of truth. `scripts/prisma.mjs` (used by every `npm run db:*` script)
  generates `prisma/mysql/schema.prisma` from it when the URL is `mysql://`. Only the provider line differs.
  **Never edit the MySQL copy by hand.**
- Migrations are separate per database: `prisma/migrations` (PostgreSQL) and `prisma/mysql/migrations` (MySQL).
  After changing the schema, create a migration for **both** (run `npm run db:migrate` once with each `DATABASE_URL`).
- **Production MySQL is set up by the client's DBA from plain SQL files** in `deploy/mysql/`, not by Prisma.
  After a schema change: run `node scripts/build-mysql-sql.mjs` (regenerates `001_create_tables.sql` for new
  installs), write a numbered `deploy/mysql/00N_*.sql` update for existing ones (copy the new MySQL migration;
  keep table names in PascalCase — MySQL on Windows lowercases them), make it and both Prisma migrations insert the
  next `SchemaVersion` row, and bump `REQUIRED_SCHEMA_VERSION` in `src/lib/schema-version.ts`.
- The generated Prisma client is specific to one database. `npm install` and `npm run db:generate` build it for
  whatever `.env` points at; switching databases means running `npm run db:generate` again.
- Differences handled in code: case-insensitive search (`src/lib/db-dialect.ts`) and duplicate-email/NIP errors.
- Use a **separate database** for this app (e.g. `CREATE DATABASE absen CHARACTER SET utf8mb4`), with a user that has
  all privileges on it. MySQL 8.0+ recommended (tested on 8.4).

### Testing on MySQL

`npm run test:mysql` runs all backend tests against the database in `backend/.env.test.mysql`
(`DATABASE_URL` must point at an `absen_test` database), then switches the client back to `.env`.
`npm test` stays on PostgreSQL. Both must pass.

> On this machine MySQL 8.4 is installed (`C:\Program Files\MySQL\MySQL Server 8.4`) but **not as a Windows
> service**. Its data lives in `%LOCALAPPDATA%\absen-mysql`. Start it when needed:
> `"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file="%LOCALAPPDATA%\absen-mysql\my.ini" --console`
> Root password: `backend/.mysql-root-password`; app settings: `backend/.env.mysql` and `backend/.env.test.mysql`
> (all git-ignored).

## Status

| Phase | What | State |
|---|---|---|
| 1 | All screens, ID/EN, light/dark, responsive | ✅ done |
| 2 | Database, real login, profile photo + preferences in DB | ✅ done |
| 3 | Attendance API, server-signed rotating QR, kiosk pairing, QR locations, nightly clock-out job | ✅ done |
| 4 | Leave API: requests, balance, approvals, admin views | ✅ done |
| 5 | Staff management, one-time passwords, password change, holidays, monthly recap | ✅ done |
| 6 | Docker deployment (files + guide ready, see DEPLOY.md); real-server + real-phone testing | in progress |

**All data comes from the database.** The phase-1 browser sample data is gone.

## How auth works (phase 2)

- `POST /api/auth/login` checks the bcrypt password hash and sets an **httpOnly** `absen_session` cookie
  holding a signed JWT (HS256, 12 h). Page scripts can't read it. Login is rate-limited (10 tries / 15 min per email + IP),
  and wrong password, unknown email and inactive account all get the same answer.
- The browser only calls `/api/*` on the frontend's own origin; Next.js proxies it to Express (`next.config.ts`).
- `frontend/src/middleware.ts` verifies the JWT (shared `JWT_SECRET`) for page routing and role checks.
- Every API request re-loads the user from the database, so deactivating someone or changing their role applies
  immediately. The app layout loads `GET /api/me`; if the backend refuses the session it goes to `/logout?expired=1`.
- Language and theme are saved to the user's profile (`PATCH /api/me/preferences`) and applied at login,
  so they follow the user across devices.

### API so far

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | |
| POST | `/api/auth/login` | `{ email, password }` → `{ user }` + session cookie |
| POST | `/api/auth/logout` | clears the cookie |
| GET | `/api/me` | `{ user }` incl. `photoUrl`, `locale`, `theme` |
| PATCH | `/api/me/preferences` | `{ locale?: "id"\|"en", theme?: "light"\|"dark" }` |
| PUT | `/api/me/photo` | multipart field `photo`; JPG/PNG/WebP ≤ 5 MB |
| DELETE | `/api/me/photo` | |
| GET | `/api/users/:id/photo` | image bytes (login required) |
| POST | `/api/attendance/scan` | `{ token, action: "in"\|"out" }` → `{ record, location }` |
| GET | `/api/attendance/me/overview` | today, last 5, month count, open missing clock-outs, deductions this year |
| GET | `/api/attendance/me?month=YYYY-MM` | one month of my records |
| GET | `/api/attendance/me/corrections` | open missing clock-outs + last year of fixes/deductions |
| PATCH | `/api/attendance/:id/fix` | `{ time: "HH:mm", reason }` (own record, within 2 months) |
| GET | `/api/kiosk/:locationId/token` | header `X-Kiosk-Key`; current QR token + seconds left |
| GET | `/api/admin/overview` | admin: today's counts |
| GET | `/api/admin/attendance?date=&status=&q=` | admin: everyone's records |
| GET/POST/PATCH | `/api/admin/locations[/:id]` | admin: QR locations |
| GET | `/api/admin/locations/:id/qr` | admin: the location's current code + `validUntil` (for **Unduh QR**; expires like a kiosk code, ~60 s) |
| POST | `/api/admin/locations/:id/kiosk-key` | admin: pair a kiosk screen (returns the key once) |
| GET | `/api/leave/me` | my requests + balance |
| POST | `/api/leave` | `{ start, end, reason }` |
| DELETE | `/api/leave/:id` | cancel my pending request |
| GET | `/api/leave/pending` | approver/admin: waiting requests with balance + overlapping leave |
| GET | `/api/leave/decided` | approver/admin: last 100 decisions |
| POST | `/api/leave/:id/decision` | approver/admin: `{ approve, note? }` (note required to reject) |
| GET | `/api/admin/leave?status=&q=` | admin: all requests |
| GET | `/api/admin/leave-balances` | admin: this year's balance per user |
| PUT | `/api/me/password` | `{ currentPassword, newPassword }`: ends other sessions, renews this one |
| GET | `/api/admin/users?q=&role=` | admin: staff list with leave balance |
| POST | `/api/admin/users` | admin: create account → `{ user, tempPassword }` (shown once) |
| PATCH | `/api/admin/users/:id` | admin: edit name/email/NIP/unit/role/quota/active |
| POST | `/api/admin/users/:id/reset-password` | admin: new one-time password, ends their sessions |
| DELETE | `/api/admin/users/:id` | admin: permanent delete, only for accounts with no attendance/leave history (else `HAS_HISTORY` → deactivate instead) |
| GET | `/api/holidays?year=` | holidays for that year (+ next January) |
| PUT/DELETE | `/api/admin/holidays/:date` | admin: add/rename or remove a holiday |
| GET | `/api/admin/reports/monthly?month=YYYY-MM` | admin: per-person present / late / leave / absent / missing / fixed / deducted |
| GET | `/api/dev/qr` | **development only** (not mounted in production): a valid token for the "simulate scan" button |

## How the rotating QR works (phase 3)

- Each location has a secret `qrSecret` that never leaves the server. The kiosk shows
  `ISTA2.<locationId>.<slot>.<HMAC-SHA256(secret, "<locationId>.<slot>")>`, where `slot` changes every 30 s.
- A scan is accepted for the code's own slot and the next one, so a photo of the screen stops working within 60 s.
  The server also checks the location is active, and uses **its own clock** for the time and date (Asia/Jakarta).
- One record per person per day is enforced by a unique index. Double clock-ins and double clock-outs are refused
  even if two scans arrive at the same moment.
- **Kiosk pairing:** an admin opens *QR Locations → Open kiosk screen*. That creates a new random kiosk key
  (only its SHA-256 hash is stored) and opens `/kiosk/<id>#key=…`. The screen keeps the key in its browser and
  sends it as `X-Kiosk-Key`. Pairing again replaces the key, so the old screen stops working.
- **Nightly job** (00:05 WIB, and once at backend startup): yesterday's open clock-ins become `MISSING_CLOCK_OUT`;
  missing clock-outs past the 2-month deadline become `DEDUCTED`.

## Accounts and passwords (phase 5)

- Admins create accounts in **Data Pegawai**. The server generates a 10-character **one-time password**, shown once
  (copy button). The person must choose a new password at first sign-in: until then the API only allows `/api/me`
  routes, and the app sends them to `/settings/password`.
- **Reset password** does the same for an existing account and signs them out everywhere.
- Password rules: at least 8 characters, with letters and digits. Everyone can change theirs in **Settings**.
- Every session token carries the user's `sessionVersion`. Changing or resetting a password, or deactivating
  the account, bumps it, so all older sessions stop working immediately.
- Admins can't change their own role, deactivate themselves, or reset their own password from the staff page.
- **Deleting** is only for accounts with no attendance or leave history (e.g. created by mistake). Anyone with history
  is **deactivated** instead: they can't sign in, but their records and monthly recaps are kept.

## Holidays

- Admin page **Hari Libur**. Fixed-date national holidays (1 Jan, 1 May, 1 Jun, 17 Aug, 25 Dec) are seeded for this
  year and next. **Holidays that move every year (Idul Fitri, Idul Adha, Nyepi, Waisak, Imlek, Isra Mi'raj, …) must be
  added by an admin** from the official SKB 3 Menteri list.
- Leave days skip weekends and holidays (form and server count the same way). Adding a holiday later does not
  change requests that already exist.
- The monthly recap counts working days without weekends and holidays, and absences only from the day a person joined.

## Profile pictures

- Stored in table `UserPhoto { userId, data BYTEA, mimeType, size, updatedAt }`, separate from `User`
  so user lists never load images.
- The server re-encodes every upload: rotation fixed, cropped square, 320 px JPEG, metadata stripped.
  Files that aren't real images are rejected.
- `user.photoUrl` is `/api/users/<id>/photo?v=<updatedAt>`, or `null` → the frontend shows
  `public/avatar-placeholder.svg` (also used if the image fails to load).

## Business rules

Enforced by the backend:
- QR token valid for its own 30-second slot and the next one only.
- One clock-in and one clock-out per day.
- A day without clock-out becomes `MISSING_CLOCK_OUT`; the lecturer fixes it with a time (after clock-in, not in the
  future) and a reason (min. 10 chars).
- Not fixed within 2 months → `DEDUCTED`, 1 day of annual leave.
- Clock-in after 08:00 WIB is marked late.
- A QR can be read with the camera **or from an uploaded image** (photo/screenshot), decoded in the browser with
  `html5-qrcode`. Each clock-in/out stores its method (`inMethod`/`outMethod`: `CAMERA` or `UPLOAD`); uploads show an
  **Unggah** tag in Absensi Harian and are counted in the monthly recap (**Via unggahan**). The method is reported by
  the app, so it is a review aid, not proof. The code must still be valid (≤ 60 s), exactly like a camera scan.

Leave (phase 4):
- Days are counted as working days: Mon–Fri, minus holidays.
- Balance per calendar year: `remaining = quota − approved − deducted`; `available = remaining − pending`.
  A new request must fit in `available`; a request can't cross into the next year (split it in two).
- No overlapping PENDING/APPROVED requests for the same person. Start date can't be in the past.
- Any approver or admin can decide any request, except their own. Rejecting requires a note.
  Approval re-checks the balance at that moment. Only PENDING requests can be cancelled (by the owner).
- Balance checks run in serializable transactions, so two requests sent at the same moment can't overspend.
