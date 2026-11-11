# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build
WORKDIR /app
# Toolchain only as a fallback: better-sqlite3 ships prebuilt binaries for
# linux x64/arm64 (glibc), so normally nothing is compiled.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# --ignore-scripts: npm 11 gates/changes dependency install scripts, and none are needed:
# esbuild and @parcel/watcher use prebuilt platform packages, better-sqlite3 ships its
# .node binaries in the package, and `nuxt build` runs `nuxt prepare` itself.
RUN npm ci --ignore-scripts
# Fail fast if the native SQLite binding cannot be loaded; fall back to compiling it.
RUN node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()" \
  || (npm rebuild better-sqlite3 \
      && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()")
COPY . .
RUN npm run build

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.db \
    MIGRATIONS_DIR=/app/migrations \
    BACKUP_DIR=/data/backups \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Headless Chromium (plus its system libraries) renders the print views as PDF downloads.
# Keep the version in step with playwright-core in package.json.
RUN npx -y playwright-core@1.65.0 install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/server/db/migrations ./migrations
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
