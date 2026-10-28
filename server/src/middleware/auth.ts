import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
  AuthenticatedUser,
  Permission,
  RoleName,
  ROLE_PERMISSIONS,
  hasPermission,
  BranchCode,
} from '@baxnaano/shared';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'baxnaano-prod-access-secret-change-me';

export interface BranchScopeContext {
  /** If null, the user is an ADMIN viewing 'ALL' branches consolidated */
  branchId: string | null;
  isAllBranches: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      branchScope?: BranchScopeContext;
    }
  }
}

/**
 * 1. Authenticate JWT Bearer Token
 */
export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      messageKey: 'auth.errors.missing_token',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET) as AuthenticatedUser;
    // Attach canonical permissions from role
    payload.permissions = ROLE_PERMISSIONS[payload.role] || [];
    req.user = payload;
    next();
  } catch {
    res.status(401).json({
      error: 'TOKEN_EXPIRED_OR_INVALID',
      messageKey: 'auth.errors.invalid_token',
    });
  }
}

/**
 * 2. Require specific role(s)
 */
export function requireRoles(...allowedRoles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', messageKey: 'auth.errors.unauthorized' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN_ROLE',
        messageKey: 'auth.errors.insufficient_role',
        requiredRoles: allowedRoles,
      });
      return;
    }
    next();
  };
}

/**
 * 3. Require specific granular permission(s)
 */
export function requirePermissions(...requiredPermissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', messageKey: 'auth.errors.unauthorized' });
      return;
    }
    const missing = requiredPermissions.filter((perm) => !hasPermission(req.user!.role, perm));
    if (missing.length > 0) {
      res.status(403).json({
        error: 'FORBIDDEN_PERMISSION',
        messageKey: 'auth.errors.insufficient_permission',
        missingPermissions: missing,
      });
      return;
    }
    next();
  };
}

/**
 * 4. Strict Branch Isolation & Admin Scope Middleware
 * - Non-Admin users are strictly locked to their own `req.user.branchId`.
 *   Any attempt to pass another `branchId` in body/query/headers is rejected or overridden.
 * - Admin users can pass `?branchId=B1` or header `x-branch-id: B1` to scope to a specific branch,
 *   or `ALL` (default for Admin reads) to view consolidated data across B1, B2, and B3.
 * - For write operations (`POST`, `PUT`, `PATCH`, `DELETE`), a concrete `branchId` is mandatory even for Admin.
 */
export function enforceBranchScope(options: { requireConcreteBranchForWrites?: boolean } = { requireConcreteBranchForWrites: true }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', messageKey: 'auth.errors.unauthorized' });
      return;
    }

    const requestedBranch =
      (req.headers['x-branch-id'] as string | undefined) ||
      (req.query.branchId as string | undefined) ||
      (req.body?.branchId as string | undefined);

    if (user.role === 'ADMIN') {
      if (!requestedBranch || requestedBranch === 'ALL') {
        const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
        if (isWriteMethod && options.requireConcreteBranchForWrites) {
          res.status(400).json({
            error: 'BRANCH_ID_REQUIRED',
            messageKey: 'branch.errors.select_specific_branch_for_write',
          });
          return;
        }
        req.branchScope = { branchId: null, isAllBranches: true };
      } else {
        req.branchScope = { branchId: requestedBranch, isAllBranches: false };
        if (req.body && typeof req.body === 'object') {
          req.body.branchId = requestedBranch;
        }
      }
      next();
      return;
    }

    // Non-admin user: MUST belong to a branch
    if (!user.branchId) {
      res.status(403).json({
        error: 'NO_BRANCH_ASSIGNED',
        messageKey: 'branch.errors.no_branch_assigned',
      });
      return;
    }

    // Reject cross-branch tampering attempts
    if (requestedBranch && requestedBranch !== user.branchId && requestedBranch !== user.branchCode) {
      res.status(403).json({
        error: 'CROSS_BRANCH_ACCESS_DENIED',
        messageKey: 'branch.errors.cross_branch_denied',
      });
      return;
    }

    req.branchScope = {
      branchId: user.branchId,
      isAllBranches: false,
    };

    // Force body branchId to user's branchId on mutations
    if (req.body && typeof req.body === 'object') {
      req.body.branchId = user.branchId;
    }

    next();
  };
}

/**
 * Helper to build Prisma `where` filter with automatic Branch & Soft-Delete scoping
 */
export function scopedWhere<T extends Record<string, unknown>>(
  req: Request,
  additionalWhere: T = {} as T
): T & { branchId?: string; deletedAt: null } {
  const base: { branchId?: string; deletedAt: null } = { deletedAt: null };
  if (req.branchScope && !req.branchScope.isAllBranches && req.branchScope.branchId) {
    base.branchId = req.branchScope.branchId;
  }
  return {
    ...additionalWhere,
    ...base,
  };
}

export function signAccessToken(user: AuthenticatedUser): string {
  return jwt.sign(user, JWT_ACCESS_SECRET, { expiresIn: '8h' });
}
