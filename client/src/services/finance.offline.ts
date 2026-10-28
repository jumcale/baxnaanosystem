import { v4 as uuidv4 } from 'uuid';
import {
  db,
  enqueueOfflineSyncItem,
  getCurrentSessionUserSync,
  isRecordVisibleToCurrentUser,
} from '../db/dexie';
import {
  computeCustomerCreditAging,
  normalizePaymentToUsd,
  usdToSlsh,
} from '@baxnaano/shared';
import { recomputeLocalBatchLedgerBalance } from './inventory.offline';
import { processOfflineSaleCheckout } from './sales.offline';

// ============================================================================
// 1. OFFLINE CREDIT RECORDS (DAYMAHA) & REPAYMENTS
// ============================================================================

export async function getOfflineCustomersWithAging(branchId: string) {
  const sessionUser = getCurrentSessionUserSync();
  const effectiveBranchId =
    sessionUser && sessionUser.role !== 'ADMIN' && sessionUser.branchId
      ? sessionUser.branchId
      : branchId;

  const rawCustomers =
    effectiveBranchId === 'ALL'
      ? await db.customers.filter((c) => !c.deletedAt).toArray()
      : await db.customers
          .where('branchId')
          .equals(effectiveBranchId)
          .filter((c) => !c.deletedAt)
          .toArray();

  const rawEntries =
    effectiveBranchId === 'ALL'
      ? await db.creditLedger.filter((e) => !e.deletedAt).toArray()
      : await db.creditLedger
          .where('branchId')
          .equals(effectiveBranchId)
          .filter((e) => !e.deletedAt)
          .toArray();

  const customers = rawCustomers.filter((c) => isRecordVisibleToCurrentUser(c));
  const entries = rawEntries.filter((e) => isRecordVisibleToCurrentUser(e));

  return customers.map((c) => {
    const custEntries = entries
      .filter((e) => e.customerId === c.id)
      .sort(
        (a, b) =>
          new Date(String(a.createdAt)).getTime() -
          new Date(String(b.createdAt)).getTime()
      );

    const aging = computeCustomerCreditAging(
      custEntries.map((e) => ({
        id: e.id,
        type: e.type as 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'VOID_REVERSAL',
        amountDeltaUsd: Number(e.amountDeltaUsd || 0),
        createdAt: String(e.createdAt),
        dueDate: e.dueDate ? String(e.dueDate) : null,
      }))
    );

    const currentBalanceUsd = Number(c.currentBalanceUsd ?? aging.totalBalanceUsd);
    const creditLimitUsd = Number(c.creditLimitUsd ?? 100);

    return {
      ...(c as Record<string, any>),
      id: c.id,
      branchId: c.branchId,
      name: String(c.name || ''),
      phone: String(c.phone || ''),
      villageOrFarm: c.villageOrFarm ? String(c.villageOrFarm) : '',
      currentBalanceUsd,
      creditLimitUsd,
      aging,
      entries: custEntries,
      isOverLimit: currentBalanceUsd > creditLimitUsd,
    };
  });
}

