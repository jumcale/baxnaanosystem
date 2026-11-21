import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  allocateStockFEFO,
  classifyExpiryBucket,
  computeCustomerCreditAging,
  usdToSlsh,
  normalizePaymentToUsd,
  BAXNAANO_BRANCHES,
  hasPermission,
  canAccessModule,
} from '@baxnaano/shared';
import { app } from '../index';
import { signAccessToken } from '../middleware/auth';
import { isStrongProductionSecret } from '../config/env';
import { redactSensitiveData } from '../middleware/logger';
import {
  computeSingleSaleFinancials,
  resolveMogadishuDateWindow,
  round2,
  toMogadishuDateString,
} from '../services/financial.service';

describe('1. FEFO Stock Allocation & Expired Batch Blocking Engine', () => {
  const referenceToday = new Date('2026-10-27T12:00:00Z');

  it('blocks expired batches and allocates earliest non-expired batch first (FEFO)', () => {
    const batches = [
      {
        id: 'batch-expired',
        batchNumber: 'EXP-001',
        expiryDate: '2026-10-01T00:00:00Z',
        availableQuantity: 50,
        buyPriceUsd: 2.0,
        sellPriceUsd: 3.5,
      },
      {
        id: 'batch-later',
        batchNumber: 'LATER-003',
        expiryDate: '2027-05-01T00:00:00Z',
        availableQuantity: 40,
        buyPriceUsd: 2.1,
        sellPriceUsd: 3.5,
      },
      {
        id: 'batch-sooner',
        batchNumber: 'SOONER-002',
        expiryDate: '2026-11-15T00:00:00Z',
        availableQuantity: 15,
        buyPriceUsd: 2.0,
        sellPriceUsd: 3.5,
      },
    ];

    const result = allocateStockFEFO(batches, 25, referenceToday);

    expect(result.success).toBe(true);
    expect(result.expiredBatchesSkipped).toContain('EXP-001');
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0].batchNumber).toBe('SOONER-002');
    expect(result.allocations[0].allocatedQuantity).toBe(15);
    expect(result.allocations[1].batchNumber).toBe('LATER-003');
    expect(result.allocations[1].allocatedQuantity).toBe(10);
  });

  it('returns EXPIRED_BATCHES_ONLY when all stocked batches are expired', () => {
    const batches = [
      {
        id: 'batch-exp-only',
        batchNumber: 'EXP-999',
        expiryDate: '2026-09-10T00:00:00Z',
        availableQuantity: 100,
        buyPriceUsd: 1.0,
        sellPriceUsd: 2.0,
      },
    ];

    const result = allocateStockFEFO(batches, 5, referenceToday);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('EXPIRED_BATCHES_ONLY');
    expect(result.allocations).toHaveLength(0);
  });

  it('returns INSUFFICIENT_STOCK when non-expired stock is less than requested quantity', () => {
    const batches = [
      {
        id: 'batch-low',
        batchNumber: 'LOW-001',
        expiryDate: '2027-01-01T00:00:00Z',
        availableQuantity: 5,
        buyPriceUsd: 2.0,
        sellPriceUsd: 3.5,
      },
    ];

    const result = allocateStockFEFO(batches, 10, referenceToday);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INSUFFICIENT_STOCK');
  });

  it('classifies 30, 60, and 90 day expiry buckets accurately', () => {
    expect(classifyExpiryBucket('2026-10-15', referenceToday).bucket).toBe('EXPIRED');
    expect(classifyExpiryBucket('2026-11-10', referenceToday).bucket).toBe('DAYS_30');
    expect(classifyExpiryBucket('2026-12-10', referenceToday).bucket).toBe('DAYS_60');
    expect(classifyExpiryBucket('2027-01-10', referenceToday).bucket).toBe('DAYS_90');
    expect(classifyExpiryBucket('2027-06-01', referenceToday).bucket).toBe('SAFE');
  });
});

