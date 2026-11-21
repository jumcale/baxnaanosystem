import { PrismaClient } from '@prisma/client';
import { env } from './env';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

let isDbConnected = false;

export function getDbConnectionState(): boolean {
  return isDbConnected;
}

/**
 * Warms up the Prisma connection pool asynchronously in the background
 * so database TCP/TLS handshakes never block HTTP server port binding on startup.
 */
export function warmDatabaseConnection(): void {
  setImmediate(async () => {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      isDbConnected = true;
      console.log('[Database] PostgreSQL connection pool warmed up.');
    } catch (err: any) {
      isDbConnected = false;
      console.warn('[Database] Background connection warm-up deferred:', err?.message || err);
    }
  });
}
