import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
  AuthenticatedUser,
  Permission,
  RoleName,
  ROLE_PERMISSIONS,
  hasPermission,
  BAXNAANO_BRANCHES,
} from '@baxnaano/shared';
import { env } from '../config/env';

const JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET;

const VALID_BRANCH_IDS = new Set<string>([
  BAXNAANO_BRANCHES.B1.id,
  BAXNAANO_BRANCHES.B2.id,
  BAXNAANO_BRANCHES.B3.id,
  'B1',
  'B2',
  'B3',
]);

export function resolveCanonicalBranchId(rawBranchId: string): string | null {
  if (rawBranchId === 'B1' || rawBranchId === BAXNAANO_BRANCHES.B1.id) {
    return BAXNAANO_BRANCHES.B1.id;
  }
  if (rawBranchId === 'B2' || rawBranchId === BAXNAANO_BRANCHES.B2.id) {
    return BAXNAANO_BRANCHES.B2.id;
  }
  if (rawBranchId === 'B3' || rawBranchId === BAXNAANO_BRANCHES.B3.id) {
    return BAXNAANO_BRANCHES.B3.id;
  }
  return null;
}

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
 * 1. Authenticate JWT Bearer Token & Enforce Server-Side mustChangePassword
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
    const payload = jwt.verify(token, JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as AuthenticatedUser;

    // Attach canonical permissions from role (never trust client-tampered permissions array)
    payload.permissions = ROLE_PERMISSIONS[payload.role] || [];
    req.user = payload;

    // Server-side enforcement of mustChangePassword on every route except password change, logout, and /me
    if (payload.mustChangePassword) {
      const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
      const isAllowedDuringForcedReset =
        fullPath.endsWith('/change-password') ||
        fullPath.endsWith('/logout') ||
        fullPath.endsWith('/me');

      if (!isAllowedDuringForcedReset) {
        res.status(403).json({
          error: 'PASSWORD_CHANGE_REQUIRED',
          messageKey: 'auth.errors.password_change_required',
          message: 'You must change your temporary password before accessing any module.',
        });
        return;
      }
    }

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
 * - Non-Admin users are strictly locked to their JWT `req.user.branchId`.
 *   Any attempt to pass another `branchId` in body/query/headers/params is rejected with 403 CROSS_BRANCH_ACCESS_DENIED.
 * - Admin users can pass `?branchId=B1` or header `x-branch-id: B1` to scope to a specific branch,
 *   or `ALL` (default for Admin reads) to view consolidated data across B1, B2, and B3.
 * - For write operations (`POST`, `PUT`, `PATCH`, `DELETE`), a concrete `branchId` is mandatory even for Admin.
 */
export function enforceBranchScope(
  options: { requireConcreteBranchForWrites?: boolean } = { requireConcreteBranchForWrites: true }
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', messageKey: 'auth.errors.unauthorized' });
      return;
    }

    const headerBranch = req.headers['x-branch-id'] as string | undefined;
    const queryBranch = req.query.branchId as string | undefined;
    const bodyBranch = req.body?.branchId as string | undefined;

    if (user.role === 'ADMIN') {
      // Precedence for Admin: explicit body.branchId on writes -> query.branchId -> header x-branch-id
      const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      const requestedBranch = isWriteMethod
        ? (bodyBranch && bodyBranch !== 'ALL' ? bodyBranch : queryBranch && queryBranch !== 'ALL' ? queryBranch : headerBranch)
        : (queryBranch || headerBranch || bodyBranch);

      if (!requestedBranch || requestedBranch === 'ALL') {
        if (isWriteMethod && options.requireConcreteBranchForWrites) {
          res.status(400).json({
            error: 'BRANCH_ID_REQUIRED',
            messageKey: 'branch.errors.select_specific_branch_for_write',
          });
          return;
        }
        req.branchScope = { branchId: null, isAllBranches: true };
      } else {
        const canonical = resolveCanonicalBranchId(requestedBranch) || requestedBranch;
        if (!VALID_BRANCH_IDS.has(requestedBranch) && !VALID_BRANCH_IDS.has(canonical)) {
          res.status(400).json({
            error: 'INVALID_BRANCH_ID',
            messageKey: 'branch.errors.invalid_branch',
          });
          return;
        }
        req.branchScope = { branchId: canonical, isAllBranches: false };
        if (req.body && typeof req.body === 'object') {
          req.body.branchId = canonical;
        }
      }
      next();
      return;
    }

    // Non-admin user: MUST belong to a branch in their JWT
    if (!user.branchId) {
      res.status(403).json({
        error: 'NO_BRANCH_ASSIGNED',
        messageKey: 'branch.errors.no_branch_assigned',
      });
      return;
    }

    // Check every input vector (header, query, body) for cross-branch tampering
    const candidateVectors = [headerBranch, queryBranch, bodyBranch].filter(
      (v): v is string => Boolean(v) && v !== 'ALL'
    );

    for (const candidate of candidateVectors) {
      const canonicalCandidate = resolveCanonicalBranchId(candidate) || candidate;
      if (canonicalCandidate !== user.branchId && candidate !== user.branchCode) {
        res.status(403).json({
          error: 'CROSS_BRANCH_ACCESS_DENIED',
          messageKey: 'branch.errors.cross_branch_denied',
        });
        return;
      }
    }

    req.branchScope = {
      branchId: user.branchId,
      isAllBranches: false,
    };

    // Always overwrite body.branchId and query.branchId with the JWT's authoritative branchId
    if (req.body && typeof req.body === 'object') {
      req.body.branchId = user.branchId;
    }
    if (req.query && typeof req.query === 'object') {
      req.query.branchId = user.branchId;
    }

    next();
  };
}

/**
 * Helper to build Prisma `where` filter with automatic Branch & Soft-Delete scoping.
 * Notice `...base` is spread AFTER `...additionalWhere` so caller fields can NEVER override `branchId` or `deletedAt`.
 */
export function scopedWhere<T extends Record<string, unknown>>(
  req: Request,
  additionalWhere: T = {} as T
): T & { branchId?: string; deletedAt: null } {
  const base: { branchId?: string; deletedAt: null } = { deletedAt: null };
  if (req.branchScope && !req.branchScope.isAllBranches && req.branchScope.branchId) {
    base.branchId = req.branchScope.branchId;
  } else if (req.user && req.user.role !== 'ADMIN' && req.user.branchId) {
    base.branchId = req.user.branchId;
  }
  return {
    ...additionalWhere,
    ...base,
  };
}

/**
 * Issues a short-lived 15-minute JWT access token (HS256).
 */
export function signAccessToken(user: AuthenticatedUser): string {
  return jwt.sign(user, JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}
