import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../config/db';
import { env } from '../config/env';
import {
  LoginSchema,
  CreateUserSchema,
  ChangePasswordSchema,
  AuthenticatedUser,
  ROLE_PERMISSIONS,
  ROLES,
  RoleName,
  BranchCode,
} from '@baxnaano/shared';
import {
  authenticateJWT,
  requirePermissions,
  requireRoles,
  signAccessToken,
} from '../middleware/auth';
import { recordAuditLog } from '../utils/audit';

export const authRouter = Router();

const REFRESH_TOKEN_TTL_DAYS = 7;
const BCRYPT_COST_FACTOR = 12;
// Precomputed cost-12 bcrypt hash used for constant-time comparison when username is not found
const DUMMY_BCRYPT_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oL8.xK3zW';

// Per-username account lockout tracker (5 failed attempts -> 15 min lockout)
const ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const failedLoginTracker = new Map<string, { count: number; lockedUntil: number }>();

function hashToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(rawToken)
    .digest('hex');
}

/**
 * Defense-in-depth CSRF verification for cookie-authenticated endpoints (/refresh, /logout).
 * When a browser sends the HttpOnly refresh cookie, require either X-Requested-With header
 * or a trusted Origin header matching CORS_ORIGIN.
 */
function verifyCsrfForCookieEndpoint(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    next();
    return;
  }

  const hasCookie = Boolean(req.cookies?.baxnaano_refresh);
  if (!hasCookie) {
    next();
    return;
  }

  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'XMLHttpRequest' || xRequestedWith === 'BaxnaanoClient') {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    const allowed = env.CORS_ORIGIN.split(',').map((o) => o.trim());
    if (allowed.includes(origin)) {
      next();
      return;
    }
  }

  res.status(403).json({
    error: 'CSRF_VALIDATION_FAILED',
    message: 'Cross-site cookie request blocked: missing X-Requested-With header or trusted Origin.',
  });
}

// Rate limiting: 10 failed login attempts per 15 minutes per IP + username
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}_${String(req.body?.username || '').toLowerCase()}`,
  message: { error: 'TOO_MANY_ATTEMPTS', messageKey: 'auth.errors.rate_limit' },
});

/**
 * POST /api/auth/login
 * Authenticates user with constant-time anti-enumeration, per-account lockout,
 * short-lived JWT access token, HttpOnly SameSite=Strict refresh cookie, and AuditLog.
 */
authRouter.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { username, password, deviceId } = parsed.data;
    const normalizedUsername = username.trim().toLowerCase();

    // Check per-account lockout state
    const lockState = failedLoginTracker.get(normalizedUsername);
    if (lockState && lockState.lockedUntil > Date.now()) {
      res.status(429).json({
        error: 'ACCOUNT_TEMPORARILY_LOCKED',
        messageKey: 'auth.errors.rate_limit',
        message: 'Too many failed login attempts. Account is locked for 15 minutes.',
      });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        username: { equals: username.trim(), mode: 'insensitive' },
        deletedAt: null,
      },
      include: {
        role: true,
        branch: true,
      },
    });

    // Always run bcrypt.compare to prevent timing-based user enumeration
    const targetHash = user && user.isActive ? user.passwordHash : DUMMY_BCRYPT_HASH;
    const passwordValid = await bcrypt.compare(password, targetHash);

    if (!user || !user.isActive || !passwordValid) {
      const currentCount = (lockState?.count || 0) + 1;
      const isNowLocked = currentCount >= ACCOUNT_LOCKOUT_MAX_ATTEMPTS;
      failedLoginTracker.set(normalizedUsername, {
        count: currentCount,
        lockedUntil: isNowLocked ? Date.now() + ACCOUNT_LOCKOUT_WINDOW_MS : 0,
      });

      if (user) {
        await recordAuditLog({
          branchId: user.branchId,
          userId: user.id,
          action: isNowLocked ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
          entityType: 'User',
          entityId: user.id,
          reason: `Failed login attempt #${currentCount}`,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        messageKey: 'auth.errors.invalid_credentials',
      });
      return;
    }

    // Clear failed login tracker on success
    failedLoginTracker.delete(normalizedUsername);

    const roleName = user.role.name as RoleName;
    const authUser: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: roleName,
      branchId: user.branchId,
      branchCode: (user.branch?.code as BranchCode) ?? null,
      branchType: user.branch?.type ?? null,
      permissions: ROLE_PERMISSIONS[roleName] || [],
      language: (user.language as 'en' | 'so') || 'en',
      mustChangePassword: user.mustChangePassword ?? false,
    };

    const accessToken = signAccessToken(authUser);
    const rawRefreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          deviceId: deviceId ? String(deviceId).slice(0, 64) : 'browser',
          expiresAt,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    await recordAuditLog({
      branchId: user.branchId,
      userId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('baxnaano_refresh', rawRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      user: authUser,
    });
  } catch (error: any) {
    if (error?.code === 'P1001' || error?.message?.includes("Can't reach database server")) {
      console.warn('[Auth] Database connection error: Cannot reach PostgreSQL database.');
      res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        messageKey: 'common.errors.server_error',
        message: 'Cannot reach the central database server.',
      });
      return;
    }
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', messageKey: 'common.errors.server_error' });
  }
});

