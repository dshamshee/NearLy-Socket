FROM oven/bun:1.3-alpine

WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy application source
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /usr/src/app

USER appuser

EXPOSE 4000

# Bind to 0.0.0.0 so the server accepts connections from outside the container
ENV HOST=0.0.0.0
ENV PORT=4000

CMD ["bun", "server.ts"]