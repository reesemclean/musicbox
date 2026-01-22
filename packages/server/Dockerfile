# Go builder stage - builds ARM64 player binary
FROM golang:1.23-alpine AS go-builder

# Version passed from CI (e.g., 20260118-abc1234)
ARG PLAYER_VERSION=dev

WORKDIR /app

# Copy Go module files
COPY packages/player-go/go.mod packages/player-go/go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY packages/player-go/ ./

# Save version for later stages
RUN echo "${PLAYER_VERSION}" > /app/version.txt

# Cross-compile for ARM64 (Raspberry Pi) with embedded version
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build \
    -ldflags "-s -w -X main.Version=${PLAYER_VERSION}" \
    -o musicbox-player ./cmd/player

# Build hardware test utility
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build \
    -ldflags "-s -w" \
    -o musicbox-hwtest ./cmd/hwtest

# Node.js builder stage - builds server
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy root package files for workspace setup
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (including devDependencies for build)
RUN npm install

# Copy shared package source
COPY packages/shared ./packages/shared

# Copy server source files
COPY packages/server ./packages/server

# Build the application
RUN npm run build --workspace=server


# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies:
# - libstdc++: for better-sqlite3
# - curl: for healthchecks
# - python3 + py3-pip: for ytmusicapi (YouTube Music search)
# - ffmpeg: for audio conversion (used by yt-dlp)
# - yt-dlp: for downloading from YouTube Music
# - ansible + openssh-client: for push-based deployment to Pis
RUN apk add --no-cache libstdc++ curl python3 py3-pip ffmpeg yt-dlp ansible openssh-client && \
    pip3 install --no-cache-dir --break-system-packages ytmusicapi

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application from builder
COPY --from=builder /app/packages/server/.output ./.output
COPY --from=builder /app/packages/server/drizzle ./drizzle
COPY --from=builder /app/packages/server/package.json ./package.json

# Copy Go binaries and version (outside /data so it's not overridden by volume mounts)
COPY --from=go-builder /app/musicbox-player ./player-bundle/musicbox-player
COPY --from=go-builder /app/musicbox-hwtest ./player-bundle/musicbox-hwtest
COPY --from=go-builder /app/version.txt ./player-bundle/version.txt

# Create directories for data persistence (including SSH keys for Ansible)
RUN mkdir -p /app/data /app/data/ssh && \
    chown -R nodejs:nodejs /app

# Copy ansible configuration
COPY --from=builder /app/packages/server/ansible ./ansible

# Copy sound machine assets
COPY --from=builder /app/packages/server/assets ./assets

USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL=/app/data/musicbox.db

EXPOSE 3000

# Start the server
CMD ["node", ".output/server/index.mjs"]
