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
  normalizePaymentToUsd,
} from '@baxnaano/shared';
import { recordAuditLog } from '../utils/audit';

export const creditRouter = Router();

creditRouter.use(authenticateJWT);

/**
 * GET /api/credit/customers
 * Returns branch customers with their live balance, credit limit, and FIFO aging buckets
 * (0-30 days, 31-60 days, 60+ days) + overdue alert flag.
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
 * Create or update a Customer & their Credit Limit
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
      const customer = await prisma.customer.upsert({
        where: { id: data.id || '00000000-0000-0000-0000-000000000000' },
        update: {
          name: data.name,
          phone: data.phone,
          address: data.address ?? null,
          villageOrFarm: data.villageOrFarm ?? null,
          primarySpecies: data.primarySpecies as Species[],
          herdSizeEstimate: data.herdSizeEstimate ?? null,
          creditLimitUsd: data.creditLimitUsd,
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
          creditLimitUsd: data.creditLimitUsd,
        },
      });

      res.status(201).json({ customer });
    } catch (error) {
      console.error('[Credit] Save customer error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/credit/repayments
 * Records a full or partial customer credit repayment (Cash, EVC Plus, Zaad, eDahab)
 * in USD or SLSH, updates Customer.currentBalanceUsd, and writes Payment + CreditLedger entry.
 */
creditRouter.post(
  '/repayments',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
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
        if (data.id) {
          const existing = await tx.creditLedger.findUnique({ where: { id: data.id } });
          if (existing) return { ledgerEntry: existing, idempotentReplay: true };
        }

        const customer = await tx.customer.findFirst({
          where: { id: data.customerId, branchId: data.branchId, deletedAt: null },
        });

        if (!customer) {
          throw new Error('CUSTOMER_NOT_FOUND');
        }

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
            branchId: data.branchId,
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
            branchId: data.branchId,
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
        branchId: data.branchId,
        userId: req.user!.id,
        action: 'CREDIT_REPAYMENT',
        entityType: 'CreditLedger',
        entityId: result.ledgerEntry.id,
        newData: { customerId: data.customerId, amountUsd, method: data.method },
        ipAddress: req.ip,
      });

      res.status(201).json(result);
    } catch (error) {
      console.error('[Credit] Repayment error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/credit/customers/:id/statement
 * Returns full customer credit statement & aging breakdown for PDF print/export
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
