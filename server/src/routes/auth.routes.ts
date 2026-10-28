import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../config/db';
import {
  LoginSchema,
  CreateUserSchema,
  AuthenticatedUser,
  ROLE_PERMISSIONS,
  RoleName,
  BranchCode,
} from '@baxnaano/shared';
import {
  authenticateJWT,
  requirePermissions,
  signAccessToken,
} from '../middleware/auth';
import { recordAuditLog } from '../utils/audit';

export const authRouter = Router();

const REFRESH_TOKEN_TTL_DAYS = 30;

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * POST /api/auth/login
 * Authenticates user, returns JWT access token + refresh token, and writes AuditLog.
 */
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
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

    const user = await prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
        deletedAt: null,
      },
      include: {
        role: true,
        branch: true,
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        messageKey: 'auth.errors.invalid_credentials',
      });
      return;
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      await recordAuditLog({
        branchId: user.branchId,
        userId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        messageKey: 'auth.errors.invalid_credentials',
      });
      return;
    }

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
          deviceId: deviceId ?? 'browser',
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      refreshToken: rawRefreshToken,
      user: authUser,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', messageKey: 'common.errors.server_error' });
  }
});

/**
 * POST /api/auth/refresh
 * Rotates refresh token and issues new access token.
 */
authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = req.cookies?.baxnaano_refresh || req.body?.refreshToken;
    if (!rawToken) {
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

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      refreshToken: newRawRefreshToken,
      user: authUser,
    });
  } catch (error) {
    console.error('[Auth] Refresh error:', error);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', messageKey: 'common.errors.server_error' });
  }
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = req.cookies?.baxnaano_refresh || req.body?.refreshToken;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie('baxnaano_refresh');
    res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Logout error:', error);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/offline-exchange
 * Upgrades an offline cached session into a live JWT access token when the device reconnects.
 */
authRouter.post('/offline-exchange', async (req: Request, res: Response): Promise<void> => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) {
      res.status(400).json({ error: 'USERNAME_REQUIRED' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
      include: { role: true, branch: true },
    });

    if (!user) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }

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
    };

    const accessToken = signAccessToken(authUser);
    res.json({ accessToken, user: authUser });
  } catch (error) {
    console.error('[Auth] Offline exchange error:', error);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/users (Admin only - create branch or admin user)
 */
authRouter.post(
  '/users',
  authenticateJWT,
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

      const passwordHash = await bcrypt.hash(data.password, 12);

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