export async function recordOfflineCreditRepayment(params: {
  branchId: string;
  customerId: string;
  method: 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';
  currency: 'USD' | 'SLSH';
  amountOriginal: number;
  exchangeRateUsed: number;
  referencePhone?: string;
  notes?: string;
  userId: string;
}) {
  const now = new Date().toISOString();
  const ledgerId = uuidv4();
  const amountUsd = normalizePaymentToUsd(
    params.amountOriginal,
    params.currency,
    params.exchangeRateUsed
  );

  await db.transaction(
    'rw',
    [db.customers, db.creditLedger, db.payments, db.syncQueue],
    async () => {
      const customer = await db.customers.get(params.customerId);
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

      const nextBalance = Number(
        (Number(customer.currentBalanceUsd || 0) - amountUsd).toFixed(2)
      );

      await db.customers.update(params.customerId, {
        currentBalanceUsd: nextBalance,
        updatedAt: now,
      });

      const entryRecord = {
        id: ledgerId,
        branchId: params.branchId,
        customerId: params.customerId,
        type: 'PAYMENT',
        amountDeltaUsd: -Math.abs(amountUsd),
        balanceAfterUsd: nextBalance,
        isSettled: nextBalance <= 0,
        paymentMethod: params.method,
        notes: params.notes || `Credit Repayment via ${params.method}`,
        recordedById: params.userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      await db.creditLedger.put(entryRecord);

      await db.payments.put({
        id: uuidv4(),
        branchId: params.branchId,
        creditLedgerId: ledgerId,
        method: params.method,
        currency: params.currency,
        amountOriginal: params.amountOriginal,
        amountUsd,
        exchangeRateUsed: params.exchangeRateUsed,
        referencePhone: params.referencePhone ?? null,
        paidAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: params.branchId,
        entityType: 'CreditRepayment',
        entityId: ledgerId,
        operation: 'CREATE',
        payload: { ...params, id: ledgerId },
        baseVersion: 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: now,
      });
    }
  );
}

// ============================================================================
// 2. OFFLINE EXPENSES (KHARASHYADA) & APPROVALS
// ============================================================================

export async function createOfflineExpense(params: {
  branchId: string;
  category: string;
  currencyPaid: 'USD' | 'SLSH';
  amountOriginal: number;
  exchangeRateUsed: number;
  paymentMethod: string;
  payee: string;
  description?: string;
  receiptPhotoData?: string | null;
  isRecurring: boolean;
  recurringFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  userId: string;
  userRole: string;
}) {
  const now = new Date().toISOString();
  const expenseId = uuidv4();
  const amountUsd = normalizePaymentToUsd(
    params.amountOriginal,
    params.currencyPaid,
    params.exchangeRateUsed
  );
  const autoApproved =
    params.userRole === 'ADMIN' ||
    params.userRole === 'BRANCH_MANAGER' ||
    params.userRole === 'VET_OFFICER';

  const record = {
    id: expenseId,
    branchId: params.branchId,
    category: params.category,
    amountUsd,
    currencyPaid: params.currencyPaid,
    amountOriginal: params.amountOriginal,
    exchangeRateUsed: params.exchangeRateUsed,
    paymentMethod: params.paymentMethod,
    payee: params.payee,
    description: params.description || null,
    receiptPhotoData: params.receiptPhotoData || null,
    approvalStatus: autoApproved ? 'APPROVED' : 'PENDING',
    approvedById: autoApproved ? params.userId : null,
    approvedAt: autoApproved ? now : null,
    isRecurring: params.isRecurring,
    recurringFrequency: params.recurringFrequency || null,
    createdById: params.userId,
    expenseDate: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.transaction('rw', [db.expenses, db.syncQueue], async () => {
    await db.expenses.put(record);
    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: params.branchId,
      entityType: 'Expense',
      entityId: expenseId,
      operation: 'CREATE',
      payload: record,
      baseVersion: 1,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });

  return record;
}

export async function approveOfflineExpense(
  expenseId: string,
  status: 'APPROVED' | 'REJECTED',
  approverId: string
) {
  const now = new Date().toISOString();
  await db.transaction('rw', [db.expenses, db.syncQueue], async () => {
    const existing = await db.expenses.get(expenseId);
    if (!existing) throw new Error('EXPENSE_NOT_FOUND');

    const nextVersion = Number(existing.version || 1) + 1;
    await db.expenses.update(expenseId, {
      approvalStatus: status,
      approvedById: approverId,
      approvedAt: now,
      version: nextVersion,
      updatedAt: now,
    });

    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: existing.branchId,
      entityType: 'ExpenseApproval',
      entityId: expenseId,
      operation: 'UPDATE',
      payload: { expenseId, status, approvedById: approverId },
      baseVersion: nextVersion,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });
}

// ============================================================================
// 3. OFFLINE QUOTATIONS (QIIMEYN) & CONVERT TO SALE
// ============================================================================

export async function createOfflineQuotation(params: {
  branchId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  exchangeRateUsed: number;
  discountUsd: number;
  validUntil: string;
  notes?: string;
  userId: string;
  items: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPriceUsd: number;
  }>;
}) {
  const now = new Date().toISOString();
  const quotationId = uuidv4();
  const quotationNumber = `QTN-${Date.now().toString().slice(-6)}`;

  const subtotalUsd = Number(
    params.items.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0).toFixed(2)
  );
  const totalUsd = Number(Math.max(0, subtotalUsd - params.discountUsd).toFixed(2));
  const totalSlsh = usdToSlsh(totalUsd, params.exchangeRateUsed);

  const record = {
    id: quotationId,
    branchId: params.branchId,
    quotationNumber,
    customerId: params.customerId || null,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    status: 'SENT',
    currency: 'USD',
    exchangeRateUsed: params.exchangeRateUsed,
    subtotalUsd,
    discountUsd: params.discountUsd,
    totalUsd,
    totalSlsh,
    validUntil: params.validUntil,
    notes: params.notes || null,
    items: params.items,
    createdById: params.userId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.transaction('rw', [db.quotations, db.syncQueue], async () => {
    await db.quotations.put(record);
    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: params.branchId,
      entityType: 'Quotation',
      entityId: quotationId,
      operation: 'CREATE',
      payload: record,
      baseVersion: 1,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });

  return record;
}

export async function convertOfflineQuotationToSale(
  quotationId: string,
  paymentMethod: 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB',
  cashier: { id: string; fullName: string }
) {
  const quote = await db.quotations.get(quotationId);
  if (!quote) throw new Error('QUOTATION_NOT_FOUND');

  const items = (quote.items as Array<{
    productId: string;
    quantity: number;
    unitPriceUsd: number;
  }>) || [];

  const receipt = await processOfflineSaleCheckout(
    {
      branchId: quote.branchId,
      customerId: (quote.customerId as string | null) ?? null,
      currency: 'USD',
      exchangeRateUsed: Number(quote.exchangeRateUsed || 8500),
      discountUsd: Number(quote.discountUsd || 0),
      taxUsd: 0,
      notes: `Converted from Quotation #${String(quote.quotationNumber)}`,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPriceUsd: i.unitPriceUsd,
        discountUsd: 0,
      })),
      payments: [
        {
          method: paymentMethod,
          currency: 'USD',
          amountOriginal: Number(quote.totalUsd),
        },
      ],
    },
    cashier
  );

  await db.quotations.update(quotationId, {
    status: 'CONVERTED',
    convertedSaleId: receipt.saleId,
    updatedAt: new Date().toISOString(),
  });

  return receipt;
}