describe('2. Customer Credit FIFO Aging Logic (0-30, 31-60, 60+ Days)', () => {
  const referenceToday = new Date('2026-10-27T12:00:00Z');

  it('applies partial repayments to oldest charges first (FIFO) and buckets remaining debt', () => {
    const entries = [
      {
        id: 'c1',
        type: 'CHARGE' as const,
        amountDeltaUsd: 100,
        createdAt: '2026-08-13T10:00:00Z',
      },
      {
        id: 'c2',
        type: 'CHARGE' as const,
        amountDeltaUsd: 60,
        createdAt: '2026-09-12T10:00:00Z',
      },
      {
        id: 'c3',
        type: 'CHARGE' as const,
        amountDeltaUsd: 40,
        createdAt: '2026-10-17T10:00:00Z',
      },
      {
        id: 'p1',
        type: 'PAYMENT' as const,
        amountDeltaUsd: -120,
        createdAt: '2026-10-25T10:00:00Z',
      },
    ];

    const aging = computeCustomerCreditAging(entries, referenceToday);
    expect(aging.bucket60PlusUsd).toBe(0);
    expect(aging.bucket31to60Usd).toBe(40);
    expect(aging.bucket0to30Usd).toBe(40);
    expect(aging.totalBalanceUsd).toBe(80);
    expect(aging.isOverdue).toBe(true);
  });
});

describe('3. Multi-Currency USD & SLSH Conversion', () => {
  it('converts USD to SLSH and normalizes SLSH split payments back to USD', () => {
    expect(usdToSlsh(2.5, 8500)).toBe(21250);
    expect(normalizePaymentToUsd(85000, 'SLSH', 8500)).toBe(10.0);
    expect(normalizePaymentToUsd(15.25, 'USD', 8500)).toBe(15.25);
  });
});

