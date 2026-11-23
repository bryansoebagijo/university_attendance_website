# ISTA Presensi — frontend (Next.js, standalone server)
#
#   docker build --build-arg API_URL=http://backend:4000 -t ista-absen-frontend ./frontend
#
# API_URL is baked in at build time for the /api proxy. JWT_SECRET is NOT baked in:
# pass it at runtime (docker compose does this from .env).

# ---- Dependencies -----------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build --------------------------------------------------------------------------
FROM deps AS build
COPY . .
ARG API_URL=http://backend:4000
ENV API_URL=$API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runtime: only the standalone server + static files ----------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG API_URL=http://backend:4000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_URL=$API_URL
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
