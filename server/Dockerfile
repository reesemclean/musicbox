# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy root package files for workspace setup
COPY package.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install dependencies
RUN npm install --workspaces

# Copy shared package source
COPY shared ./shared

# Copy server source files
COPY server ./server

# Build the application
RUN npm run build --workspace=server

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache libstdc++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application from builder
COPY --from=builder /app/server/.output ./.output
COPY --from=builder /app/server/drizzle ./drizzle
COPY --from=builder /app/server/package.json ./package.json

# Create directories for data persistence
RUN mkdir -p /app/data /app/library && \
    chown -R nodejs:nodejs /app

USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL=/app/data/musicbox.db

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the server
CMD ["node", ".output/server/index.mjs"]
