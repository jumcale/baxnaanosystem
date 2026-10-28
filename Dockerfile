# ============================================================================
# BAXNAANO MULTI-STAGE PRODUCTION DOCKERFILE
# Builds shared, server (Express + Prisma), and client (React Vite PWA)
# ============================================================================

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# Stage 1: Install workspace dependencies
FROM base AS deps
COPY package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install

# Stage 2: Build Shared, Prisma Client, Server, and PWA Frontend
FROM deps AS builder
COPY . .
RUN npm run prisma:generate -w server
RUN npm run build

# Stage 3: Production Server Runner
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/src ./server/src
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --schema=server/prisma/schema.prisma && npm run prisma:seed -w server && npm run start -w server"]