/**
 * POST /api/auth/refresh
 * Rotates refresh token, detects token reuse, and issues a new 15-minute access token.
 */
authRouter.post(
  '/refresh',
  verifyCsrfForCookieEndpoint,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const rawToken = req.cookies?.baxnaano_refresh || req.body?.refreshToken;
      if (!rawToken || typeof rawToken !== 'string') {
        res.status(401).json({ error: 'MISSING_REFRESH_TOKEN', messageKey: 'auth.errors.session_expired' });
        return;
      }

      const tokenHash = hashToken(rawToken);
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: { role: true, branch: true },
          },
        },
      });

      if (!stored) {
        res.status(401).json({ error: 'INVALID_REFRESH_TOKEN', messageKey: 'auth.errors.session_expired' });
        return;
      }

      // Refresh token reuse detection: if a previously revoked token is re-presented, revoke all sessions for that user
      if (stored.revokedAt) {
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        res.clearCookie('baxnaano_refresh', {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/api/auth',
        });
        res.status(401).json({ error: 'REFRESH_TOKEN_REUSED', messageKey: 'auth.errors.session_expired' });
        return;
      }

      if (stored.expiresAt < new Date() || !stored.user.isActive || stored.user.deletedAt) {
        res.status(401).json({ error: 'INVALID_REFRESH_TOKEN', messageKey: 'auth.errors.session_expired' });
        return;
      }

      const user = stored.user;
      const roleName = user.role.name as RoleName;
      const authUser: AuthenticatedUser = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: roleName,
        branchId: user.branchId,
        branchCode: (user.branch?.code as BranchCode) ?? null,
        branchType: user.branch?.type ?? null,
        permissions: ROLE_PERMISSIONS[roleName] || [],
        language: (user.language as 'en' | 'so') || 'en',
        mustChangePassword: user.mustChangePassword ?? false,
      };

      const newRawRefreshToken = crypto.randomBytes(48).toString('hex');
      const newTokenHash = hashToken(newRawRefreshToken);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

      await prisma.$transaction([
        prisma.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() },
        }),
        prisma.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: newTokenHash,
            deviceId: stored.deviceId,
            expiresAt,
          },
        }),
      ]);

      const accessToken = signAccessToken(authUser);

      res.cookie('baxnaano_refresh', newRawRefreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      });

      res.json({
        accessToken,
        user: authUser,
      });
    } catch (error) {
      console.error('[Auth] Refresh error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', messageKey: 'common.errors.server_error' });
    }
  }
);

