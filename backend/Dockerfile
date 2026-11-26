FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save prisma@5.22.0
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-alpine
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app src ./src
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
