# ============================================================================
# MusicBox Player - Docker Testing Image (Go Version)
# ============================================================================
#
# PURPOSE:
#   Test the Go player binary in a minimal container environment
#   before deploying to the Raspberry Pi.
#
# WHAT THIS TESTS:
#   ✅ Go binary builds and runs correctly
#   ✅ HTTP API functionality
#   ✅ Server connectivity
#   ❌ Real NFC reader (no i2c hardware in Docker)
#   ❌ GPIO buttons (no GPIO in Docker)
#   ❌ Audio output (no audio devices in Docker)
#
# USAGE:
#   1. Build Docker image:
#      docker build -f packages/player/e2e-testing/Dockerfile -t musicbox-player .
#
#   2. Run container with test config:
#      docker run -d -p 8080:8080 \
#        -e SERVER_URL=http://host.docker.internal:3000 \
#        -e DEVICE_SECRET=test-secret \
#        -e TRIGGER_HTTP=true \
#        --name musicbox-test \
#        musicbox-player
#
#   3. Test HTTP API:
#      curl http://localhost:8080/status
#      curl -X POST http://localhost:8080/scan \
#        -H "Content-Type: application/json" \
#        -d '{"nfcId": "test-card-123"}'
#
#   4. Cleanup:
#      docker stop musicbox-test && docker rm musicbox-test
#
# ============================================================================

# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy Go module files
COPY packages/player-go/go.mod packages/player-go/go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY packages/player-go/ ./

# Build the binary (for current platform, not ARM64)
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o musicbox-player ./cmd/player

# Runtime stage - minimal image
FROM alpine:latest

# Install runtime dependencies for audio (mpv) and debugging
RUN apk add --no-cache mpv alsa-utils ca-certificates

# Create musicbox user
RUN addgroup -g 1000 -S musicbox && \
    adduser -S -u 1000 -G musicbox musicbox

# Create required directories
RUN mkdir -p /var/cache/musicbox /tmp/musicbox-tones && \
    chown -R musicbox:musicbox /var/cache/musicbox /tmp/musicbox-tones

# Copy binary from builder
COPY --from=builder /app/musicbox-player /opt/musicbox/player/musicbox-player
RUN chmod +x /opt/musicbox/player/musicbox-player

WORKDIR /opt/musicbox/player

# Expose HTTP API port
EXPOSE 8080

# Environment: HTTP trigger only (no NFC/GPIO/keyboard in Docker)
ENV TRIGGER_HTTP=true \
    TRIGGER_NFC=false \
    TRIGGER_KEYBOARD=false \
    TRIGGER_BUTTONS=false

USER musicbox

# Run the player binary
CMD ["/opt/musicbox/player/musicbox-player"]
