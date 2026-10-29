import { PrismaClient } from '@prisma/client';
import path from 'path';
import dotenv from 'dotenv';

// Ensure environment variables are loaded before PrismaClient instantiates
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://baxnaano:baxnaano_secret_password@localhost:5432/baxnaano_db?schema=public';
} else if (!process.env.RENDER && /@dpg-[a-z0-9]+-a\//i.test(process.env.DATABASE_URL)) {
  // Automatically convert Render Internal Database URL to External URL when running outside Render
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /@(dpg-[a-z0-9]+-a)\//i,
    '@$1.oregon-postgres.render.com/'
  );
  if (!process.env.DATABASE_URL.includes('sslmode=')) {
    process.env.DATABASE_URL +=
      (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'sslmode=require';
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
