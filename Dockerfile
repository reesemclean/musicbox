# ============================================================================
# MusicBox Docker Image
# Unified build - Web + API in single package
# ============================================================================

FROM node:22-alpine AS base
RUN apk add --no-cache tini python3

# --- Build Stage ---
FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app/packages/web
COPY packages/web/package*.json ./
RUN npm ci

COPY packages/web/ ./
RUN npm run build

# --- Production Image ---
FROM base AS production

WORKDIR /app

# Copy build output
COPY --from=builder /app/packages/web/dist ./dist

# Install production dependencies
COPY packages/web/package*.json ./
RUN npm ci --omit=dev

# Copy runtime files
COPY packages/web/drizzle ./drizzle
COPY packages/web/seed-data ./seed-data

# Firmware is provided via shared volume from firmware-builder container
# (see docker-compose.yml)

# Create data directories
RUN mkdir -p /data /data/songs /data/podcasts /data/soundmachine /data/sounds

# Environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=/data/musicbox.db
ENV DATA_DIR=/data
ENV PORT=3000
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/server.js"]
