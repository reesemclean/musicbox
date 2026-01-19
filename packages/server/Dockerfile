# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy root package files for workspace setup
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/player/package.json ./packages/player/

# Install dependencies (including devDependencies for build)
RUN npm install

# Copy shared package source
COPY packages/shared ./packages/shared

# Copy player source files and build bundle
COPY packages/player ./packages/player
RUN npm run build:bundle --workspace=player

# Copy server source files
COPY packages/server ./packages/server

# Build the application
RUN npm run build --workspace=server

# Create player bundle (dist contains the bundled player.js)
# Generate a deployment-specific package.json with only runtime native dependencies
# (shared workspace dep is bundled, only i2c-bus needs to be installed on Pi)
RUN mkdir -p /app/player-bundle /tmp/player-deploy && \
    cd /app/packages/player && \
    cp -r dist /tmp/player-deploy/ && \
    node -e " \
      const pkg = require('./package.json'); \
      const deployPkg = { \
        name: pkg.name, \
        version: pkg.version, \
        type: pkg.type, \
        dependencies: { 'i2c-bus': pkg.dependencies['i2c-bus'] } \
      }; \
      require('fs').writeFileSync('/tmp/player-deploy/package.json', JSON.stringify(deployPkg, null, 2)); \
    " && \
    tar -czf /app/player-bundle/player.tar.gz -C /tmp/player-deploy . && \
    node -p "require('./package.json').version" > /app/player-bundle/version.txt

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

# Copy bundled player (outside /data so it's not overridden by volume mounts)
COPY --from=builder /app/player-bundle ./player-bundle

# Create directories for data persistence (including SSH keys for Ansible)
RUN mkdir -p /app/data /app/data/ssh && \
    chown -R nodejs:nodejs /app

# Copy ansible configuration
COPY --from=builder /app/packages/server/ansible ./ansible

USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL=/app/data/musicbox.db

EXPOSE 3000

# Start the server
CMD ["node", ".output/server/index.mjs"]
