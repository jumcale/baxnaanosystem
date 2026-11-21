import { z } from 'zod';
import path from 'path';
import dotenv from 'dotenv';

// Preload environment files in priority order
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

const WEAK_SECRET_PATTERNS = [
  'change-this',
  'baxnaano_staging_access_secret',
  'baxnaano_staging_refresh_secret',
  'placeholder',
  '1234567890',
];

export function isStrongProductionSecret(secret: string): boolean {
  if (!secret || secret.length < 32) return false;
  const lower = secret.toLowerCase();
  return !WEAK_SECRET_PATTERNS.some((weak) => lower.includes(weak));
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    CORS_ORIGIN: z
      .string()
      .min(1)
      .default(process.env.RENDER_EXTERNAL_URL || 'https://baxnaanosystem.onrender.com'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!isStrongProductionSecret(data.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET is a known placeholder or weak secret in production.',
        });
      }
      if (!isStrongProductionSecret(data.JWT_REFRESH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET is a known placeholder or weak secret in production.',
        });
      }
      if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct in production.',
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    '[SECURITY CONFIG] Invalid or weak environment configuration:',
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

export const env = parsed.data;
