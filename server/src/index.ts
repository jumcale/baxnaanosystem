import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { requestLogger } from './middleware/logger';
import { authRouter } from './routes/auth.routes';
import { branchesRouter } from './routes/branches.routes';
import { inventoryRouter } from './routes/inventory.routes';
import { salesRouter } from './routes/sales.routes';
import { creditRouter } from './routes/credit.routes';
import { expensesRouter } from './routes/expenses.routes';
import { quotationsRouter } from './routes/quotations.routes';
import { appointmentsRouter } from './routes/appointments.routes';
import { reportsRouter } from './routes/reports.routes';
import { prisma, warmDatabaseConnection, getDbConnectionState } from './config/db';
import { startMidnightRolloverScheduler } from './services/rollover.service';

export const app = express();

// 1. Ultra-Fast Zero-DB Health Endpoint for Render Load Balancer & Keep-Alive Monitors (<1ms)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'Baxnaano Pharmacy & Veterinary System',
    databaseCachedState: getDbConnectionState() ? 'connected' : 'warming',
    uptimeSeconds: Math.round(process.uptime()),
    timezone: 'Africa/Mogadishu',
    timestamp: new Date().toISOString(),
  });
});

// 2. Built-in Gzip / Brotli HTTP Compression Middleware for JSON APIs & Static JS/CSS Bundles
app.use((req: Request, res: Response, next: NextFunction) => {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!acceptEncoding || req.method === 'HEAD') {
    next();
    return;
  }

  const origSend = res.send.bind(res);
  res.send = function (body: any): Response {
    if (res.headersSent || res.getHeader('Content-Encoding')) {
      return origSend(body);
    }

    const contentType = String(res.getHeader('Content-Type') || '');
    const isCompressible =
      contentType.includes('application/json') ||
      contentType.includes('text/') ||
      contentType.includes('application/javascript') ||
      contentType.includes('image/svg+xml');

    if (!isCompressible || !body) {
      return origSend(body);
    }

    const buffer = Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? Buffer.from(body, 'utf-8')
        : Buffer.from(JSON.stringify(body), 'utf-8');

    // Only compress payloads larger than 1 KB
    if (buffer.byteLength < 1024) {
      return origSend(body);
    }

    try {
      res.setHeader('Vary', 'Accept-Encoding');
      if (acceptEncoding.includes('br')) {
        const compressed = zlib.brotliCompressSync(buffer, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
        });
        res.setHeader('Content-Encoding', 'br');
        res.removeHeader('Content-Length');
        return origSend(compressed);
      }
      if (acceptEncoding.includes('gzip')) {
        const compressed = zlib.gzipSync(buffer, { level: zlib.constants.Z_BEST_SPEED });
        res.setHeader('Content-Encoding', 'gzip');
        res.removeHeader('Content-Length');
        return origSend(compressed);
      }
    } catch {
      // Fallback to uncompressed on error
    }

    return origSend(body);
  };

  next();
});

// 3. Security & Hardening Middleware
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
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(requestLogger);

// 4. Rate Limiting (Excludes /health and /api/health so keep-alive pings never trip rate limits)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 800,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/api/health',
  message: { error: 'TOO_MANY_REQUESTS', messageKey: 'common.errors.rate_limit' },
});
app.use('/api', apiLimiter);

// 5. API & Database Health Check (With fast 3-second timeout guard so it never hangs)
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB_HEALTH_TIMEOUT')), 3000)
      ),
    ]);
    res.json({
      status: 'ok',
      database: 'connected',
      service: 'Baxnaano Pharmacy & Veterinary API',
      timezone: 'Africa/Mogadishu',
      uptimeSeconds: Math.round(process.uptime()),
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

// 6. Core Business Routes
app.use('/api/auth', authRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/sales', salesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/quotations', quotationsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/reports', reportsRouter);

// 7. Serve Built React Vite PWA (`client/dist`) with Immutable Asset Caching & Compression
const clientDistCandidates = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];
const clientDistPath = clientDistCandidates.find((p) =>
  fs.existsSync(path.join(p, 'index.html'))
);

if (clientDistPath) {
  // Hashed Vite assets (/assets/*) cached immutable for 1 year
  app.use(
    '/assets',
    express.static(path.join(clientDistPath, 'assets'), {
      maxAge: '365d',
      immutable: true,
    })
  );

  // Root static files (manifest, sw.js, icons, index.html) served with instant validation
  app.use(
    express.static(clientDistPath, {
      setHeaders: (res, filePath) => {
        if (
          filePath.endsWith('index.html') ||
          filePath.endsWith('sw.js') ||
          filePath.endsWith('manifest.webmanifest')
        ) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    })
  );

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 8. Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]:', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    messageKey: 'common.errors.server_error',
  });
});

// 9. Optional Self Keep-Alive Ping for Render Free Tier
function startRenderKeepAlivePing(port: number): void {
  const targetUrl =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.KEEP_ALIVE_URL ||
    (env.NODE_ENV === 'production' ? 'https://baxnaanosystem.onrender.com' : '');

  if (!targetUrl) return;

  const healthUrl = `${targetUrl.replace(/\/$/, '')}/health`;
  // Ping every 10 minutes (Render Free Tier sleeps after 15 minutes of inactivity)
  setInterval(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(healthUrl, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
    } catch {
      // Ignore transient ping errors
    }
  }, 10 * 60 * 1000);

  console.log(`[Keep-Alive] Active 10-minute heartbeat configured for ${healthUrl}`);
}

const PORT = env.PORT;

if (!process.env.VITEST) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Baxnaano Server] Listening on http://0.0.0.0:${PORT} (TZ: Africa/Mogadishu UTC+3)`);
    // Warm up DB and start scheduler asynchronously in the background without blocking startup
    warmDatabaseConnection();
    startMidnightRolloverScheduler();
    startRenderKeepAlivePing(PORT);
  });
}
