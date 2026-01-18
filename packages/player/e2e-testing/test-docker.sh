#!/usr/bin/env bash
# MusicBox Player - Docker Test Script
#
# This script automates the process of building and testing the MusicBox player
# in a Docker container that mimics the production NixOS environment.
#
# Usage:
#   ./player/e2e-testing/test-docker.sh [command]
#
# Commands:
#   build    - Build Nix package and Docker image
#   run      - Run the Docker container
#   test     - Test the HTTP API
#   logs     - Show container logs
#   stop     - Stop and remove the container
#   all      - Build, run, and test (default)

set -e  # Exit on error

# Configuration
CONTAINER_NAME="musicbox-test"
IMAGE_NAME="musicbox-player"
CONFIG_FILE="player/test-config.json"
HTTP_PORT=8080

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if container is running
is_running() {
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Check if container exists (running or stopped)
container_exists() {
    docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Build Nix package and Docker image
build() {
    # Check if bundle exists, build if needed
    if [ ! -f "player/dist/player.js" ]; then
        log_warning "Bundle not found at player/dist/player.js"
        log_info "Building bundle..."
        if (cd player && npm run build:bundle); then
            log_success "Bundle built successfully"
        else
            log_error "Failed to build bundle"
            exit 1
        fi
    else
        log_info "Using existing bundle at player/dist/player.js"
    fi

    log_info "Packaging with Nix..."
    if nix build .#player; then
        log_success "Nix package built successfully"
    else
        log_error "Failed to build Nix package"
        exit 1
    fi

    log_info "Verifying Nix build result..."
    if [ -L "result" ] && [ -f "result/bin/musicbox-player" ]; then
        log_success "Nix build verified: $(readlink result)"
    else
        log_error "Nix build failed - result/bin/musicbox-player not found"
        exit 1
    fi

    log_info "Building Docker image..."
    if docker build -f player/e2e-testing/Dockerfile -t ${IMAGE_NAME} .; then
        log_success "Docker image built successfully"
    else
        log_error "Failed to build Docker image"
        exit 1
    fi
}

# Run the Docker container
run_container() {
    # Check if container is already running
    if is_running; then
        log_warning "Container '${CONTAINER_NAME}' is already running"
        log_info "Use './player/e2e-testing/test-docker.sh stop' to stop it first"
        return 0
    fi

    # Remove old container if it exists
    if container_exists; then
        log_info "Removing old container..."
        docker rm ${CONTAINER_NAME} > /dev/null
    fi

    # Check if config file exists
    if [ ! -f "${CONFIG_FILE}" ]; then
        log_error "Config file not found: ${CONFIG_FILE}"
        log_info "Create it with your server settings"
        exit 1
    fi

    log_info "Starting Docker container..."
    if docker run -d \
        --name ${CONTAINER_NAME} \
        -p ${HTTP_PORT}:${HTTP_PORT} \
        -v $(pwd)/${CONFIG_FILE}:/etc/musicbox/player.config.json:ro \
        ${IMAGE_NAME}; then
        log_success "Container started: ${CONTAINER_NAME}"
    else
        log_error "Failed to start container"
        exit 1
    fi

    log_info "Waiting for player to start..."
    sleep 3

    # Check if container is still running
    if ! is_running; then
        log_error "Container exited unexpectedly. Check logs:"
        echo ""
        docker logs ${CONTAINER_NAME}
        exit 1
    fi

    log_success "Container is running"
}

# Test the HTTP API
test_api() {
    if ! is_running; then
        log_error "Container '${CONTAINER_NAME}' is not running"
        log_info "Start it with: ./player/e2e-testing/test-docker.sh run"
        exit 1
    fi

    log_info "Testing HTTP API..."

    # Test status endpoint
    log_info "Testing GET /status..."
    if curl -s -f http://localhost:${HTTP_PORT}/status > /dev/null; then
        log_success "Status endpoint OK"
        echo ""
        echo "Response:"
        curl -s http://localhost:${HTTP_PORT}/status | jq '.' 2>/dev/null || curl -s http://localhost:${HTTP_PORT}/status
        echo ""
    else
        log_error "Status endpoint failed"
        exit 1
    fi

    # Test scan endpoint
    log_info "Testing POST /scan (simulated NFC scan)..."
    if curl -s -f -X POST http://localhost:${HTTP_PORT}/scan \
        -H "Content-Type: application/json" \
        -d '{"nfcId": "test-card-123"}' > /dev/null; then
        log_success "Scan endpoint OK"
    else
        log_warning "Scan endpoint failed (might be expected if card not registered)"
    fi

    echo ""
    log_success "API tests complete"
}

# Show container logs
show_logs() {
    if ! container_exists; then
        log_error "Container '${CONTAINER_NAME}' does not exist"
        exit 1
    fi

    log_info "Showing logs for '${CONTAINER_NAME}'..."
    echo ""
    docker logs -f ${CONTAINER_NAME}
}

# Stop and remove container
stop_container() {
    if ! container_exists; then
        log_warning "Container '${CONTAINER_NAME}' does not exist"
        return 0
    fi

    log_info "Stopping and removing container..."
    docker stop ${CONTAINER_NAME} > /dev/null 2>&1 || true
    docker rm ${CONTAINER_NAME} > /dev/null 2>&1 || true
    log_success "Container stopped and removed"
}

# Show usage
usage() {
    echo "MusicBox Player - Docker Test Script"
    echo ""
    echo "Usage:"
    echo "  ./player/e2e-testing/test-docker.sh [command]"
    echo ""
    echo "Commands:"
    echo "  build    - Build Nix package and Docker image"
    echo "  run      - Run the Docker container"
    echo "  test     - Test the HTTP API"
    echo "  logs     - Show container logs (follow mode)"
    echo "  stop     - Stop and remove the container"
    echo "  all      - Build, run, and test (default)"
    echo "  help     - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./player/e2e-testing/test-docker.sh              # Run full workflow"
    echo "  ./player/e2e-testing/test-docker.sh build        # Just build"
    echo "  ./player/e2e-testing/test-docker.sh logs         # View logs"
    echo ""
}

# Main script
COMMAND=${1:-all}

case "$COMMAND" in
    build)
        build
        ;;
    run)
        run_container
        ;;
    test)
        test_api
        ;;
    logs)
        show_logs
        ;;
    stop)
        stop_container
        ;;
    all)
        build
        run_container
        test_api
        echo ""
        log_success "All steps completed!"
        echo ""
        echo "Next steps:"
        echo "  - View logs: ./player/e2e-testing/test-docker.sh logs"
        echo "  - Stop container: ./player/e2e-testing/test-docker.sh stop"
        echo "  - Test status: curl http://localhost:${HTTP_PORT}/status"
        echo "  - Simulate scan: curl -X POST http://localhost:${HTTP_PORT}/scan \\"
        echo "                     -H 'Content-Type: application/json' \\"
        echo "                     -d '{\"nfcId\": \"your-card-id\"}'"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        echo ""
        usage
        exit 1
        ;;
esac
