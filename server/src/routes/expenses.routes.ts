import { Router, Request, Response } from 'express';
import { ApprovalStatus, Currency, PaymentMethod } from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import {
  CreateExpenseSchema,
  ApproveExpenseSchema,
  normalizePaymentToUsd,
} from '@baxnaano/shared';
import { recordAuditLog } from '../utils/audit';

export const expensesRouter = Router();

expensesRouter.use(authenticateJWT);

function computeNextRecurringDueDate(fromDate: Date, frequency?: string | null): Date | null {
  if (!frequency) return null;
  const next = new Date(fromDate);
  if (frequency === 'DAILY') next.setDate(next.getDate() + 1);
  else if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
  else if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  return next;
}

/**
 * GET /api/expenses
 * Lists branch expenses with filters by approvalStatus, category, recurring, and date range
 */
expensesRouter.get(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('expenses:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { category, approvalStatus, isRecurring, fromDate, toDate } = req.query as Record<
        string,
        string | undefined
      >;

      const where = scopedWhere(req, {
        ...(category ? { category } : {}),
        ...(approvalStatus ? { approvalStatus: approvalStatus as ApprovalStatus } : {}),
        ...(isRecurring !== undefined ? { isRecurring: isRecurring === 'true' } : {}),
        ...(fromDate || toDate
          ? {
              expenseDate: {
                ...(fromDate ? { gte: new Date(fromDate) } : {}),
                ...(toDate ? { lte: new Date(`${toDate}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      });

      const expenses = await prisma.expense.findMany({
        where,
        include: {
          branch: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { expenseDate: 'desc' },
      });

      res.json({ expenses });
    } catch (error) {
      console.error('[Expenses] List error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/expenses
 * Creates an expense (with optional offline receipt photo base64 & recurring schedule).
 * Auto-approves if created by ADMIN or BRANCH_MANAGER; otherwise sets PENDING for manager approval.
 */
expensesRouter.post(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('expenses:create'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateExpenseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const amountUsd = normalizePaymentToUsd(
        data.amountOriginal,
        data.currencyPaid,
        data.exchangeRateUsed
      );

      const canAutoApprove =
        req.user!.role === 'ADMIN' || req.user!.role === 'BRANCH_MANAGER';
      const expDate = data.expenseDate ? new Date(data.expenseDate) : new Date();

      const expense = await prisma.expense.upsert({
        where: { id: data.id || '00000000-0000-0000-0000-000000000000' },
        update: {
          category: data.category,
          amountUsd,
          currencyPaid: data.currencyPaid as Currency,
          amountOriginal: data.amountOriginal,
          exchangeRateUsed: data.exchangeRateUsed,
          paymentMethod: data.paymentMethod as PaymentMethod,
          payee: data.payee,
          description: data.description ?? null,
          receiptPhotoData: data.receiptPhotoData ?? null,
          isRecurring: data.isRecurring,
          recurringFrequency: data.recurringFrequency ?? null,
          version: { increment: 1 },
        },
        create: {
          id: data.id,
          branchId: data.branchId,
          category: data.category,
          amountUsd,
          currencyPaid: data.currencyPaid as Currency,
          amountOriginal: data.amountOriginal,
          exchangeRateUsed: data.exchangeRateUsed,
          paymentMethod: data.paymentMethod as PaymentMethod,
          payee: data.payee,
          description: data.description ?? null,
          receiptPhotoData: data.receiptPhotoData ?? null,
          approvalStatus: canAutoApprove ? 'APPROVED' : 'PENDING',
          approvedById: canAutoApprove ? req.user!.id : null,
          approvedAt: canAutoApprove ? new Date() : null,
          isRecurring: data.isRecurring,
          recurringFrequency: data.recurringFrequency ?? null,
          nextDueDate: data.isRecurring
            ? computeNextRecurringDueDate(expDate, data.recurringFrequency)
            : null,
          expenseDate: expDate,
          createdById: req.user!.id,
        },
      });

      res.status(201).json({ expense });
    } catch (error) {
      console.error('[Expenses] Create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/expenses/:id/approve
 * Branch Manager or Admin approves/rejects a pending expense.
 */
expensesRouter.post(
  '/:id/approve',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('expenses:approve'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = ApproveExpenseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.expense.findFirst({
        where: scopedWhere(req, { id: req.params.id }),
      });

      if (!existing) {
        res.status(404).json({ error: 'EXPENSE_NOT_FOUND' });
        return;
      }

      const updated = await prisma.expense.update({
        where: { id: existing.id },
        data: {
          approvalStatus: parsed.data.status as ApprovalStatus,
          approvedById: req.user!.id,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await recordAuditLog({
        branchId: updated.branchId,
        userId: req.user!.id,
        action: `EXPENSE_${parsed.data.status}`,
        entityType: 'Expense',
        entityId: updated.id,
        newData: { amountUsd: updated.amountUsd, payee: updated.payee, status: updated.approvalStatus },
        reason: parsed.data.reason ?? undefined,
        ipAddress: req.ip,
      });

      res.json({ expense: updated });
    } catch (error) {
      console.error('[Expenses] Approve error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);
