ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js
RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    git

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
