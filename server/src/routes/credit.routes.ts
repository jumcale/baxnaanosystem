import { Router, Request, Response } from 'express';
import { CreditTransactionType, Currency, PaymentMethod, Species } from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import {
  CreateCustomerSchema,
  CreditRepaymentSchema,
  computeCustomerCreditAging,
  hasPermission,
  normalizePaymentToUsd,
} from '@baxnaano/shared';
import { recordAuditLog } from '../utils/audit';

export const creditRouter = Router();

creditRouter.use(authenticateJWT);

/**
 * GET /api/credit/customers
 * Returns branch customers with their live balance, credit limit, and FIFO aging buckets
 */
creditRouter.get(
  '/customers',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('credit:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const search = (req.query.search as string | undefined)?.trim();

      const customers = await prisma.customer.findMany({
        where: scopedWhere(req, {
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { phone: { contains: search, mode: 'insensitive' as const } },
                  { villageOrFarm: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        }),
        include: {
          branch: { select: { id: true, code: true, name: true } },
          creditEntries: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { currentBalanceUsd: 'desc' },
      });

      const enriched = customers.map((c) => {
        const aging = computeCustomerCreditAging(
          c.creditEntries.map((e) => ({
            id: e.id,
            type: e.type,
            amountDeltaUsd: Number(e.amountDeltaUsd),
            createdAt: e.createdAt,
            dueDate: e.dueDate,
          }))
        );

        return {
          ...c,
          aging,
          isOverLimit: Number(c.currentBalanceUsd) > Number(c.creditLimitUsd),
        };
      });

      res.json({ customers: enriched });
    } catch (error) {
      console.error('[Credit] Customers list error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/credit/customers
 * Create or update a Customer & their Credit Limit (strictly prevents cross-branch IDOR & enforces credit:manage_limit)
 */
creditRouter.post(
  '/customers',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('credit:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateCustomerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const existing = data.id
        ? await prisma.customer.findUnique({ where: { id: data.id } })
        : null;

      if (existing && existing.branchId !== data.branchId) {
        res.status(403).json({ error: 'CROSS_BRANCH_ACCESS_DENIED' });
        return;
      }

      const canManageLimit = hasPermission(req.user!.role, 'credit:manage_limit');
      const effectiveCreditLimit = existing
        ? canManageLimit
          ? data.creditLimitUsd
          : Number(existing.creditLimitUsd)
        : canManageLimit
          ? data.creditLimitUsd
          : Math.min(100, data.creditLimitUsd);

      const customer = await prisma.customer.upsert({
        where: { id: data.id || '00000000-0000-0000-0000-000000000000' },
        update: {
          name: data.name,
          phone: data.phone,
          address: data.address ?? null,
          villageOrFarm: data.villageOrFarm ?? null,
          primarySpecies: data.primarySpecies as Species[],
          herdSizeEstimate: data.herdSizeEstimate ?? null,
          creditLimitUsd: effectiveCreditLimit,
          version: { increment: 1 },
        },
        create: {
          id: data.id,
          branchId: data.branchId,
          name: data.name,
          phone: data.phone,
          address: data.address ?? null,
          villageOrFarm: data.villageOrFarm ?? null,
          primarySpecies: data.primarySpecies as Species[],
          herdSizeEstimate: data.herdSizeEstimate ?? null,
          creditLimitUsd: effectiveCreditLimit,
        },
      });

      if (existing && Number(existing.creditLimitUsd) !== effectiveCreditLimit) {
        await recordAuditLog({
          branchId: customer.branchId,
          userId: req.user!.id,
          action: 'CUSTOMER_CREDIT_LIMIT_UPDATE',
          entityType: 'Customer',
          entityId: customer.id,
          oldData: { creditLimitUsd: Number(existing.creditLimitUsd) },
          newData: { creditLimitUsd: effectiveCreditLimit },
          ipAddress: req.ip,
        });
      }

      res.status(201).json({ customer });
    } catch (error) {
      console.error('[Credit] Save customer error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/credit/repayments
 * Records a full or partial customer credit repayment with branch-scoped IDOR & idempotency protection.
 */
creditRouter.post(
  ['/repayments', '/payments'],
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('credit:payment'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreditRepaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const amountUsd = normalizePaymentToUsd(
        data.amountOriginal,
        data.currency,
        data.exchangeRateUsed
      );

      const result = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({
          where: scopedWhere(req, { id: data.customerId }),
        });

        if (!customer) {
          throw new Error('CUSTOMER_NOT_FOUND');
        }

        if (data.id) {
          const existing = await tx.creditLedger.findUnique({ where: { id: data.id } });
          if (existing) {
            if (existing.branchId !== customer.branchId) {
              throw new Error('CROSS_BRANCH_ACCESS_DENIED');
            }
            return { ledgerEntry: existing, customer, idempotentReplay: true };
          }
        }

        const effectiveBranchId = customer.branchId;

        const updatedCustomer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            currentBalanceUsd: { decrement: amountUsd },
            version: { increment: 1 },
          },
        });

        const ledgerEntry = await tx.creditLedger.create({
          data: {
            id: data.id,
            branchId: effectiveBranchId,
            customerId: customer.id,
            type: CreditTransactionType.PAYMENT,
            amountDeltaUsd: -Math.abs(amountUsd),
            balanceAfterUsd: updatedCustomer.currentBalanceUsd,
            isSettled: Number(updatedCustomer.currentBalanceUsd) <= 0,
            paymentMethod: data.method as PaymentMethod,
            notes: data.notes ?? `Credit Repayment via ${data.method}`,
            recordedById: req.user!.id,
          },
        });

        await tx.payment.create({
          data: {
            branchId: effectiveBranchId,
            creditLedgerId: ledgerEntry.id,
            method: data.method as PaymentMethod,
            currency: data.currency as Currency,
            amountOriginal: data.amountOriginal,
            amountUsd,
            exchangeRateUsed: data.exchangeRateUsed,
            referencePhone: data.referencePhone ?? null,
            transactionRef: data.transactionRef ?? null,
          },
        });

        return { ledgerEntry, customer: updatedCustomer, idempotentReplay: false };
      });

      await recordAuditLog({
        branchId: result.ledgerEntry.branchId,
        userId: req.user!.id,
        action: 'CREDIT_REPAYMENT',
        entityType: 'CreditLedger',
        entityId: result.ledgerEntry.id,
        newData: { customerId: data.customerId, amountUsd, method: data.method },
        ipAddress: req.ip,
      });

      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'REPAYMENT_ERROR';
      if (msg === 'CUSTOMER_NOT_FOUND') {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === 'CROSS_BRANCH_ACCESS_DENIED') {
        res.status(403).json({ error: msg });
        return;
      }
      console.error('[Credit] Repayment error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/credit/ledger
 * List credit transactions
 */
creditRouter.get(
  '/ledger',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('credit:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = req.query.customerId as string | undefined;
      const entries = await prisma.creditLedger.findMany({
        where: scopedWhere(req, {
          ...(customerId ? { customerId } : {}),
        }),
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          sale: { select: { id: true, receiptNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ entries });
    } catch (error) {
      console.error('[Credit] Ledger error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/credit/customers/:id/statement
 */
creditRouter.get(
  '/customers/:id/statement',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('credit:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customer = await prisma.customer.findFirst({
        where: scopedWhere(req, { id: req.params.id }),
        include: {
          branch: true,
          creditEntries: {
            where: { deletedAt: null },
            include: {
              sale: { select: { id: true, receiptNumber: true, totalUsd: true, soldAt: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!customer) {
        res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
        return;
      }

      const aging = computeCustomerCreditAging(
        customer.creditEntries.map((e) => ({
          id: e.id,
          type: e.type,
          amountDeltaUsd: Number(e.amountDeltaUsd),
          createdAt: e.createdAt,
          dueDate: e.dueDate,
        }))
      );

      res.json({ customer, aging });
    } catch (error) {
      console.error('[Credit] Statement error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);
