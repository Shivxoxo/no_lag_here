# THE SIR ARCHIVES — production image (Express + SQLite, no build step)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# better-sqlite3 ships prebuilt binaries for alpine (musl); sharp is a devDependency and skipped
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev && apk del python3 make g++

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/sir-archives.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
