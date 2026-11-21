import { Router, Request, Response } from 'express';
import { Currency } from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import { CreateQuotationSchema, usdToSlsh } from '@baxnaano/shared';

export const quotationsRouter = Router();

quotationsRouter.use(authenticateJWT);

/**
 * GET /api/quotations
 * Lists branch quotations (Qiimeyn) and marks expired ones.
 * Enforces VET_OFFICER own-activity isolation.
 */
quotationsRouter.get(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('quotations:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const quotations = await prisma.quotation.findMany({
        where: scopedWhere(req, {
          ...(req.user?.role === 'VET_OFFICER' ? { createdById: req.user.id } : {}),
        }),
        include: {
          branch: { select: { id: true, code: true, name: true, location: true } },
          customer: true,
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const now = new Date();
      const enriched = quotations.map((q) => ({
        ...q,
        status:
          q.status !== 'CONVERTED' && new Date(q.validUntil) < now ? 'EXPIRED' : q.status,
      }));

      res.json({ quotations: enriched });
    } catch (error) {
      console.error('[Quotations] List error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/quotations
 * Create a Quotation (Qiimeyn) with branch-scoped idempotency check
 */
quotationsRouter.post(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('quotations:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateQuotationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;

      if (data.id) {
        const existing = await prisma.quotation.findUnique({ where: { id: data.id } });
        if (existing) {
          if (existing.branchId !== data.branchId) {
            res.status(403).json({ error: 'CROSS_BRANCH_ACCESS_DENIED' });
            return;
          }
          res.status(200).json({ quotation: existing });
          return;
        }
      }

      const subtotalUsd = Number(
        data.items
          .reduce((sum, i) => sum + i.quantity * i.unitPriceUsd, 0)
          .toFixed(2)
      );
      const lineDiscounts = data.items.reduce((sum, i) => sum + (i.discountUsd || 0), 0);
      const totalDiscountUsd = Math.min(
        subtotalUsd,
        Number((lineDiscounts + data.discountUsd).toFixed(2))
      );
      const totalUsd = Number(Math.max(0, subtotalUsd - totalDiscountUsd).toFixed(2));
      const totalSlsh = usdToSlsh(totalUsd, data.exchangeRateUsed);

      const quotationNumber =
        data.quotationNumber || `QTN-${Date.now().toString().slice(-6)}`;

      const quotation = await prisma.quotation.create({
        data: {
          id: data.id,
          branchId: data.branchId,
          quotationNumber,
          customerId: data.customerId ?? null,
          customerName: data.customerName ?? null,
          customerPhone: data.customerPhone ?? null,
          status: 'SENT',
          currency: data.currency as Currency,
          exchangeRateUsed: data.exchangeRateUsed,
          subtotalUsd,
          discountUsd: totalDiscountUsd,
          totalUsd,
          totalSlsh,
          validUntil: new Date(data.validUntil),
          notes: data.notes ?? null,
          createdById: req.user!.id,
          items: {
            create: data.items.map((item) => ({
              branchId: data.branchId,
              productId: item.productId,
              quantity: item.quantity,
              unitPriceUsd: item.unitPriceUsd,
              discountUsd: item.discountUsd || 0,
              subtotalUsd: Number(
                Math.max(0, item.quantity * item.unitPriceUsd - (item.discountUsd || 0)).toFixed(2)
              ),
            })),
          },
        },
        include: {
          items: { include: { product: true } },
        },
      });

      res.status(201).json({ quotation });
    } catch (error) {
      console.error('[Quotations] Create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/quotations/:id/mark-converted
 * Marks a Quotation as CONVERTED and links convertedSaleId (strictly branch-scoped to prevent IDOR)
 */
quotationsRouter.post(
  '/:id/mark-converted',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('quotations:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const existing = await prisma.quotation.findFirst({
        where: scopedWhere(req, {
          id: req.params.id,
          ...(req.user?.role === 'VET_OFFICER' ? { createdById: req.user.id } : {}),
        }),
      });

      if (!existing) {
        res.status(404).json({ error: 'QUOTATION_NOT_FOUND' });
        return;
      }

      const { convertedSaleId } = req.body as { convertedSaleId?: string };
      const updated = await prisma.quotation.update({
        where: { id: existing.id },
        data: {
          status: 'CONVERTED',
          convertedSaleId: convertedSaleId ?? null,
          version: { increment: 1 },
        },
      });
      res.json({ quotation: updated });
    } catch (error) {
      console.error('[Quotations] Convert error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);
