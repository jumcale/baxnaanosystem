import { v4 as uuidv4 } from 'uuid';
import { db, enqueueOfflineSyncItem } from '../db/dexie';
import {
  allocateStockFEFO,
  CreateSaleInput,
  normalizePaymentToUsd,
  usdToSlsh,
  BAXNAANO_BRANCHES,
} from '@baxnaano/shared';
import { recomputeLocalBatchLedgerBalance } from './inventory.offline';
import { getSavedBranchSettingsSync } from './settings.offline';

export interface OfflineReceiptData {
  saleId: string;
  receiptNumber: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchLocation: string;
  receiptHeader?: string;
  receiptFooter?: string;
  cashierName: string;
  customerName?: string;
  customerPhone?: string;
  soldAt: string;
  exchangeRateUsed: number;
  subtotalUsd: number;
  discountUsd: number;
  taxUsd: number;
  totalUsd: number;
  totalSlsh: number;
  paidUsd: number;
  creditAmountUsd: number;
  changeUsd: number;
  items: Array<{
    productId: string;
    productName: string;
    sku: string;
    batchId: string;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    unitPriceUsd: number;
    discountUsd: number;
    subtotalUsd: number;
    dosageNote?: string | null;
    withdrawalPeriodDays?: number | null;
  }>;
  payments: Array<{
    id: string;
    method: string;
    currency: 'USD' | 'SLSH';
    amountOriginal: number;
    amountUsd: number;
    referencePhone?: string | null;
    transactionRef?: string | null;
  }>;
}

/**
 * Reconstructs `OfflineReceiptData` for any historical sale in IndexedDB so
 * Sales History can reprint 58mm / 80mm thermal or PDF receipts offline.
 */
export async function getOfflineReceiptBySaleId(
  saleId: string
): Promise<OfflineReceiptData | null> {
  const sale = await db.sales.get(saleId);
  if (!sale) return null;

  const branchId = String(sale.branchId);
  const branchMeta =
    Object.values(BAXNAANO_BRANCHES).find(
      (b) => b.id === branchId || b.code === branchId
    ) || BAXNAANO_BRANCHES.B1;
  const branchSettings = getSavedBranchSettingsSync(branchId);

  const saleItems = await db.saleItems.where('saleId').equals(saleId).toArray();
  const payments = await db.payments.where('saleId').equals(saleId).toArray();

  let customerPhone: string | undefined;
  if (sale.customerId) {
    const cust = await db.customers.get(String(sale.customerId));
    if (cust?.phone) customerPhone = String(cust.phone);
  }

  return {
    saleId: String(sale.id),
    receiptNumber: String(sale.receiptNumber),
    branchId,
    branchCode: branchMeta.code,
    branchName: branchMeta.name,
    branchLocation: branchMeta.location,
    receiptHeader: branchSettings.receiptHeader,
    receiptFooter: branchSettings.receiptFooter,
    cashierName: String(sale.cashierName || 'Cashier'),
    customerName: sale.customerName ? String(sale.customerName) : undefined,
    customerPhone,
    soldAt: String(sale.soldAt),
    exchangeRateUsed: Number(sale.exchangeRateUsed || branchSettings.exchangeRate || 8500),
    subtotalUsd: Number(sale.subtotalUsd || 0),
    discountUsd: Number(sale.discountUsd || 0),
    taxUsd: Number(sale.taxUsd || 0),
    totalUsd: Number(sale.totalUsd || 0),
    totalSlsh: Number(sale.totalSlsh || 0),
    paidUsd: Number(sale.paidUsd || 0),
    creditAmountUsd: Number(sale.creditAmountUsd || 0),
    changeUsd: Number(sale.changeUsd || 0),
    items: saleItems.map((item) => ({
      productId: String(item.productId),
      productName: String(item.productName || 'Item'),
      sku: String(item.sku || ''),
      batchId: String(item.batchId),
      batchNumber: String(item.batchNumber || 'FEFO'),
      expiryDate: String(item.expiryDate || ''),
      quantity: Number(item.quantity || 1),
      unitPriceUsd: Number(item.unitPriceUsd || 0),
      discountUsd: Number(item.discountUsd || 0),
      subtotalUsd: Number(item.subtotalUsd || 0),
      dosageNote: item.dosageNote ? String(item.dosageNote) : null,
      withdrawalPeriodDays: item.withdrawalPeriodDays
        ? Number(item.withdrawalPeriodDays)
        : null,
    })),
    payments: payments.map((p) => ({
      id: String(p.id),
      method: String(p.method || 'CASH'),
      currency: (p.currency as 'USD' | 'SLSH') || 'USD',
      amountOriginal: Number(p.amountOriginal || 0),
      amountUsd: Number(p.amountUsd || 0),
      referencePhone: p.referencePhone ? String(p.referencePhone) : null,
      transactionRef: p.transactionRef ? String(p.transactionRef) : null,
    })),
  };
}

