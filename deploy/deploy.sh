#!/usr/bin/env bash
# =============================================================================================
# ISTA Presensi — offline installer: install / update / roll back from a release zip.
# Works without internet: the zip contains the built app, the runtime image and (optionally) Docker.
#
#   sudo bash deploy.sh install-docker ista-absen-<version>.zip   only if Docker is not installed yet
#   sudo bash deploy.sh install ista-absen-<version>.zip          first install, or update to a new version
#   sudo bash deploy.sh status                                     versions, containers, health
#   sudo bash deploy.sh logs [backend|frontend]                    follow the logs (Ctrl+C to stop)
#   sudo bash deploy.sh restart                                    restart both containers
#   sudo bash deploy.sh rollback                                   go back to the previous version
#   sudo bash deploy.sh create-admin --email … --name "…" --nip …
#   sudo bash deploy.sh license <license file>                     install or renew the license
#   sudo bash deploy.sh backup                                     back up the database now (also runs daily)
#   sudo bash deploy.sh restore <backup file>                      restore the database from a backup
#   sudo bash deploy.sh stop | start
#
# Layout (ISTA_HOME, default /opt/ista-absen):
#   releases/ista-absen-<version>/   each installed version (the last 3 are kept)
#   app -> releases/…                symlink to the version that runs
#   config/                          app.env and secret files — created on first install
#   backups/                         daily database backups (last 14 kept)
# =============================================================================================
set -euo pipefail

ISTA_HOME="${ISTA_HOME:-/opt/ista-absen}"
RELEASES="$ISTA_HOME/releases"
CONFIG="$ISTA_HOME/config"
APP="$ISTA_HOME/app"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}" # seconds
ASSUME_YES="${ASSUME_YES:-false}"
IMAGES=("ista-absen-node:22-distroless" "ista-absen-postgres:17")
BACKUPS="$ISTA_HOME/backups"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() {
  printf '\033[31m✘ %s\033[0m\n' "$*" >&2
  exit 1
}

compose() { (cd "$APP" && ISTA_CONFIG_DIR="$CONFIG" docker compose "$@"); }

confirm() {
  [ "$ASSUME_YES" = "true" ] && return 0
  local answer
  read -r -p "  $1 [y/N] " answer || true
  [[ "$answer" =~ ^[YyJj]$ ]]
}

