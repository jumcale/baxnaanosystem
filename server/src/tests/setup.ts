import { beforeAll } from 'vitest';

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')) {
    throw new Error(
      `[SECURITY GUARD] Vitest test run aborted: Refusing to run tests against remote database (${dbUrl}). DATABASE_URL must point to localhost or 127.0.0.1.`
    );
  }
});
