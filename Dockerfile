# ============================================================================
# BAXNAANO PRODUCTION MULTI-STAGE DOCKERFILE
# - Stage 1 (builder): Deterministic `npm ci`, Prisma generation, and full build
# - Stage 2 (runner): Hardened non-root (`USER node`) runtime image
# ============================================================================

# Stage 1: Build Shared, Server, and React Vite PWA Frontend
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY server/prisma ./server/prisma
COPY client/package.json ./client/

RUN npm ci

COPY . .
RUN npm run prisma:generate -w server
RUN npm run build

# Stage 2: Production Runner (Non-Root, Production-Only Dependencies)
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl wget

ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install strictly production dependencies without lifecycle scripts
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy generated Prisma Client engine, compiled server bundle, and built PWA static assets
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder --chown=node:node /app/server/prisma ./server/prisma
COPY --from=builder --chown=node:node /app/server/dist/server.cjs ./server/dist/server.cjs
COPY --from=builder --chown=node:node /app/client/dist ./client/dist

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "server/dist/server.cjs"]
