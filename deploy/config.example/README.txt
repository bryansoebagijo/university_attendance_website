Server configuration for ISTA Presensi. Lives OUTSIDE the release folders.
deploy.sh creates it on the first install (template app.env, generated secrets, permissions).
The manual steps below are only needed without deploy.sh.

  /opt/ista-absen/config/app.env          settings (HR database host/name/user, sync options, ...)
  /opt/ista-absen/config/jwt_secret       session signing key: one line, 64 hex characters
  /opt/ista-absen/config/db_password      password of the app's own PostgreSQL: one line, set once
  /opt/ista-absen/config/hr_db_password   password of the read-only MariaDB user ista_absen_reader
                                          (empty when HR_DB_HOST is empty)
  /opt/ista-absen/config/license.key      license file from the developer (deploy.sh license <file>)

Create the secrets:
  openssl rand -hex 32 | tr -d '\n' > /opt/ista-absen/config/jwt_secret
  openssl rand -hex 24 | tr -d '\n' > /opt/ista-absen/config/db_password
  printf '%s' 'the-hr-reader-password' > /opt/ista-absen/config/hr_db_password

Permissions (the containers run as uid 1000; the PostgreSQL container also reads db_password):
  chmod 750 /opt/ista-absen/config
  chmod 600 /opt/ista-absen/config/app.env
  chown 1000:1000 /opt/ista-absen/config/jwt_secret /opt/ista-absen/config/db_password /opt/ista-absen/config/hr_db_password /opt/ista-absen/config/license.key
  chmod 400 /opt/ista-absen/config/jwt_secret /opt/ista-absen/config/hr_db_password
  chmod 444 /opt/ista-absen/config/db_password /opt/ista-absen/config/license.key

Never change db_password after the database was created. Keep a copy of all secrets in the
institution's password manager. Never commit or email them.
