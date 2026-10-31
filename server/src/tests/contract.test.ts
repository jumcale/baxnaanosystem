import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  BAXNAANO_BRANCHES,
  ROLE_PERMISSIONS,
  DashboardAnalyticsResponseSchema,
  ReceiptDataSchema,
  ExpenseRecordSchema,
  CustomerAgingSchema,
  ProductItemSchema,
  LoginSchema,
  CreateSaleSchema,
} from '@baxnaano/shared';
import { app } from '../index';
import { signAccessToken } from '../middleware/auth';

describe('API Contract Integrity Tests', () => {
  const adminToken = signAccessToken({
    id: 'user-admin-global',
    username: 'admin',
    fullName: 'Global Admin',
    role: 'ADMIN',
    branchId: null,
    branchCode: null,
    branchType: null,
    permissions: ROLE_PERMISSIONS.ADMIN,
    language: 'en',
  });

  describe('1. Auth Endpoint Contracts', () => {
    it('rejects malformed login body with 400 and validation details', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'ad', // too short (<3 chars)
        password: '',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.details).toBeDefined();
    });

    it('rejects refresh request with 401 when refresh cookie/token is missing', async () => {
      const res = await request(app).post('/api/auth/refresh').send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('MISSING_REFRESH_TOKEN');
    });

    it('rejects unauthenticated access to /api/auth/me with 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('2. Sales Endpoint Contracts', () => {
    it('rejects malformed sale payloads with 400 and validation error', async () => {
      const res = await request(app)
        .post('/api/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          branchId: BAXNAANO_BRANCHES.B1.id,
          items: [], // invalid: min(1) required
          payments: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects unauthenticated POST /api/sales with 401', async () => {
      const res = await request(app).post('/api/sales').send({});
      expect(res.status).toBe(401);
    });

    it('validates ReceiptDataSchema on formatted receipt payload', () => {
      const sampleReceipt = {
        saleId: 'sale-12345',
        receiptNumber: 'REC-B1-0001',
        branchId: BAXNAANO_BRANCHES.B1.id,
        branchCode: 'B1',
        branchName: 'Baxnaano Pharmacy',
        branchLocation: 'Arabsiyo',
        cashierName: 'Cashier Ahmed',
        soldAt: new Date().toISOString(),
        exchangeRateUsed: 8500,
        subtotalUsd: 20.0,
        discountUsd: 0.0,
        taxUsd: 0.0,
        totalUsd: 20.0,
        totalSlsh: 170000,
        paidUsd: 20.0,
        creditAmountUsd: 0.0,
        changeUsd: 0.0,
        items: [
          {
            productId: 'prod-1',
            productName: 'Paracetamol 500mg',
            sku: 'B1-MED-01',
            batchId: 'batch-1',
            batchNumber: 'BATCH-2026-A',
            expiryDate: '2027-12-31T00:00:00.000Z',
            quantity: 2,
            unitPriceUsd: 10.0,
            discountUsd: 0.0,
            subtotalUsd: 20.0,
          },
        ],
        payments: [
          {
            id: 'pay-1',
            method: 'CASH',
            currency: 'USD' as const,
            amountOriginal: 20.0,
            amountUsd: 20.0,
          },
        ],
      };

      const parsed = ReceiptDataSchema.safeParse(sampleReceipt);
      expect(parsed.success).toBe(true);
    });
  });

  describe('3. Inventory & Operations Endpoint Contracts', () => {
    it('rejects unauthenticated GET /api/inventory/products with 401', async () => {
      const res = await request(app).get('/api/inventory/products');
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated GET /api/credit/customers with 401', async () => {
      const res = await request(app).get('/api/credit/customers');
      expect(res.status).toBe(401);
    });

    it('rejects malformed expense creation with 400', async () => {
      const res = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          branchId: BAXNAANO_BRANCHES.B1.id,
          amountUsd: -50, // invalid: non-negative required
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('validates ExpenseRecordSchema on sample expense record', () => {
      const sampleExpense = {
        id: 'exp-123',
        branchId: BAXNAANO_BRANCHES.B1.id,
        category: 'UTILITIES',
        amountUsd: 45.0,
        exchangeRateUsed: 8500,
        approvalStatus: 'APPROVED' as const,
        expenseDate: '2026-10-31',
        createdAt: new Date().toISOString(),
      };

      const parsed = ExpenseRecordSchema.safeParse(sampleExpense);
      expect(parsed.success).toBe(true);
    });

    it('validates CustomerAgingSchema on sample customer record', () => {
      const sampleCustomer = {
        id: 'cust-123',
        branchId: BAXNAANO_BRANCHES.B1.id,
        name: 'Farhan Geelle',
        phone: '+252634440011',
        creditLimitUsd: 200.0,
        currentBalanceUsd: 50.0,
        aging: {
          totalBalanceUsd: 50.0,
          bucket0to30Usd: 50.0,
          bucket31to60Usd: 0.0,
          bucket60PlusUsd: 0.0,
          overdueCount: 0,
          isOverdue: false,
        },
        entries: [],
        creditEntries: [],
      };

      const parsed = CustomerAgingSchema.safeParse(sampleCustomer);
      expect(parsed.success).toBe(true);
    });

    it('validates ProductItemSchema on sample enriched product', () => {
      const sampleProduct = {
        id: 'prod-456',
        branchId: BAXNAANO_BRANCHES.B2.id,
        categoryId: 'cat-vet',
        unitId: 'unit-vial',
        sku: 'B2-OXY-20',
        name: 'Oxytetracycline 20%',
        buyPriceUsd: 3.5,
        sellPriceUsd: 5.5,
        reorderLevel: 10,
        isPrescriptionOnly: false,
        targetSpecies: ['Cattle', 'Camels', 'Goats'],
        isColdChainRequired: false,
        batches: [
          {
            id: 'batch-99',
            branchId: BAXNAANO_BRANCHES.B2.id,
            productId: 'prod-456',
            batchNumber: 'OXY-2026-X',
            expiryDate: '2027-06-30T00:00:00.000Z',
            buyPriceUsd: 3.5,
            sellPriceUsd: 5.5,
            cachedQuantity: 40,
            expiryBucket: 'SAFE' as const,
            daysUntilExpiry: 600,
          },
        ],
        sellableStock: 40,
        expiredStock: 0,
        totalStock: 40,
        isLowStock: false,
      };

      const parsed = ProductItemSchema.safeParse(sampleProduct);
      expect(parsed.success).toBe(true);
    });
  });

  describe('4. Dashboard Contract Schema Validation', () => {
    it('validates DashboardAnalyticsResponseSchema on mock payload', () => {
      const sampleDashboard = {
        kpis: {
          todaySalesUsd: 150.5,
          todayExpensesUsd: 20.0,
          todayGrossProfitUsd: 45.5,
          todayNetProfitUsd: 25.5,
          todayCashUsd: 100.5,
          todayMobileMoneyUsd: 50.0,
          todayCreditUsd: 0.0,
        },
        alerts: {
          lowStockCount: 2,
          expiredBatchesCount: 0,
          expiring30Count: 1,
          expiring60Count: 3,
          expiring90Count: 5,
          todayAppointmentsCount: 4,
          openTasksCount: 1,
        },
        trend7Days: [{ date: '2026-10-31', salesUsd: 150.5, profitUsd: 25.5 }],
        trend30Days: [{ date: '2026-10-31', salesUsd: 150.5, profitUsd: 25.5 }],
        topSellingItems: [
          {
            productId: 'p1',
            name: 'Albendazole 10%',
            sku: 'B2-ALB-10',
            quantitySold: 5,
            revenueUsd: 50.0,
          },
        ],
        todayAppointments: [],
        branchComparison: [
          {
            branchId: BAXNAANO_BRANCHES.B1.id,
            code: 'B1',
            name: 'Baxnaano Pharmacy',
            type: 'PHARMACY',
            location: 'Arabsiyo',
            todaySalesUsd: 100,
            monthSalesUsd: 2000,
            monthProfitUsd: 500,
            monthNetProfitUsd: 400,
          },
        ],
      };

      const parsed = DashboardAnalyticsResponseSchema.safeParse(sampleDashboard);
      expect(parsed.success).toBe(true);
    });
  });
});
