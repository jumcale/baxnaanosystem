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
import { prisma, warmDatabaseConnection } from './config/db';
import { startMidnightRolloverScheduler } from './services/rollover.service';

export const app = express();

// Trust first reverse proxy hop (Render / Railway load balancer) so req.ip and req.secure are accurate
app.set('trust proxy', 1);
app.disable('x-powered-by');

// 1. Security & Hardening Middleware (Helmet with Strict Content-Security-Policy on ALL routes)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// 2. HTTPS Enforcement behind Render / Reverse Proxy in Production
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    return;
  }
  next();
});

// 3. Ultra-Fast Unauthenticated Health Endpoint for Render / Docker / Railway (<1ms, zero sensitive info)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// 4. Built-in Gzip / Brotli HTTP Compression Middleware for JSON APIs & Static JS/CSS Bundles
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

// 5. Strict CORS Allowlist (Never wildcard '*' with credentials in production)
const configuredOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter((o) => o && o !== '*');

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin requests (no Origin header) or configured allowed origins
      if (!origin || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:')) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-branch-id', 'X-Requested-With'],
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));
app.use(requestLogger);

// 6. Rate Limiting on All API Routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/api/health',
  message: { error: 'TOO_MANY_REQUESTS', messageKey: 'common.errors.rate_limit' },
});
app.use('/api', apiLimiter);

// 7. API & Database Connectivity Check (Minimal non-sensitive output, 3s timeout guard)
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
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      error: 'DATABASE_UNAVAILABLE',
    });
  }
});

// 8. Core Business Routes
app.use('/api/auth', authRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/sales', salesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/quotations', quotationsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/reports', reportsRouter);

// 9. Serve Built React Vite PWA (`client/dist`) with Security & Cache Headers
const clientDistCandidates = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];
const clientDistPath = clientDistCandidates.find((p) =>
  fs.existsSync(path.join(p, 'index.html'))
);

if (clientDistPath) {
  app.use(
    '/assets',
    express.static(path.join(clientDistPath, 'assets'), {
      maxAge: '365d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    })
  );

  app.use(
    express.static(clientDistPath, {
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 10. Global Error Handler (Never leaks stack traces or internal details to client)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message === 'CORS_ORIGIN_NOT_ALLOWED') {
    res.status(403).json({
      error: 'CORS_ORIGIN_NOT_ALLOWED',
      message: 'Origin is not permitted by CORS policy.',
    });
    return;
  }
  console.error('[Server Error]:', err.message);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    messageKey: 'common.errors.server_error',
  });
});

function startRenderKeepAlivePing(): void {
  const targetUrl =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.KEEP_ALIVE_URL ||
    (env.NODE_ENV === 'production' ? 'https://baxnaanosystem.onrender.com' : '');

  if (!targetUrl) return;

  const healthUrl = `${targetUrl.replace(/\/$/, '')}/health`;
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
}

const PORT = env.PORT;

if (!process.env.VITEST) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Baxnaano Server] Listening on http://0.0.0.0:${PORT} (TZ: Africa/Mogadishu UTC+3)`);
    warmDatabaseConnection();
    startMidnightRolloverScheduler();
    startRenderKeepAlivePing();
  });
}
