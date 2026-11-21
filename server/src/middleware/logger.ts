import { Request, Response, NextFunction } from 'express';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'pinhash',
  'currentpassword',
  'newpassword',
  'token',
  'tokenhash',
  'refreshtoken',
  'accesstoken',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'receiptphotodata',
]);

export function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveData);

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(lower) ||
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('token')
    ) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = redactSensitiveData(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;

    const durationMs = Date.now() - start;
    const logEntry = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userId: req.user?.id ?? null,
      branchId: req.user?.branchId ?? null,
      ip: req.ip || req.socket.remoteAddress,
      query: redactSensitiveData(req.query),
    };

    console.log(JSON.stringify(logEntry));
  });

  next();
}
