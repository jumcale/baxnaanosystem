# ============================================================================
# BAXNAANO PRODUCTION DOCKERFILE
# Builds shared, server (Express + Prisma), and client (React Vite PWA)
# ============================================================================

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl wget

# 1. Copy package manifests and Prisma schema (required by postinstall prisma:generate)
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY server/prisma ./server/prisma
COPY client/package.json ./client/

# 2. Install workspace dependencies & generate Prisma Client
RUN npm install

# 3. Copy full source and build Shared, Server, and React Vite PWA Frontend
COPY . .
RUN npm run prisma:generate -w server
RUN npm run build

# 4. Production runtime configuration
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["npm", "run", "start", "-w", "server"]