describe('4. RBAC Matrix & Multi-Branch API Isolation Integration Tests', () => {
  it('enforces RBAC module visibility and permissions per role', () => {
    expect(canAccessModule('CASHIER', 'SALES_POINT')).toBe(true);
    expect(canAccessModule('CASHIER', 'INVENTORY')).toBe(false);
    expect(canAccessModule('PHARMACIST', 'INVENTORY')).toBe(true);
    expect(canAccessModule('PHARMACIST', 'SALES_POINT')).toBe(false);
    expect(canAccessModule('PHARMACIST', 'APPOINTMENTS')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'INVENTORY')).toBe(true);
    expect(canAccessModule('BRANCH_MANAGER', 'REPORTS')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'REPORTS')).toBe(false);
    expect(hasPermission('BRANCH_MANAGER', 'expenses:approve')).toBe(true);
    expect(hasPermission('CASHIER', 'expenses:approve')).toBe(false);
    expect(hasPermission('ADMIN', 'reports:view')).toBe(true);
  });

  it('checks lightweight /health and /api/health status endpoints for fast Render cold start', async () => {
    const fastRes = await request(app).get('/health');
    expect(fastRes.status).toBe(200);
    expect(fastRes.body.status).toBe('ok');

    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(['connected', 'disconnected']).toContain(res.body.database);
  });

  it('blocks unauthenticated requests on protected routes with 401', async () => {
    const res = await request(app).get('/api/inventory/products');
    expect(res.status).toBe(401);
  });

  it('prevents vet_b2 (B2 Arabsiyo Vet) from accessing vet_b3 (B3 Gabiley Vet) data via query param (403 CROSS_BRANCH_ACCESS_DENIED)', async () => {
    const vetB2Token = signAccessToken({
      id: 'user-vet-b2',
      username: 'vet_b2',
      fullName: 'Dr. Cabdi Warsame',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B2.id,
      branchCode: 'B2',
      branchType: 'VETERINARY',
      permissions: ['inventory:view'],
      language: 'en',
    });

    const res = await request(app)
      .get(`/api/inventory/products?branchId=${BAXNAANO_BRANCHES.B3.id}`)
      .set('Authorization', `Bearer ${vetB2Token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');
  });

  it('prevents a non-admin user from submitting body branchId for another branch (403 CROSS_BRANCH_ACCESS_DENIED)', async () => {
    const b1CashierToken = signAccessToken({
      id: 'user-b1-cashier',
      username: 'cashier_b1',
      fullName: 'Nimco',
      role: 'CASHIER',
      branchId: BAXNAANO_BRANCHES.B1.id,
      branchCode: 'B1',
      branchType: 'PHARMACY',
      permissions: ['sales:create'],
      language: 'so',
    });

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${b1CashierToken}`)
      .send({
        branchId: BAXNAANO_BRANCHES.B2.id,
        items: [{ productId: 'p1', quantity: 1, unitPriceUsd: 10 }],
        payments: [{ method: 'CASH', currency: 'USD', amountOriginal: 10 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');
  });

  it('blocks a Cashier from accessing Inventory mutation & Financial Report endpoints (403 FORBIDDEN_PERMISSION)', async () => {
    const b1CashierToken = signAccessToken({
      id: 'user-b1-cashier',
      username: 'cashier_b1',
      fullName: 'Nimco',
      role: 'CASHIER',
      branchId: BAXNAANO_BRANCHES.B1.id,
      branchCode: 'B1',
      branchType: 'PHARMACY',
      permissions: ['sales:create'],
      language: 'so',
    });

    const invRes = await request(app)
      .post('/api/inventory/products')
      .set('Authorization', `Bearer ${b1CashierToken}`)
      .send({ name: 'Unauthorized Product' });

    expect(invRes.status).toBe(403);
    expect(invRes.body.error).toBe('FORBIDDEN_PERMISSION');

    const repRes = await request(app)
      .get('/api/reports/financial')
      .set('Authorization', `Bearer ${b1CashierToken}`);

    expect(repRes.status).toBe(403);
    expect(repRes.body.error).toBe('FORBIDDEN_PERMISSION');
  });
});

describe('5. Centralized Financial Calculation & Africa/Mogadishu Midnight Rollover Engine', () => {
  it('accurately resolves Africa/Mogadishu (UTC+3) business day boundaries across midnight', () => {
    // 2026-11-04 21:30:00Z is 2026-11-05 00:30:00 in Africa/Mogadishu (UTC+3)
    const afterMidnightMogadishu = new Date('2026-11-04T21:30:00.000Z');
    expect(toMogadishuDateString(afterMidnightMogadishu)).toBe('2026-11-05');

    const todayWin = resolveMogadishuDateWindow('TODAY', undefined, undefined, afterMidnightMogadishu);
    expect(todayWin.fromDateStr).toBe('2026-11-05');
    expect(todayWin.toDateStr).toBe('2026-11-05');
    expect(todayWin.startUtc.toISOString()).toBe('2026-11-04T21:00:00.000Z');

    const yestWin = resolveMogadishuDateWindow('YESTERDAY', undefined, undefined, afterMidnightMogadishu);
    expect(yestWin.fromDateStr).toBe('2026-11-04');
    expect(yestWin.toDateStr).toBe('2026-11-04');
  });

  it('never counts credit sales as cash received and excludes voided sales from totals', () => {
    const creditSale = computeSingleSaleFinancials({
      status: 'COMPLETED',
      subtotalUsd: 50,
      discountUsd: 0,
      taxUsd: 0,
      totalUsd: 50,
      paidUsd: 20,
      creditAmountUsd: 30,
      changeUsd: 0,
      items: [
        {
          quantity: 5,
          refundedQuantity: 0,
          unitBuyPriceUsd: 6,
          unitPriceUsd: 10,
          discountUsd: 0,
          subtotalUsd: 50,
        },
      ],
      payments: [
        { method: 'CASH', amountUsd: 20 },
        { method: 'CREDIT', amountUsd: 30 },
      ],
    });

    expect(round2(creditSale.netRevenueUsd)).toBe(50);
    expect(round2(creditSale.cogsUsd)).toBe(30);
    expect(round2(creditSale.grossProfitUsd)).toBe(20);
    expect(round2(creditSale.posCashCollectedUsd)).toBe(20); // Only $20 cash, NOT $50
    expect(round2(creditSale.creditSalesUsd)).toBe(30);

    const voidedSale = computeSingleSaleFinancials({
      status: 'VOIDED',
      subtotalUsd: 100,
      discountUsd: 0,
      taxUsd: 0,
      totalUsd: 100,
      paidUsd: 100,
      creditAmountUsd: 0,
      changeUsd: 0,
      items: [
        {
          quantity: 10,
          refundedQuantity: 0,
          unitBuyPriceUsd: 5,
          unitPriceUsd: 10,
          discountUsd: 0,
          subtotalUsd: 100,
        },
      ],
      payments: [{ method: 'CASH', amountUsd: 100 }],
    });

    expect(voidedSale.isVoided).toBe(true);
    expect(round2(voidedSale.netRevenueUsd)).toBe(0);
    expect(round2(voidedSale.posCashCollectedUsd)).toBe(0);
    expect(round2(voidedSale.voidedAmountUsd)).toBe(100);
  });

  it('deducts partial item refunds from net revenue, COGS, and POS cash collected', () => {
    const partialRefundSale = computeSingleSaleFinancials({
      status: 'PARTIALLY_REFUNDED',
      subtotalUsd: 40,
      discountUsd: 0,
      taxUsd: 0,
      totalUsd: 40,
      paidUsd: 40,
      creditAmountUsd: 0,
      changeUsd: 0,
      items: [
        {
          quantity: 4,
          refundedQuantity: 1, // 1 of 4 refunded ($10 refunded)
          unitBuyPriceUsd: 5,
          unitPriceUsd: 10,
          discountUsd: 0,
          subtotalUsd: 40,
        },
      ],
      payments: [{ method: 'EVC_PLUS', amountUsd: 40 }],
    });

    expect(round2(partialRefundSale.refundsUsd)).toBe(10);
    expect(round2(partialRefundSale.netRevenueUsd)).toBe(30);
    expect(round2(partialRefundSale.cogsUsd)).toBe(15); // 3 net items * $5
    expect(round2(partialRefundSale.grossProfitUsd)).toBe(15);
    expect( round2(partialRefundSale.posCashCollectedUsd)).toBe(30);
  });
});

describe('6. Security Audit Verification: Auth, Branch Isolation, IDOR, Headers & Redaction', () => {
  it('enforces mustChangePassword server-side on protected routes (403 PASSWORD_CHANGE_REQUIRED)', async () => {
    const forcedResetToken = signAccessToken({
      id: 'user-temp-pass',
      username: 'vet_b2',
      fullName: 'Dr. Cabdi Warsame',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B2.id,
      branchCode: 'B2',
      branchType: 'VETERINARY',
      permissions: ['inventory:view', 'sales:create'],
      language: 'en',
      mustChangePassword: true,
    });

    // Blocked on business routes
    const invRes = await request(app)
      .get('/api/inventory/products')
      .set('Authorization', `Bearer ${forcedResetToken}`);
    expect(invRes.status).toBe(403);
    expect(invRes.body.error).toBe('PASSWORD_CHANGE_REQUIRED');

    const salesRes = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${forcedResetToken}`);
    expect(salesRes.status).toBe(403);
    expect(salesRes.body.error).toBe('PASSWORD_CHANGE_REQUIRED');

    // Allowed on /api/auth/me so client can inspect session state
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forcedResetToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.mustChangePassword).toBe(true);
  });

  it('blocks cross-branch tampering via header, query, and body across Sales, Quotations, Expenses, Credit, Appointments & Inventory', async () => {
    const vetB2Token = signAccessToken({
      id: 'user-vet-b2',
      username: 'vet_b2',
      fullName: 'Dr. Cabdi Warsame',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B2.id,
      branchCode: 'B2',
      branchType: 'VETERINARY',
      permissions: [],
      language: 'en',
      mustChangePassword: false,
    });

    // 1. Header tampering (x-branch-id: B3) on Quotations
    const qtnRes = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${vetB2Token}`)
      .set('x-branch-id', BAXNAANO_BRANCHES.B3.id);
    expect(qtnRes.status).toBe(403);
    expect(qtnRes.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');

    // 2. Query param tampering (?branchId=B1) on Expenses
    const expRes = await request(app)
      .get(`/api/expenses?branchId=${BAXNAANO_BRANCHES.B1.id}`)
      .set('Authorization', `Bearer ${vetB2Token}`);
    expect(expRes.status).toBe(403);
    expect(expRes.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');

    // 3. Body tampering (branchId: B3) on Credit Customers
    const credRes = await request(app)
      .post('/api/credit/customers')
      .set('Authorization', `Bearer ${vetB2Token}`)
      .send({
        branchId: BAXNAANO_BRANCHES.B3.id,
        name: 'Tampered Customer',
        phone: '+252634400000',
      });
    expect(credRes.status).toBe(403);
    expect(credRes.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');

    // 4. Query param tampering (?branchId=B3) on Appointments
    const apptRes = await request(app)
      .get(`/api/appointments?branchId=${BAXNAANO_BRANCHES.B3.id}`)
      .set('Authorization', `Bearer ${vetB2Token}`);
    expect(apptRes.status).toBe(403);
    expect(apptRes.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');

    // 5. Header tampering (x-branch-id: B1) on Stock Movements
    const movRes = await request(app)
      .get('/api/inventory/movements')
      .set('Authorization', `Bearer ${vetB2Token}`)
      .set('x-branch-id', 'B1');
    expect(movRes.status).toBe(403);
    expect(movRes.body.error).toBe('CROSS_BRANCH_ACCESS_DENIED');
  });

  it('prevents non-ADMIN users from managing users, changing exchange rates, deleting expenses, or accessing financial reports as VET_OFFICER', async () => {
    const managerB1Token = signAccessToken({
      id: 'user-manager-b1',
      username: 'manager_b1',
      fullName: 'Axmed Cali',
      role: 'BRANCH_MANAGER',
      branchId: BAXNAANO_BRANCHES.B1.id,
      branchCode: 'B1',
      branchType: 'PHARMACY',
      permissions: [],
      language: 'en',
      mustChangePassword: false,
    });

    const vetB3Token = signAccessToken({
      id: 'user-vet-b3',
      username: 'vet_b3',
      fullName: 'Dr. Faysal',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B3.id,
      branchCode: 'B3',
      branchType: 'VETERINARY',
      permissions: [],
      language: 'en',
      mustChangePassword: false,
    });

    // Non-admin blocked from GET /api/auth/users
    const usersRes = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${managerB1Token}`);
    expect(usersRes.status).toBe(403);

    // Branch manager blocked from updating exchangeRate on their own branch
    const rateRes = await request(app)
      .patch(`/api/reports/settings/branch/${BAXNAANO_BRANCHES.B1.id}`)
      .set('Authorization', `Bearer ${managerB1Token}`)
      .send({ exchangeRate: 5000 });
    expect(rateRes.status).toBe(403);
    expect(rateRes.body.error).toBe('FORBIDDEN_EXCHANGE_RATE_UPDATE');

    // Non-admin blocked from DELETE /api/expenses/:id
    const delExpRes = await request(app)
      .delete('/api/expenses/00000000-0000-0000-0000-000000000001')
      .set('Authorization', `Bearer ${managerB1Token}`);
    expect(delExpRes.status).toBe(403);

    // VET_OFFICER blocked from GET /api/reports/financial
    const vetReportRes = await request(app)
      .get('/api/reports/financial')
      .set('Authorization', `Bearer ${vetB3Token}`);
    expect(vetReportRes.status).toBe(403);
    expect(vetReportRes.body.error).toBe('FORBIDDEN_PERMISSION');
  });

  it('sets strict Helmet Content-Security-Policy headers and exposes no sensitive info on /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('validates production secret strength and redacts sensitive fields from logs/audit payloads', () => {
    expect(isStrongProductionSecret('short-secret')).toBe(false);
    expect(isStrongProductionSecret('change-this-to-a-secure-random-secret-at-least-32-chars')).toBe(false);
    expect(isStrongProductionSecret('baxnaano_staging_access_secret_2026_secure_key')).toBe(false);
    expect(isStrongProductionSecret('9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e')).toBe(true);

    const redacted = redactSensitiveData({
      username: 'admin',
      password: 'SecretPassword123!',
      passwordHash: '$2a$12$hash',
      accessToken: 'jwt-token',
      nested: {
        refreshToken: 'refresh-secret',
        receiptPhotoData: 'data:image/jpeg;base64,...',
        safeField: 'allowed',
      },
    });

    expect(redacted.username).toBe('admin');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.passwordHash).toBe('[REDACTED]');
    expect(redacted.accessToken).toBe('[REDACTED]');
    expect(redacted.nested.refreshToken).toBe('[REDACTED]');
    expect(redacted.nested.receiptPhotoData).toBe('[REDACTED]');
    expect(redacted.nested.safeField).toBe('allowed');
  });
});
