# ============================================================================
# MusicBox Docker Image
# Unified build - Web + API + embedded firmware in single package.
# Firmware is now generic (no baked-in network config), built once at image
# build time and served for OTA updates.
#
# NOTE: Keep Python/Node versions in sync with .mise.toml
# ============================================================================

# --- Firmware Build Stage ---
FROM python:3.13 AS firmware-builder

RUN pip install --no-cache-dir platformio

WORKDIR /build
COPY packages/esp32/ packages/esp32/

# Install platform, toolchain, and libraries with a dummy build
RUN cd packages/esp32 && pio run 2>&1 || true

# Real build
ARG FIRMWARE_VERSION=latest
RUN cd packages/esp32 && FIRMWARE_VERSION=${FIRMWARE_VERSION} pio run

# --- Web Build Stage ---
FROM node:24-alpine AS base
COPY requirements.txt /tmp/requirements.txt
RUN apk add --no-cache tini python3 py3-pip curl ffmpeg && \
    pip install --no-cache-dir --break-system-packages -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

FROM node:24-alpine AS builder

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

# Copy Nitro build output (self-contained server with bundled dependencies)
COPY --from=builder /app/packages/web/.output ./.output

# Copy runtime files
COPY packages/web/drizzle ./drizzle
COPY packages/web/seed-data ./seed-data

# Copy firmware binary and generate manifest
COPY --from=firmware-builder /build/packages/esp32/.pio/build/esp32-s3-devkitc-1/firmware.bin ./firmware/firmware.bin

# Generate firmware manifest
ARG FIRMWARE_VERSION=latest
RUN echo "{\"version\": \"${FIRMWARE_VERSION}\"}" > ./firmware/manifest.json

# Create data directories.
# normalized/ holds canonical derivatives of media whose original isn't already
# in the canonical encoding. The app creates it on demand — an existing volume
# won't pick up new directories from the image — but listing it here keeps the
# expected layout visible in one place.
RUN mkdir -p /data /data/songs /data/podcasts /data/soundmachine /data/sounds /data/normalized

# Environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=/data/musicbox.db
ENV DATA_DIR=/data
ENV PORT=3000
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