need_root() { [ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash $0 $*"; }

# ---- Zip handling: unzip if available, otherwise Python (offline servers may lack unzip) -------------
zip_tool() {
  if [ -n "${ZIP_TOOL:-}" ]; then echo "$ZIP_TOOL" # testing override: unzip | python3
  elif command -v unzip >/dev/null; then echo unzip
  elif command -v python3 >/dev/null; then echo python3
  else die "Neither unzip nor python3 is available to open the zip."
  fi
}
zip_test() {
  if [ "$(zip_tool)" = unzip ]; then unzip -tq "$1" >/dev/null 2>&1
  else python3 -c 'import sys,zipfile; sys.exit(0 if zipfile.ZipFile(sys.argv[1]).testzip() is None else 1)' "$1" 2>/dev/null
  fi
}
zip_list() {
  if [ "$(zip_tool)" = unzip ]; then unzip -Z1 "$1"
  else python3 -c 'import sys,zipfile; print("\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))' "$1"
  fi
}
# zip_extract <zip> <dest> [path prefix inside the zip]
zip_extract() {
  if [ "$(zip_tool)" = unzip ]; then
    if [ -n "${3:-}" ]; then unzip -q "$1" "$3*" -d "$2"; else unzip -q "$1" -d "$2"; fi
  else
    python3 - "$1" "$2" "${3:-}" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
z.extractall(sys.argv[2], [n for n in z.namelist() if n.startswith(sys.argv[3])])
PY
  fi
}
# The zip's file list, read once (piping it into grep -q/head would trip "set -o pipefail").
ZIP_LISTING=""
read_listing() { ZIP_LISTING="$(zip_list "$1")"; }
zip_has() { grep -qx -- "$1" <<<"$ZIP_LISTING"; }
release_name() {
  local first="${ZIP_LISTING%%$'\n'*}"
  local name="${first%%/*}"
  [[ "$name" == ista-absen-* ]] || die "$1 is not an ISTA Presensi release (expected a folder ista-absen-<version> inside)."
  echo "$name"
}
verify_checksum() {
  local zip="$1" sums
  sums="$(dirname "$zip")/SHA256SUMS"
  if [ -f "$sums" ] && command -v sha256sum >/dev/null; then
    (cd "$(dirname "$zip")" && grep " $(basename "$zip")\$" SHA256SUMS | sha256sum -c --status) || die "Checksum mismatch: the zip is damaged or changed. Copy it again."
    ok "Checksum OK"
  fi
}

check_docker() {
  command -v docker >/dev/null || die "Docker is not installed. Install it from the zip:  sudo bash $0 install-docker <zip>   (guide, section 3)"
  docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing. Install it from the zip:  sudo bash $0 install-docker <zip>"
  docker info >/dev/null 2>&1 || die "Docker is not running:  sudo systemctl start docker"
}

current_release() { [ -L "$APP" ] && basename "$(readlink -f "$APP")" || true; }
previous_release() {
  local cur
  cur="$(current_release)"
  ls -1 "$RELEASES" 2>/dev/null | grep -v -x -F "$cur" | sort | tail -n 1 || true
}

# ---- Configuration (first install) -------------------------------------------------------------
random_secret() {
  if command -v openssl >/dev/null; then openssl rand -hex 32; else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

prepare_config() {
  local release_dir="$1"
  mkdir -p "$CONFIG"
  # Only root may enter the folder; the files inside are then safe even where containers need to read them.
  chmod 750 "$CONFIG"
  if [ ! -f "$CONFIG/app.env" ]; then
    cp "$release_dir/deploy/config.example/app.env" "$CONFIG/app.env"
    ok "Created $CONFIG/app.env (from the template)"
  fi
  if [ ! -s "$CONFIG/jwt_secret" ] || grep -q REPLACE "$CONFIG/jwt_secret"; then
    random_secret | tr -d '\r\n' >"$CONFIG/jwt_secret"
    ok "Generated a new session secret in $CONFIG/jwt_secret"
  fi
  # Password of the app's own PostgreSQL: generated once. Never change it by hand after the first start.
  if [ ! -s "$CONFIG/db_password" ] || grep -q REPLACE "$CONFIG/db_password"; then
    random_secret | tr -d '\r\n' >"$CONFIG/db_password"
    ok "Generated the password of the app's own database in $CONFIG/db_password"
  fi
  # Read-only password for the campus HR database (empty until filled in).
  [ -f "$CONFIG/hr_db_password" ] || : >"$CONFIG/hr_db_password"
  # The license file must exist for Docker (empty = no license yet: the app runs read-only).
  [ -f "$CONFIG/license.key" ] || : >"$CONFIG/license.key"
  chmod 600 "$CONFIG/app.env"
  # Containers read these as Docker secret files: the app runs as uid 1000; PostgreSQL as its own user.
  chown 1000:1000 "$CONFIG/jwt_secret" "$CONFIG/hr_db_password" "$CONFIG/license.key" "$CONFIG/db_password"
  chmod 400 "$CONFIG/jwt_secret" "$CONFIG/hr_db_password"
  chmod 444 "$CONFIG/license.key" "$CONFIG/db_password"
}

config_problems() {
  local p=() hr_host hr_name
  grep -Eq '^CORS_ORIGIN=https://absen\.example\.ac\.id' "$CONFIG/app.env" && p+=("app.env: set CORS_ORIGIN to the real https:// address of the app")
  hr_host="$(grep -E '^HR_DB_HOST=' "$CONFIG/app.env" | cut -d= -f2- | tr -d '[:space:]')"
  hr_name="$(grep -E '^HR_DB_NAME=' "$CONFIG/app.env" | cut -d= -f2- | tr -d '[:space:]')"
  if [ -n "$hr_host" ]; then
    [ -n "$hr_name" ] || p+=("app.env: HR_DB_HOST is set, so HR_DB_NAME (the database that holds hr_staff_info) is needed too")
    [ -s "$CONFIG/hr_db_password" ] || p+=("hr_db_password is empty: write the password of the HR read-only user into $CONFIG/hr_db_password (or empty HR_DB_HOST to run without HR)")
  fi
  [ "${#p[@]}" -eq 0 ] && return 0
  printf '%s\n' "${p[@]}"
  return 1
}

hr_configured() { grep -Eq '^HR_DB_HOST=[^[:space:]]+' "$CONFIG/app.env"; }

# ---- Health --------------------------------------------------------------------------------------
health_of() {
  local id
  id="$(compose ps -a -q "$1" 2>/dev/null || true)"
  [ -n "$id" ] || {
    echo "missing"
    return
  }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo "missing"
}

wait_healthy() {
  local start=$SECONDS last="" b f
  bold "Waiting for the app to start (usually under a minute)…"
  while :; do
    b="$(health_of backend)"
    f="$(health_of frontend)"
    if [ "$b" = "healthy" ] && [ "$f" = "healthy" ]; then
      ok "backend: healthy, frontend: healthy ($((SECONDS - start)) s)"
      return 0
    fi
    if [ "$b" = "unhealthy" ] || [ "$b" = "exited" ] || [ "$f" = "unhealthy" ] || [ "$f" = "exited" ]; then
      warn "backend: $b, frontend: $f"
      return 1
    fi
    if [ "$b/$f" != "$last" ]; then
      info "$((SECONDS - start)) s — backend: $b, frontend: $f"
      last="$b/$f"
    fi
    [ $((SECONDS - start)) -ge "$HEALTH_TIMEOUT" ] && {
      warn "Still not healthy after $HEALTH_TIMEOUT s."
      return 1
    }
    sleep 3
  done
}

show_failure() {
  warn "Last backend log lines:"
  compose logs --tail=25 backend 2>&1 | sed 's/^/    /' || true
  warn "Last frontend log lines:"
  compose logs --tail=15 frontend 2>&1 | sed 's/^/    /' || true
  echo
  info "Fix the cause (see the guide, section 14), then:  sudo bash $0 restart"
  local prev
  prev="$(previous_release)"
  [ -n "$prev" ] && info "Or go back to the previous version ($prev):  sudo bash $0 rollback"
}

# ---- Commands ---------------------------------------------------------------------------------------
cmd_install() {
  local zip="${1:-}"
  [ -n "$zip" ] || die "Usage: sudo bash $0 install ista-absen-<version>.zip"
  [ -f "$zip" ] || die "File not found: $zip"
  need_root install "$zip"
  check_docker
  zip_test "$zip" || die "$zip is not a valid zip file (damaged or incomplete copy?)."
  read_listing "$zip"
  local name
  name="$(release_name "$zip")"
  zip_has "$name/docker-compose.yml" || die "$zip is incomplete (no docker-compose.yml)."
  zip_has "$name/images/ista-absen-node.tar" || die "$zip is incomplete (no runtime image)."
  bold "Installing $name into $ISTA_HOME"
  verify_checksum "$zip"

  mkdir -p "$RELEASES"
  local target="$RELEASES/$name" tmp
  if [ -d "$target" ]; then
    [ "$(current_release)" = "$name" ] && warn "$name is already the running version; it will be unpacked again and restarted."
    rm -rf "$target"
  fi
  tmp="$(mktemp -d "$RELEASES/.unpack.XXXXXX")"
  zip_extract "$zip" "$tmp"
  mv "$tmp/$name" "$target"
  rm -rf "$tmp"
  # Readable by the containers (uid 1000).
  chmod -R a+rX "$target"
  ok "Unpacked to $target"

  prepare_config "$target"
  local problems
  if ! problems="$(config_problems)"; then
    echo
    warn "Configuration needed before the first start:"
    printf '%s\n' "$problems" | sed 's/^/    - /'
    echo
    info "Edit:  nano $CONFIG/app.env      and      nano $CONFIG/db_password"
    info "(also set TEACHER_SOURCE_QUERY in app.env to sync teachers — see the guide, section 6)"
    info "The database must be set up by the DBA first (guide, section 5)."
    info "Then run again:  sudo bash $0 install $zip"
    exit 0
  fi

  # Database scripts that are new compared to the running version.
  local cur new_sql=()
  cur="$(current_release)"
  if [ -n "$cur" ] && [ "$cur" != "$name" ] && [ -d "$RELEASES/$cur/deploy/mysql" ]; then
    while IFS= read -r f; do
      [ -e "$RELEASES/$cur/deploy/mysql/$f" ] || new_sql+=("$f")
    done < <(cd "$target/deploy/mysql" && ls -1 *.sql | grep -E '^[0-9]{3}_' | grep -v -E '^(000|001|010)_')
  fi
  if [ "${#new_sql[@]}" -gt 0 ]; then
    echo
    warn "This version includes NEW database scripts. The DBA must run them before the app starts:"
    for f in "${new_sql[@]}"; do info "mysql -u root -p ista_absen < $target/deploy/mysql/$f"; done
    confirm "Have these scripts been run on the database?" || die "Stopped. Run the scripts, then: sudo bash $0 install $zip"
  fi

  # The runtime image ships inside the release (no Docker Hub needed).
  # The runtime images ship inside the release (no Docker Hub needed).
  bold "Loading the runtime images…"
  local tar img
  for tar in "$target"/images/*.tar; do docker load -i "$tar" | sed 's/^/  /'; done
  for img in "${IMAGES[@]}"; do docker image inspect "$img" >/dev/null 2>&1 || die "Image $img not found after docker load."; done

  # Switch the "app" symlink atomically, then recreate the containers on the new code.
  ln -sfn "releases/$name" "$ISTA_HOME/app.new"
  mv -Tf "$ISTA_HOME/app.new" "$APP"
  ok "Active version: $name${cur:+ (was $cur)}"

  bold "Starting containers…"
  compose up -d --force-recreate --remove-orphans

  if wait_healthy; then
    prune_releases
    echo
    ok "ISTA Presensi $name is running."
    info "Local check:  curl -I http://127.0.0.1:3000/login"
    install_backup_timer
    if hr_configured; then
      info "Staff are imported from the HR database at the first start (see Dashboard → Sinkronisasi data dosen)."
    else
      warn "No HR database configured (HR_DB_HOST in app.env): add staff by hand in Data Pegawai, or fill it in and restart."
    fi
    show_license || true
    [ -z "$cur" ] && info "First install: create the first administrator —  sudo bash $0 create-admin --email … --name \"…\" --nip …"
  else
    show_failure
    exit 1
  fi
}

cmd_install_docker() {
  local zip="${1:-}"
  [ -n "$zip" ] || die "Usage: sudo bash $0 install-docker ista-absen-<version>.zip"
  [ -f "$zip" ] || die "File not found: $zip"
  need_root install-docker "$zip"
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    ok "Docker is already installed ($(docker --version)). Nothing to do."
    return 0
  fi
  command -v systemctl >/dev/null || die "systemd is required for the bundled Docker installer."
  command -v iptables >/dev/null || warn "iptables not found: Docker needs it for container networking (install the iptables package from the OS media)."
  zip_test "$zip" || die "$zip is not a valid zip file."
  verify_checksum "$zip"
  read_listing "$zip"
  local name tmp dir
  name="$(release_name "$zip")"
  grep -q "^$name/offline/docker/docker-" <<<"$ZIP_LISTING" || die "This release was built without the Docker installer (--no-docker-installer)."
  tmp="$(mktemp -d)"
  zip_extract "$zip" "$tmp" "$name/offline/docker/"
  dir="$tmp/$name/offline/docker"
  (cd "$dir" && sha256sum -c --status SHA256SUMS) || die "Docker installer files are damaged (checksum mismatch)."

  bold "Installing Docker Engine and Compose from the release (official static binaries)…"
  tar -xzf "$dir"/docker-*.tgz -C "$tmp"
  install -m 0755 "$tmp"/docker/* /usr/bin/
  mkdir -p /usr/local/lib/docker/cli-plugins
  install -m 0755 "$dir/docker-compose-linux-x86_64" /usr/local/lib/docker/cli-plugins/docker-compose
  getent group docker >/dev/null || groupadd --system docker

  cat >/etc/systemd/system/containerd.service <<'UNIT'
[Unit]
Description=containerd container runtime
After=network.target local-fs.target

[Service]
ExecStartPre=-/sbin/modprobe overlay
ExecStart=/usr/bin/containerd
Type=notify
Delegate=yes
KillMode=process
Restart=always
RestartSec=5
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
OOMScoreAdjust=-999

[Install]
WantedBy=multi-user.target
UNIT
  cat >/etc/systemd/system/docker.socket <<'UNIT'
[Unit]
Description=Docker Socket for the API

[Socket]
ListenStream=/run/docker.sock
SocketMode=0660
SocketUser=root
SocketGroup=docker

[Install]
WantedBy=sockets.target
UNIT
  cat >/etc/systemd/system/docker.service <<'UNIT'
[Unit]
Description=Docker Application Container Engine
After=network-online.target docker.socket firewalld.service containerd.service time-set.target
Wants=network-online.target containerd.service
Requires=docker.socket

[Service]
Type=notify
ExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutStartSec=0
RestartSec=2
Restart=always
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
Delegate=yes
KillMode=process
OOMScoreAdjust=-500

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now containerd.service docker.socket docker.service
  for _ in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null 2>&1 || die "Docker did not start: journalctl -u docker -n 50"
  rm -rf "$tmp"
  ok "$(docker --version)"
  ok "$(docker compose version)"
}

# ---- License --------------------------------------------------------------------------------------
show_license() {
  echo
  bold "License"
  if [ ! -s "$CONFIG/license.key" ]; then
    warn "No license installed: the app runs in READ-ONLY mode (no attendance, leave or changes)."
    info "Install the license file from the developer:  sudo bash $0 license <file>"
    return 1
  fi
  compose exec -T backend /nodejs/bin/node dist/cli/license-status.js 2>/dev/null | sed 's/^/  /'
  local rc=${PIPESTATUS[0]}
  [ "$rc" -eq 2 ] && warn "The app is in READ-ONLY mode until a valid license is installed."
  return 0
}

cmd_license() {
  local file="${1:-}"
  [ -n "$file" ] || die "Usage: sudo bash $0 license <license file>"
  [ -f "$file" ] || die "File not found: $file"
  need_root license "$file"
  grep -q "BEGIN ISTA PRESENSI LICENSE" "$file" || die "$file is not an ISTA Presensi license file."
  mkdir -p "$CONFIG"
  # Overwrite in place (same file): the running app sees the new content within a minute, no restart.
  [ -f "$CONFIG/license.key" ] && chmod 644 "$CONFIG/license.key"
  tr -d '\r' <"$file" >"$CONFIG/license.key"
  chown 1000:1000 "$CONFIG/license.key"
  chmod 444 "$CONFIG/license.key"
  ok "License installed in $CONFIG/license.key"
  sed -n '2,5p' "$CONFIG/license.key" | sed 's/^/  /'
  if [ -L "$APP" ] && [ "$(health_of backend)" = "healthy" ]; then
    show_license || true
    info "The running app picks up the new license within a minute (no restart needed)."
  fi
}

# ---- Database backups -------------------------------------------------------------------------------
cmd_backup() {
  need_root backup
  mkdir -p "$BACKUPS"
  chmod 700 "$BACKUPS"
  local file
  file="$BACKUPS/ista_absen-$(date +%Y%m%d-%H%M%S).dump"
  compose exec -T db pg_dump -U ista_absen -d ista_absen -Fc >"$file.part" || {
    rm -f "$file.part"
    die "Backup failed (is the app running?  sudo bash $0 status)"
  }
  mv "$file.part" "$file"
  ok "Backup written: $file ($(du -h "$file" | cut -f1))"
  ls -1t "$BACKUPS"/ista_absen-*.dump 2>/dev/null | tail -n "+$((KEEP_BACKUPS + 1))" | while IFS= read -r old; do
    rm -f "$old"
    info "Removed old backup $(basename "$old")"
  done
}

cmd_restore() {
  local file="${1:-}"
  [ -n "$file" ] || die "Usage: sudo bash $0 restore <backup file>   (backups are in $BACKUPS)"
  [ -f "$file" ] || die "File not found: $file"
  need_root restore "$file"
  warn "This replaces ALL current data with the backup $(basename "$file")."
  warn "A safety backup of the current data is made first."
  confirm "Continue?" || exit 0
  cmd_backup
  compose stop frontend backend
  compose exec -T db pg_restore -U ista_absen -d ista_absen --clean --if-exists --no-owner <"$file" ||
    warn "pg_restore reported problems (often harmless notices); check the app."
  compose up -d
  wait_healthy && ok "Restored from $(basename "$file")." || {
    show_failure
    exit 1
  }
}

# Daily backup at 01:30 (systemd timer), installed with the app.
install_backup_timer() {
  command -v systemctl >/dev/null || {
    warn "systemd not found: schedule  sudo bash $APP/deploy/deploy.sh backup  daily yourself (cron)."
    return 0
  }
  cat >/etc/systemd/system/ista-absen-backup.service <<UNIT
[Unit]
Description=ISTA Presensi database backup

[Service]
Type=oneshot
Environment=ISTA_HOME=$ISTA_HOME
ExecStart=/bin/bash $APP/deploy/deploy.sh backup
UNIT
  cat >/etc/systemd/system/ista-absen-backup.timer <<'UNIT'
[Unit]
Description=Daily ISTA Presensi database backup

[Timer]
OnCalendar=*-*-* 01:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now ista-absen-backup.timer >/dev/null 2>&1 && ok "Daily database backup scheduled (01:30, last $KEEP_BACKUPS kept in $BACKUPS)"
}

cmd_rollback() {
  need_root rollback
  check_docker
  local cur prev
  cur="$(current_release)"
  prev="$(previous_release)"
  [ -n "$prev" ] || die "No previous version to go back to (installed: $(ls -1 "$RELEASES" 2>/dev/null | tr '\n' ' '))."
  warn "Going back from $cur to $prev."
  warn "Only do this if the newer version did not need new database scripts — the old code may not match a newer database."
  confirm "Continue?" || exit 0
  for tar in "$RELEASES/$prev"/images/*.tar; do docker load -i "$tar" >/dev/null; done
  ln -sfn "releases/$prev" "$ISTA_HOME/app.new"
  mv -Tf "$ISTA_HOME/app.new" "$APP"
  # Keep the newer one aside so it isn't picked as "previous" again.
  mv "$RELEASES/$cur" "$RELEASES/.rolled-back-$cur"
  compose up -d --force-recreate --remove-orphans
  if wait_healthy; then ok "Back on $prev. ($cur was kept in $RELEASES/.rolled-back-$cur)"; else show_failure; exit 1; fi
}

prune_releases() {
  local cur
  cur="$(current_release)"
  ls -1 "$RELEASES" | grep -v -x -F "$cur" | sort | head -n "-$((KEEP_RELEASES - 1))" | while IFS= read -r old; do
    rm -rf "${RELEASES:?}/$old"
    info "Removed old version $old"
  done
  rm -rf "$RELEASES"/.rolled-back-* 2>/dev/null || true
}

cmd_status() {
  [ -L "$APP" ] || die "Not installed in $ISTA_HOME yet."
  bold "ISTA Presensi in $ISTA_HOME"
  info "running version : $(current_release)"
  info "installed       : $(ls -1 "$RELEASES" | tr '\n' ' ')"
  [ -f "$APP/VERSION" ] && sed 's/^/                    /' "$APP/VERSION"
  echo
  compose ps
  echo
  info "database: $(health_of db), backend: $(health_of backend), frontend: $(health_of frontend)"
  local last
  last="$(ls -1t "$BACKUPS"/ista_absen-*.dump 2>/dev/null | head -n 1 || true)"
  info "last backup: ${last:+$(basename "$last") ($(date -r "$last" '+%Y-%m-%d %H:%M'))}${last:-none yet}"
  show_license || true
}

usage() { sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'; }

cmd="${1:-help}"
shift || true
case "$cmd" in
  install | update) cmd_install "$@" ;;
  install-docker) cmd_install_docker "$@" ;;
  license) cmd_license "$@" ;;
  backup) cmd_backup ;;
  restore) cmd_restore "$@" ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  logs) compose logs -f --tail=100 "$@" ;;
  restart)
    need_root restart
    compose up -d --force-recreate
    wait_healthy || {
      show_failure
      exit 1
    }
    ;;
  stop) compose down ;;
  start)
    compose up -d
    wait_healthy || {
      show_failure
      exit 1
    }
    ;;
  create-admin) compose exec backend /nodejs/bin/node dist/cli/create-admin.js "$@" ;;
  help | -h | --help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
