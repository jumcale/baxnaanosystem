import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.routes';
import { branchesRouter } from './routes/branches.routes';
import { inventoryRouter } from './routes/inventory.routes';
import { salesRouter } from './routes/sales.routes';
import { creditRouter } from './routes/credit.routes';
import { expensesRouter } from './routes/expenses.routes';
import { quotationsRouter } from './routes/quotations.routes';
import { appointmentsRouter } from './routes/appointments.routes';
import { reportsRouter } from './routes/reports.routes';
import { syncRouter } from './routes/sync.routes';
import { prisma } from './config/db';

const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://baxnaano:baxnaano_secret_password@localhost:5432/baxnaano_db?schema=public';
}
if (!process.env.JWT_ACCESS_SECRET) {
  process.env.JWT_ACCESS_SECRET =
    'baxnaano-prod-jwt-access-secret-2026-arabsiyo-gabiley';
}


export const app = express();

// Security & Hardening Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(',').map((o) => o.trim())
      : true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' })); // 5mb to support offline receipt photo base64 payloads

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', messageKey: 'common.errors.rate_limit' },
});
app.use('/api', apiLimiter);

// Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Baxnaano Pharmacy & Veterinary API',
    timestamp: new Date().toISOString(),
  });
});

// Phase 1, 2, 3 & 4 Routes
app.use('/api/auth', authRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/sales', salesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/quotations', quotationsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/sync', syncRouter);

// Serve Built React Vite PWA (`client/dist`) in Staging & Production
const clientDistCandidates = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];
const clientDistPath = clientDistCandidates.find((p) =>
  fs.existsSync(path.join(p, 'index.html'))
);

if (clientDistPath) {
  app.use(express.static(clientDistPath));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]:', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    messageKey: 'common.errors.server_error',
  });
});

const PORT = Number(process.env.PORT) || 4000;

async function runServerStartupMaintenance() {
  try {
    const legacySkus = ['B2-IVER-100ML', 'B2-PPR-VAC', 'B3-OXY-20LA', 'B2-IVER-100', 'B3-IVER-100'];
    await prisma.$transaction(async (tx) => {
      // 1. Soft-delete obsolete legacy sample products
      await tx.product.updateMany({
        where: {
          OR: [
            { sku: { in: legacySkus } },
            { name: { contains: 'Oxytetracycline 20% Long Acting (100ml)' } },
          ],
          deletedAt: null,
        },
        data: { deletedAt: new Date(), isActive: false },
      });

      // 2. Find legacy products
      const legacyProds = await tx.product.findMany({
        where: {
          OR: [
            { sku: { in: legacySkus } },
            { name: { contains: 'Oxytetracycline 20% Long Acting (100ml)' } },
          ],
        },
        select: { id: true },
      });
      const legacyProdIds = legacyProds.map((p) => p.id);

      if (legacyProdIds.length > 0) {
        // Soft delete their batches
        await tx.productBatch.updateMany({
          where: { productId: { in: legacyProdIds }, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        // Soft delete legacy sales that used obsolete items
        const legacyItems = await tx.saleItem.findMany({
          where: { productId: { in: legacyProdIds }, deletedAt: null },
          select: { saleId: true },
        });
        const legacySaleIds = legacyItems.map((i) => i.saleId);
        if (legacySaleIds.length > 0) {
          await tx.sale.updateMany({
            where: { id: { in: legacySaleIds }, deletedAt: null },
            data: { deletedAt: new Date(), voidOrRefundReason: 'Purged obsolete legacy seed product sale' },
          });
          await tx.saleItem.updateMany({
            where: { saleId: { in: legacySaleIds }, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          await tx.payment.updateMany({
            where: { saleId: { in: legacySaleIds }, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
      }
    });
    console.log('[Baxnaano Server] Startup database maintenance completed.');
  } catch (err: any) {
    if (err?.code === 'P1001' || err?.message?.includes("Can't reach database server")) {
      console.warn('[Baxnaano Server] Note: PostgreSQL database is not reachable at DATABASE_URL. If developing locally, ensure PostgreSQL is running or set DATABASE_URL in .env.');
    } else {
      console.error('[Baxnaano Server] Startup database maintenance error:', err);
    }
  }
}

if (!process.env.VITEST) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Baxnaano Server] Listening on http://0.0.0.0:${PORT}`);
    runServerStartupMaintenance();
  });
}