// ============================================================================
// 4. OFFLINE SALES HISTORY VOID & REFUND (LEDGER STOCK REVERSAL)
// ============================================================================

export async function voidOfflineSale(params: {
  saleId: string;
  reason: string;
  approverId: string;
}) {
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [
      db.sales,
      db.saleItems,
      db.batches,
      db.stockMovements,
      db.customers,
      db.creditLedger,
      db.syncQueue,
    ],
    async () => {
      const sale = await db.sales.get(params.saleId);
      if (!sale || sale.status === 'VOIDED') return;

      const saleItems = await db.saleItems
        .where('saleId')
        .equals(params.saleId)
        .toArray();

      // 1. Append positive VOID_REVERSAL StockMovements to return stock to each batch
      for (const item of saleItems) {
        const netSoldQty =
          Number(item.quantity || 0) - Number(item.refundedQuantity || 0);
        if (netSoldQty > 0) {
          await db.stockMovements.put({
            id: uuidv4(),
            branchId: sale.branchId,
            productId: String(item.productId),
            batchId: String(item.batchId),
            userId: params.approverId,
            type: 'VOID_REVERSAL',
            quantityDelta: Math.abs(netSoldQty),
            referenceId: sale.id,
            referenceType: 'SALE_VOID',
            reason: `Void Sale #${String(sale.receiptNumber)}: ${params.reason}`,
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          await recomputeLocalBatchLedgerBalance(
            sale.branchId,
            String(item.batchId)
          );
        }
      }

      // 2. Reverse Customer Credit balance if sale had creditAmountUsd > 0
      const creditUsed = Number(sale.creditAmountUsd || 0);
      if (creditUsed > 0 && sale.customerId) {
        const customer = await db.customers.get(String(sale.customerId));
        if (customer) {
          const nextBal = Number(
            (Number(customer.currentBalanceUsd || 0) - creditUsed).toFixed(2)
          );
          await db.customers.update(String(sale.customerId), {
            currentBalanceUsd: nextBal,
            updatedAt: now,
          });

          await db.creditLedger.put({
            id: uuidv4(),
            branchId: sale.branchId,
            customerId: String(sale.customerId),
            saleId: sale.id,
            type: 'VOID_REVERSAL',
            amountDeltaUsd: -Math.abs(creditUsed),
            balanceAfterUsd: nextBal,
            isSettled: true,
            notes: `Void Reversal #${String(sale.receiptNumber)}: ${params.reason}`,
            recordedById: params.approverId,
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
        }
      }

      await db.sales.update(params.saleId, {
        status: 'VOIDED',
        approvedById: params.approverId,
        voidOrRefundReason: params.reason,
        voidedAt: now,
        updatedAt: now,
        version: Number(sale.version || 1) + 1,
      });

      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: sale.branchId,
        entityType: 'SaleVoid',
        entityId: params.saleId,
        operation: 'UPDATE',
        payload: { saleId: params.saleId, reason: params.reason, approvedById: params.approverId },
        baseVersion: Number(sale.version || 1) + 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: now,
      });
    }
  );
}
