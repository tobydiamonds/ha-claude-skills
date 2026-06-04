ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js (required for Claude Code CLI)
RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    git \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install md-to-pdf for madplan output
RUN npm install -g md-to-pdf

# Set up Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Create working directories
RUN mkdir -p /data/claude /data/runs /data/skills /app

# Copy application files
COPY rootfs /
COPY app /app

WORKDIR /app

# Install app dependencies
RUN cd /app && npm install

# Ensure run script is executable
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
