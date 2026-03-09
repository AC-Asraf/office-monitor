# Office Monitor Docker Image
# Multi-stage build for smaller final image

# ============== BUILD STAGE ==============
FROM node:20-alpine AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /build

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# ============== PRODUCTION STAGE ==============
FROM node:20-alpine AS production

# Install only runtime dependencies (ping for health checks)
RUN apk add --no-cache iputils tini

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy node_modules from builder stage
COPY --from=builder /build/node_modules ./node_modules

# Copy application files
COPY --chown=appuser:appgroup server.js ./
COPY --chown=appuser:appgroup dashboard.html ./
COPY --chown=appuser:appgroup settings.html ./
COPY --chown=appuser:appgroup reports.html ./
COPY --chown=appuser:appgroup reset-password.html ./
COPY --chown=appuser:appgroup topology.html ./
COPY --chown=appuser:appgroup wall-editor.html ./
COPY --chown=appuser:appgroup 3d-floor-view.html ./
COPY --chown=appuser:appgroup 3d-view.html ./
COPY --chown=appuser:appgroup sw.js ./
COPY --chown=appuser:appgroup manifest.json ./
COPY --chown=appuser:appgroup diagnostics.js ./

# Copy directories
COPY --chown=appuser:appgroup js/ ./js/
COPY --chown=appuser:appgroup lib/ ./lib/
COPY --chown=appuser:appgroup icons/ ./icons/

# Create data and logs directories with correct ownership
RUN mkdir -p /app/data /app/logs && \
    chown -R appuser:appgroup /app/data /app/logs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3002

# Expose the port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/ || exit 1

# Switch to non-root user
USER appuser

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Run the application
CMD ["node", "server.js"]