/**
 * Atomic Offline-First POS Checkout:
 * 1. Allocates FEFO batches from local IndexedDB `batches` table (blocks expired batches).
 * 2. Deducts stock by writing negative `SALE` records into `db.stockMovements` and recalculating ledger sum.
 * 3. Writes `Sale`, `SaleItem`s, `Payment`s, and optional `CreditLedger` charge.
 * 4. Queues the complete sale transaction into `db.syncQueue` (when offline or synced to remote server).
 * 5. Returns `OfflineReceiptData` for immediate 58mm / 80mm thermal or PDF receipt printing offline.
 */
export async function processOfflineSaleCheckout(
  input: CreateSaleInput,
  cashier: { id: string; fullName: string }
): Promise<OfflineReceiptData> {
  const now = input.soldAt || new Date().toISOString();
  const saleId = input.id || uuidv4();

  const branchMeta =
    Object.values(BAXNAANO_BRANCHES).find(
      (b) => b.id === input.branchId || b.code === input.branchId
    ) || BAXNAANO_BRANCHES.B1;
  const branchSettings = getSavedBranchSettingsSync(input.branchId);

  const receiptNumber =
    input.receiptNumber ||
    `${branchMeta.code}-${now.slice(2, 10).replace(/-/g, '')}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

  return db.transaction(
    'rw',
    [
      db.products,
      db.batches,
      db.stockMovements,
      db.sales,
      db.saleItems,
      db.payments,
      db.customers,
      db.creditLedger,
      db.syncQueue,
    ],
    async () => {
      const resolvedItems: Array<
        OfflineReceiptData['items'][number] & { unitBuyPriceUsd: number }
      > = [];
      let subtotalUsd = 0;

      // 1. FEFO Batch Allocation per Cart Item
      for (const cartItem of input.items) {
        const product = await db.products.get(cartItem.productId);
        if (!product) {
          throw new Error(`PRODUCT_NOT_FOUND:${cartItem.productId}`);
        }

        const productBatches = await db.batches
          .where('productId')
          .equals(cartItem.productId)
          .filter((b) => b.branchId === input.branchId && !b.deletedAt)
          .toArray();

        const fefoResult = allocateStockFEFO(
          productBatches.map((b) => ({
            id: b.id,
            batchNumber: String(b.batchNumber),
            expiryDate: String(b.expiryDate),
            availableQuantity: Number(b.cachedQuantity || 0),
            buyPriceUsd: Number(b.buyPriceUsd || 0),
            sellPriceUsd: Number(b.sellPriceUsd || cartItem.unitPriceUsd),
          })),
          cartItem.quantity
        );

        if (!fefoResult.success) {
          if (fefoResult.errorCode === 'EXPIRED_BATCHES_ONLY') {
            throw new Error(
              `EXPIRED_BATCHES_BLOCKED:${String(product.name)} (${fefoResult.expiredBatchesSkipped.join(
                ', '
              )})`
            );
          }
          throw new Error(
            `INSUFFICIENT_FEFO_STOCK:${String(product.name)} (Shortfall: ${
              fefoResult.shortfallQuantity
            })`
          );
        }

        const itemDiscount = Number(cartItem.discountUsd || 0);
        let remainingDiscount = itemDiscount;

        for (let i = 0; i < fefoResult.allocations.length; i++) {
          const alloc = fefoResult.allocations[i];
          const isLast = i === fefoResult.allocations.length - 1;
          const allocDiscount = isLast
            ? remainingDiscount
            : Number(
                ((alloc.allocatedQuantity / cartItem.quantity) * itemDiscount).toFixed(2)
              );
          remainingDiscount = Number((remainingDiscount - allocDiscount).toFixed(2));

          const lineSubtotal = Number(
            (alloc.allocatedQuantity * cartItem.unitPriceUsd - allocDiscount).toFixed(2)
          );
          subtotalUsd += alloc.allocatedQuantity * cartItem.unitPriceUsd;

          resolvedItems.push({
            productId: cartItem.productId,
            productName: String(product.name),
            sku: String(product.sku),
            batchId: alloc.batchId,
            batchNumber: alloc.batchNumber,
            expiryDate: alloc.expiryDate,
            quantity: alloc.allocatedQuantity,
            unitBuyPriceUsd: Number(alloc.unitBuyPriceUsd ?? product.buyPriceUsd ?? 0),
            unitPriceUsd: cartItem.unitPriceUsd,
            discountUsd: allocDiscount,
            subtotalUsd: lineSubtotal,
            dosageNote:
              cartItem.dosageNote ||
              (product.dosePerKg ? `Dose: ${String(product.dosePerKg)}` : null),
            withdrawalPeriodDays: product.withdrawalPeriodDays
              ? Number(product.withdrawalPeriodDays)
              : null,
          });

          // Append negative SALE StockMovement to local ledger
          const movementId = uuidv4();
          await db.stockMovements.put({
            id: movementId,
            branchId: input.branchId,
            productId: cartItem.productId,
            batchId: alloc.batchId,
            userId: cashier.id,
            type: 'SALE',
            quantityDelta: -Math.abs(alloc.allocatedQuantity),
            unitCostUsd: alloc.unitBuyPriceUsd,
            referenceId: saleId,
            referenceType: 'SALE',
            reason: `POS Sale #${receiptNumber}`,
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          await recomputeLocalBatchLedgerBalance(input.branchId, alloc.batchId);
        }
      }

      subtotalUsd = Number(subtotalUsd.toFixed(2));
      const lineDiscountsUsd = resolvedItems.reduce((s, item) => s + item.discountUsd, 0);
      const totalDiscountUsd = Number((lineDiscountsUsd + (input.discountUsd || 0)).toFixed(2));
      const totalUsd = Number(
        Math.max(0, subtotalUsd - totalDiscountUsd + (input.taxUsd || 0)).toFixed(2)
      );
      const totalSlsh = usdToSlsh(totalUsd, input.exchangeRateUsed);

      // 2. Process Split Payments
      let paidUsd = 0;
      let creditAmountUsd = 0;

      const resolvedPayments: OfflineReceiptData['payments'] = input.payments.map((p) => {
        const payId = p.id || uuidv4();
        const amountUsd = normalizePaymentToUsd(
          p.amountOriginal,
          p.currency,
          input.exchangeRateUsed
        );
        if (p.method === 'CREDIT') {
          creditAmountUsd = Number((creditAmountUsd + amountUsd).toFixed(2));
        } else {
          paidUsd = Number((paidUsd + amountUsd).toFixed(2));
        }
        return {
          id: payId,
          method: p.method,
          currency: p.currency,
          amountOriginal: p.amountOriginal,
          amountUsd,
          referencePhone: p.referencePhone ?? null,
          transactionRef: p.transactionRef ?? null,
        };
      });

      if (paidUsd + creditAmountUsd + 0.02 < totalUsd) {
        throw new Error('INSUFFICIENT_TENDERED_PAYMENT');
      }

      const changeUsd = Number(Math.max(0, paidUsd - (totalUsd - creditAmountUsd)).toFixed(2));

      // 3. Validate Customer & Record Credit Charge if Credit Used
      let customerName: string | undefined;
      let customerPhone: string | undefined;

      if (input.customerId) {
        const customer = await db.customers.get(input.customerId);
        if (customer) {
          customerName = String(customer.name);
          customerPhone = String(customer.phone);

          if (creditAmountUsd > 0) {
            const currentBal = Number(customer.currentBalanceUsd || 0);
            const newBal = Number((currentBal + creditAmountUsd).toFixed(2));

            await db.customers.update(input.customerId, {
              currentBalanceUsd: newBal,
              updatedAt: now,
            });

            await db.creditLedger.put({
              id: uuidv4(),
              branchId: input.branchId,
              customerId: input.customerId,
              saleId,
              type: 'CHARGE',
              amountDeltaUsd: creditAmountUsd,
              balanceAfterUsd: newBal,
              dueDate:
                input.dueDate ||
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              isSettled: false,
              notes: `Credit Sale #${receiptNumber}`,
              recordedById: cashier.id,
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });
          }
        }
      } else if (creditAmountUsd > 0) {
        throw new Error('CUSTOMER_REQUIRED_FOR_CREDIT_SALE');
      }

      // 4. Persist Sale, SaleItems, and Payments to IndexedDB
      const saleRecord = {
        id: saleId,
        branchId: input.branchId,
        receiptNumber,
        cashierId: cashier.id,
        cashierName: cashier.fullName,
        customerId: input.customerId ?? null,
        customerName: customerName ?? null,
        status: 'COMPLETED',
        currency: input.currency,
        exchangeRateUsed: input.exchangeRateUsed,
        subtotalUsd,
        discountUsd: totalDiscountUsd,
        taxUsd: input.taxUsd || 0,
        totalUsd,
        totalSlsh,
        paidUsd,
        creditAmountUsd,
        changeUsd,
        prescriptionRef: input.prescriptionRef ?? null,
        notes: input.notes ?? null,
        soldAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      await db.sales.put(saleRecord);

      for (const item of resolvedItems) {
        await db.saleItems.put({
          id: uuidv4(),
          branchId: input.branchId,
          saleId,
          ...item,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      for (const pay of resolvedPayments) {
        await db.payments.put({
          ...pay,
          branchId: input.branchId,
          saleId,
          exchangeRateUsed: input.exchangeRateUsed,
          paidAt: now,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      // 5. Enqueue Atomic Sale Payload for Server Sync
      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: input.branchId,
        entityType: 'Sale',
        entityId: saleId,
        operation: 'CREATE',
        payload: {
          ...input,
          id: saleId,
          receiptNumber,
          soldAt: now,
          items: resolvedItems.map((ri) => ({
            productId: ri.productId,
            batchId: ri.batchId,
            quantity: ri.quantity,
            unitPriceUsd: ri.unitPriceUsd,
            discountUsd: ri.discountUsd,
            dosageNote: ri.dosageNote,
          })),
          payments: resolvedPayments,
        },
        baseVersion: 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: now,
      });

      return {
        saleId,
        receiptNumber,
        branchId: input.branchId,
        branchCode: branchMeta.code,
        branchName: branchMeta.name,
        branchLocation: branchMeta.location,
        receiptHeader: branchSettings.receiptHeader,
        receiptFooter: branchSettings.receiptFooter,
        cashierName: cashier.fullName,
        customerName,
        customerPhone,
        soldAt: now,
        exchangeRateUsed: input.exchangeRateUsed,
        subtotalUsd,
        discountUsd: totalDiscountUsd,
        taxUsd: input.taxUsd || 0,
        totalUsd,
        totalSlsh,
        paidUsd,
        creditAmountUsd,
        changeUsd,
        items: resolvedItems,
        payments: resolvedPayments,
      };
    }
  );
}
