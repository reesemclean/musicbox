.PHONY: build build-arm64 clean run test dist lint fmt vet check ci

# Binary names
BINARY_NAME=musicbox-player
HWTEST_NAME=musicbox-hwtest

# Build flags
LDFLAGS=-ldflags "-s -w"

# Build for current platform
build:
	go build $(LDFLAGS) -o dist/$(BINARY_NAME) ./cmd/player
	go build $(LDFLAGS) -o dist/$(HWTEST_NAME) ./cmd/hwtest

# Cross-compile for Raspberry Pi (ARM64)
build-arm64:
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o dist/$(BINARY_NAME)-arm64 ./cmd/player
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o dist/$(HWTEST_NAME)-arm64 ./cmd/hwtest

# Build for both platforms
build-all: build build-arm64

# Run locally
run:
	go run ./cmd/player

# Run tests
test:
	go test -v ./...

# Run tests with coverage
test-coverage:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

# Clean build artifacts
clean:
	rm -rf dist/ coverage.out coverage.html

# Create deployment tarball
dist: build-arm64
	mkdir -p dist
	tar -czf dist/player.tar.gz -C dist $(BINARY_NAME)-arm64

# Install dependencies
deps:
	go mod download
	go mod tidy

# Format code
fmt:
	go fmt ./...

# Check if code is formatted (for CI)
fmt-check:
	@test -z "$$(gofmt -l .)" || (echo "Code is not formatted. Run 'make fmt'" && gofmt -l . && exit 1)

# Run go vet
vet:
	go vet ./...

# Run golangci-lint (install: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)
lint:
	golangci-lint run ./...

# Run staticcheck (install: go install honnef.co/go/tools/cmd/staticcheck@latest)
staticcheck:
	staticcheck ./...

# Run all checks (format, vet, lint)
check: fmt-check vet lint

# CI target - runs all checks and tests
ci: deps fmt-check vet test build
	@echo "CI checks passed!"
