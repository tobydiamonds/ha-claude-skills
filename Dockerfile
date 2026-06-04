ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js, Chromium for PDF generation
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
    ttf-freefont \
    font-noto

# Puppeteer config for Alpine
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create working directories
RUN mkdir -p /data/runs /data/skills /share/madplaner /app

# Copy app
COPY app /app

# Install app dependencies
RUN cd /app && npm install

# Copy entrypoint
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENTRYPOINT ["/run.sh"]