/**
 * POST /api/auth/logout
 * Revokes refresh token in database and clears HttpOnly cookie.
 */
authRouter.post(
  '/logout',
  verifyCsrfForCookieEndpoint,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const rawToken = req.cookies?.baxnaano_refresh || req.body?.refreshToken;
      if (rawToken && typeof rawToken === 'string') {
        const tokenHash = hashToken(rawToken);
        await prisma.refreshToken.updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      res.clearCookie('baxnaano_refresh', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/auth/me
 */
authRouter.get('/me', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/change-password
 * Forces or allows users to update their password, revokes all prior refresh tokens,
 * and returns a fresh access token with mustChangePassword: false.
 */
authRouter.post(
  '/change-password',
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = ChangePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { currentPassword, newPassword } = parsed.data;
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: { role: true, branch: true },
      });

      if (!user || !user.isActive || user.deletedAt) {
        res.status(401).json({ error: 'USER_NOT_FOUND' });
        return;
      }

      if (currentPassword) {
        const valid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!valid) {
          res.status(400).json({
            error: 'INVALID_CURRENT_PASSWORD',
            messageKey: 'auth.errors.invalid_credentials',
          });
          return;
        }
      } else if (!user.mustChangePassword) {
        res.status(400).json({
          error: 'CURRENT_PASSWORD_REQUIRED',
          messageKey: 'auth.errors.invalid_credentials',
        });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, BCRYPT_COST_FACTOR);

      // Update password AND revoke all old refresh tokens for this user
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: newHash,
            mustChangePassword: false,
            version: { increment: 1 },
          },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      const roleName = user.role.name as RoleName;
      const updatedAuthUser: AuthenticatedUser = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: roleName,
        branchId: user.branchId,
        branchCode: (user.branch?.code as BranchCode) ?? null,
        branchType: user.branch?.type ?? null,
        permissions: ROLE_PERMISSIONS[roleName] || [],
        language: (user.language as 'en' | 'so') || 'en',
        mustChangePassword: false,
      };

      const freshAccessToken = signAccessToken(updatedAuthUser);

      await recordAuditLog({
        branchId: user.branchId,
        userId: user.id,
        action: 'AUTH_PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        accessToken: freshAccessToken,
        user: updatedAuthUser,
      });
    } catch (error) {
      console.error('[Auth] Change password error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/auth/users (Admin only - create branch or admin user)
 */
authRouter.post(
  '/users',
  authenticateJWT,
  requireRoles('ADMIN'),
  requirePermissions('users:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      if (data.role !== 'ADMIN' && !data.branchId) {
        res.status(400).json({
          error: 'BRANCH_REQUIRED_FOR_NON_ADMIN',
          messageKey: 'users.errors.branch_required',
        });
        return;
      }

      const roleRecord = await prisma.role.findUnique({ where: { name: data.role } });
      if (!roleRecord) {
        res.status(400).json({ error: 'INVALID_ROLE' });
        return;
      }

      const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST_FACTOR);

      const created = await prisma.user.create({
        data: {
          id: data.id,
          branchId: data.role === 'ADMIN' ? null : data.branchId,
          roleId: roleRecord.id,
          username: data.username,
          email: data.email ?? null,
          fullName: data.fullName,
          phone: data.phone ?? null,
          passwordHash,
          language: data.language,
          mustChangePassword: true,
        },
      });

      await recordAuditLog({
        branchId: created.branchId,
        userId: req.user!.id,
        action: 'USER_CREATE',
        entityType: 'User',
        entityId: created.id,
        newData: { username: created.username, role: data.role, branchId: created.branchId },
        ipAddress: req.ip,
      });

      res.status(201).json({
        id: created.id,
        username: created.username,
        fullName: created.fullName,
        role: data.role,
        branchId: created.branchId,
      });
    } catch (error) {
      console.error('[Auth] Create user error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/auth/users
 * Returns list of staff and cashier accounts for admin management (never exposes passwordHash or pinHash)
 */
authRouter.get(
  '/users',
  authenticateJWT,
  requireRoles('ADMIN'),
  requirePermissions('users:manage'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          username: true,
          fullName: true,
          phone: true,
          email: true,
          isActive: true,
          branchId: true,
          role: { select: { name: true } },
          branch: { select: { id: true, code: true, name: true, location: true } },
          createdAt: true,
        },
        orderBy: { username: 'asc' },
      });

      res.json({
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          phone: u.phone,
          email: u.email,
          isActive: u.isActive,
          role: u.role.name,
          branchId: u.branchId,
          branchCode: u.branch?.code || null,
          branchName: u.branch?.name || null,
          branchLocation: u.branch?.location || null,
        })),
      });
    } catch (error) {
      console.error('[Auth] Get users error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * PATCH /api/auth/users/:id
 * Admin-only endpoint to update staff profile name, phone, email, role, status, or reset password.
 * Revokes all active refresh tokens if password, role, or isActive status is modified.
 */
authRouter.patch(
  '/users/:id',
  authenticateJWT,
  requireRoles('ADMIN'),
  requirePermissions('users:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { fullName, phone, email, password, role, isActive } = req.body || {};

      const existing = await prisma.user.findUnique({
        where: { id },
        include: { role: true },
      });
      if (!existing || existing.deletedAt) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      let shouldRevokeSessions = false;

      if (fullName !== undefined) {
        const trimmed = String(fullName).trim();
        if (trimmed.length < 2 || trimmed.length > 100) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'fullName must be 2–100 chars' });
          return;
        }
        updateData.fullName = trimmed;
      }
      if (phone !== undefined) updateData.phone = phone ? String(phone).trim().slice(0, 25) : null;
      if (email !== undefined) updateData.email = email ? String(email).trim().slice(0, 120) : null;

      if (isActive !== undefined && Boolean(isActive) !== existing.isActive) {
        updateData.isActive = Boolean(isActive);
        shouldRevokeSessions = true;
      }

      if (role !== undefined && ROLES.includes(role as RoleName) && role !== existing.role.name) {
        const roleRecord = await prisma.role.findUnique({ where: { name: role as RoleName } });
        if (!roleRecord) {
          res.status(400).json({ error: 'INVALID_ROLE' });
          return;
        }
        updateData.roleId = roleRecord.id;
        shouldRevokeSessions = true;
      }

      if (password) {
        const rawPass = String(password);
        if (rawPass.length < 8 || rawPass.length > 128) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be 8–128 chars' });
          return;
        }
        updateData.passwordHash = await bcrypt.hash(rawPass, BCRYPT_COST_FACTOR);
        updateData.mustChangePassword = true;
        shouldRevokeSessions = true;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id },
          data: {
            ...updateData,
            version: { increment: 1 },
          },
          select: {
            id: true,
            username: true,
            fullName: true,
            phone: true,
            email: true,
            isActive: true,
            branchId: true,
            role: { select: { name: true } },
          },
        });

        if (shouldRevokeSessions) {
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        return u;
      });

      await recordAuditLog({
        branchId: updated.branchId,
        userId: req.user!.id,
        action: role && role !== existing.role.name ? 'USER_ROLE_CHANGE' : 'USER_UPDATE',
        entityType: 'User',
        entityId: updated.id,
        oldData: {
          fullName: existing.fullName,
          phone: existing.phone,
          role: existing.role.name,
          isActive: existing.isActive,
        },
        newData: {
          fullName: updated.fullName,
          phone: updated.phone,
          role: updated.role.name,
          isActive: updated.isActive,
          passwordReset: Boolean(password),
        },
        ipAddress: req.ip,
      });

      res.json({ user: updated });
    } catch (error) {
      console.error('[Auth] Update user error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);
