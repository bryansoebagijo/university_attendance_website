# ISTA Presensi — backend (Express + Prisma)
#
#   docker build --build-arg DB_PROVIDER=mysql -t ista-absen-backend ./backend
#
# DB_PROVIDER (mysql | postgresql) must match the database in DATABASE_URL at runtime:
# the generated Prisma client is specific to one database type.

# ---- Build: install everything, compile TypeScript -------------------------------
FROM node:22-bookworm-slim AS build
# OpenSSL is needed by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG DB_PROVIDER=mysql
ENV DB_PROVIDER=$DB_PROVIDER
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY prisma ./prisma
# postinstall generates the Prisma client for DB_PROVIDER
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime: production dependencies + compiled code only ----------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG DB_PROVIDER=mysql
ENV DB_PROVIDER=$DB_PROVIDER \
    NODE_ENV=production \
    PORT=4000
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Run as the unprivileged "node" user that the base image provides.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply any pending database migrations, then start the API (which also runs the nightly job).
CMD ["sh", "-c", "node scripts/prisma.mjs migrate deploy && exec node dist/index.js"]
