import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJWT, enforceBranchScope } from '../middleware/auth';

export const branchesRouter = Router();

/**
 * GET /api/branches
 * - Admin receives all 3 branches (B1, B2, B3)
 * - Branch users receive only their own assigned branch
 */
branchesRouter.get(
  '/',
  authenticateJWT,
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const whereClause =
        req.user?.role === 'ADMIN'
          ? { deletedAt: null }
          : { id: req.user?.branchId ?? '', deletedAt: null };

      const branches = await prisma.branch.findMany({
        where: whereClause,
        orderBy: { code: 'asc' },
      });

      res.json({ branches });
    } catch (error) {
      console.error('[Branches] Fetch error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);
