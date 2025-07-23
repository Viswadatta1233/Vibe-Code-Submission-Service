# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Debug: List files to ensure everything is copied
RUN echo "=== Source files ===" && find . -name "*.ts" | head -20

# Build TypeScript with verbose output
RUN npm run build 2>&1 || (echo "TypeScript compilation failed. Check the errors above." && exit 1)

# Production stage for main service
FROM node:18-alpine AS production

# Install Docker for Docker-in-Docker execution
RUN apk add --no-cache \
    docker \
    docker-cli \
    && rm -rf /var/cache/apk/*

# Create docker group and add node user (handle potential conflicts)
RUN addgroup -g 999 docker 2>/dev/null || true && \
    usermod -a -G docker node 2>/dev/null || true

# Set up Docker daemon directory
RUN mkdir -p /var/run/docker && \
    chown -R node:docker /var/run/docker

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy source for worker (needed for ts-node)
COPY --from=builder /app/src ./src

# Change ownership of app directory
RUN chown -R node:docker /app

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Switch to node user
USER node

# Start the application
CMD ["node", "dist/index.js"] 