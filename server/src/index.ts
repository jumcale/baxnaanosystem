import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
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

export const app = express();

// Security & Hardening Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const allowedOrigins =
  env.CORS_ORIGIN === '*'
    ? true
    : env.CORS_ORIGIN.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

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
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      service: 'Baxnaano Pharmacy & Veterinary API',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      error: 'DATABASE_UNAVAILABLE',
      timestamp: new Date().toISOString(),
    });
  }
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

const PORT = env.PORT;

if (!process.env.VITEST) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Baxnaano Server] Listening on http://0.0.0.0:${PORT}`);
  });
}
