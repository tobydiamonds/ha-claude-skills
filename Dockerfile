ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js (required for Claude Code CLI)
RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    git

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create working directories
RUN mkdir -p /data/runs /data/skills /app

# Copy application files
COPY rootfs /

# Copy app
COPY app /app

# Install app dependencies
RUN cd /app && npm install

# Make run script executable
RUN chmod a+x /etc/s6-overlay/s6-rc.d/claude-skills/run
