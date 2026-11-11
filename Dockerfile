# ---- build stage: install Playwright + Chromium ----
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    SEAART_HEADLESS=true \
    SEAART_DUMP_DIR=/tmp/seaart-dump

WORKDIR /app

# Chromium runtime dependencies are installed by Playwright itself.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY src ./src
COPY test ./test

# The job only needs to read its inputs and write optional dumps.
RUN mkdir -p /tmp/seaart-dump && chown -R node:node /app /tmp/seaart-dump
USER node

# One-shot: claim, report, exit. `docker run --rm` removes the container.
ENTRYPOINT ["node", "src/index.js"]
