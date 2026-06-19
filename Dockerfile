# ── Build stage: compile native modules (better-sqlite3, sharp) ──
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev \
 && npm cache clean --force \
 && apk del python3 make g++

# ── Runtime stage: minimal image ──
FROM node:20-alpine
RUN apk add --no-cache tini \
 && addgroup -S ntopia \
 && adduser -S -G ntopia ntopia

WORKDIR /app

COPY --from=build --chown=ntopia:ntopia /app/node_modules ./node_modules
COPY --chown=ntopia:ntopia . .

RUN mkdir -p /app/data /app/public/uploads \
 && chown -R ntopia:ntopia /app/data /app/public/uploads

USER ntopia
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/',r=>{process.exit(r.statusCode===200?0:1)})"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
