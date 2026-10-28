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
 * Lists branch quotations (Qiimeyn) and marks expired ones
 */
quotationsRouter.get(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('quotations:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const quotations = await prisma.quotation.findMany({
        where: scopedWhere(req),
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
 * Create or edit a Quotation (Qiimeyn)
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
      const subtotalUsd = Number(
        data.items
          .reduce((sum, i) => sum + i.quantity * i.unitPriceUsd, 0)
          .toFixed(2)
      );
      const lineDiscounts = data.items.reduce((sum, i) => sum + (i.discountUsd || 0), 0);
      const totalDiscountUsd = Number((lineDiscounts + data.discountUsd).toFixed(2));
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
                (item.quantity * item.unitPriceUsd - (item.discountUsd || 0)).toFixed(2)
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
 * Marks a Quotation as CONVERTED and links convertedSaleId
 */
quotationsRouter.post(
  '/:id/mark-converted',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('quotations:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { convertedSaleId } = req.body as { convertedSaleId?: string };
      const updated = await prisma.quotation.update({
        where: { id: req.params.id },
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
