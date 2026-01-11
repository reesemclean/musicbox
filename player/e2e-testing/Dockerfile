# ============================================================================
# MusicBox Player - Docker Testing Image
# ============================================================================
#
# PURPOSE:
#   Test the Nix-packaged player in a NixOS container environment
#   before deploying to the Raspberry Pi.
#
# WHY THIS APPROACH:
#   - Tests the EXACT binary that goes to production (same Nix package)
#   - Runs in NixOS environment (similar to Pi)
#   - Fast iteration (Nix just copies pre-built files)
#
# WHAT THIS TESTS:
#   ✅ Nix package works correctly
#   ✅ Binary runs in NixOS environment
#   ✅ HTTP API functionality
#   ✅ Server connectivity
#   ❌ Real NFC reader (no i2c hardware in Docker)
#   ❌ Audio output (complex to set up in Docker)
#
# USAGE:
#   Option A: Use helper script (recommended)
#     ./player/e2e-testing/test-docker.sh
#
#   Option B: Manual steps
#     1. Build bundle (if not already committed):
#        cd player && npm run build:bundle && cd ..
#
#     2. Package with Nix (packages the pre-built bundle):
#        nix build .#player
#
#     3. Build Docker image (copies Nix result):
#        docker build -f player/e2e-testing/Dockerfile -t musicbox-player .
#
#     4. Run container with test config:
#        docker run -d -p 8080:8080 \
#          -v $(pwd)/player/test-config.json:/etc/musicbox/player.config.json:ro \
#          --name musicbox-test \
#          musicbox-player
#
#     5. Test HTTP API:
#        curl http://localhost:8080/status
#        curl -X POST http://localhost:8080/scan \
#          -H "Content-Type: application/json" \
#          -d '{"nfcId": "test-card-123"}'
#
#     6. Cleanup:
#        docker stop musicbox-test && docker rm musicbox-test
#
# ============================================================================

FROM nixos/nix:latest

# Copy the pre-built Nix package from host
# This is the 'result' symlink created by: nix build .#player
COPY result /opt/musicbox-player

# Create config directory for player.config.json
RUN mkdir -p /etc/musicbox

WORKDIR /root

# Expose HTTP API port
EXPOSE 8080

# Environment: HTTP trigger only (no NFC/keyboard in Docker)
ENV NODE_ENV=production \
    TRIGGER_HTTP=true \
    TRIGGER_NFC=false \
    TRIGGER_KEYBOARD=false

# Run the Nix-built player binary
CMD ["/opt/musicbox-player/bin/musicbox-player"]
