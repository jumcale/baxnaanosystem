import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { db } from '../db/dexie';

const SEED_VERSION_KEY = 'baxnaano_seed_version';
const CURRENT_SEED_VERSION = 'v3-canonical';

export const CANONICAL_OFFLINE_PRODUCTS = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    branchId: BAXNAANO_BRANCHES.B1.id,
    categoryId: 'cat-default-b1',
    unitId: 'unit-default-b1',
    sku: 'B1-AMOX-500',
    barcode: '629100000101',
    name: 'Amoxicillin 500mg Capsules (20s)',
    genericName: 'Amoxicillin Trihydrate',
    dosageForm: 'Capsule',
    strength: '500mg',
    isPrescriptionOnly: true,
    targetSpecies: [],
    isColdChainRequired: false,
    buyPriceUsd: 1.8,
    sellPriceUsd: 3.0,
    reorderLevel: 20,
    batch1Id: '22222222-1111-4111-8111-111111111101',
    batch2Id: '22222222-2222-4111-8111-111111111101',
    mov1Id: '33333333-1111-4111-8111-111111111101',
    mov2Id: '33333333-2222-4111-8111-111111111101',
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    branchId: BAXNAANO_BRANCHES.B1.id,
    categoryId: 'cat-default-b1',
    unitId: 'unit-default-b1',
    sku: 'B1-PARA-SYR',
    barcode: '629100000102',
    name: 'Paracetamol Pediatric Syrup 120mg/5ml',
    genericName: 'Acetaminophen',
    dosageForm: 'Syrup',
    strength: '120mg/5ml',
    isPrescriptionOnly: false,
    targetSpecies: [],
    isColdChainRequired: false,
    buyPriceUsd: 0.9,
    sellPriceUsd: 1.5,
    reorderLevel: 15,
    batch1Id: '22222222-1111-4111-8111-111111111102',
    batch2Id: '22222222-2222-4111-8111-111111111102',
    mov1Id: '33333333-1111-4111-8111-111111111102',
    mov2Id: '33333333-2222-4111-8111-111111111102',
  },
  {
    id: '11111111-1111-4111-8111-111111111201',
    branchId: BAXNAANO_BRANCHES.B2.id,
    categoryId: 'cat-default-b2',
    unitId: 'unit-default-b2',
    sku: 'B2-IVER-100ML',
    barcode: '629200000201',
    name: 'Ivermectin 1% Injection (100ml Vial)',
    genericName: 'Ivermectin',
    dosageForm: 'Injection',
    strength: '1% w/v',
    isPrescriptionOnly: false,
    targetSpecies: ['CAMEL', 'CATTLE', 'SHEEP', 'GOAT'],
    dosePerKg: '1ml per 50kg subcutaneous',
    withdrawalPeriodDays: 28,
    isColdChainRequired: false,
    buyPriceUsd: 4.5,
    sellPriceUsd: 7.5,
    reorderLevel: 12,
    batch1Id: '22222222-1111-4111-8111-111111111201',
    batch2Id: '22222222-2222-4111-8111-111111111201',
    mov1Id: '33333333-1111-4111-8111-111111111201',
    mov2Id: '33333333-2222-4111-8111-111111111201',
  },
  {
    id: '11111111-1111-4111-8111-111111111202',
    branchId: BAXNAANO_BRANCHES.B2.id,
    categoryId: 'cat-default-b2',
    unitId: 'unit-default-b2',
    sku: 'B2-PPR-VAC',
    barcode: '629200000202',
    name: 'PPR Sheep & Goat Vaccine (100 Doses)',
    genericName: 'Peste des Petits Ruminants Live Attenuated',
    dosageForm: 'Lyophilized Vaccine',
    strength: '100 Doses',
    isPrescriptionOnly: true,
    targetSpecies: ['SHEEP', 'GOAT'],
    dosePerKg: '1ml subcutaneously per animal',
    withdrawalPeriodDays: 0,
    isColdChainRequired: true,
    buyPriceUsd: 8.0,
    sellPriceUsd: 14.0,
    reorderLevel: 10,
    batch1Id: '22222222-1111-4111-8111-111111111202',
    batch2Id: '22222222-2222-4111-8111-111111111202',
    mov1Id: '33333333-1111-4111-8111-111111111202',
    mov2Id: '33333333-2222-4111-8111-111111111202',
  },
  {
    id: '11111111-1111-4111-8111-111111111301',
    branchId: BAXNAANO_BRANCHES.B3.id,
    categoryId: 'cat-default-b3',
    unitId: 'unit-default-b3',
    sku: 'B3-OXY-20LA',
    barcode: '629300000301',
    name: 'Oxytetracycline 20% Long Acting (100ml)',
    genericName: 'Oxytetracycline Dihydrate',
    dosageForm: 'Injection',
    strength: '200mg/ml',
    isPrescriptionOnly: false,
    targetSpecies: ['CAMEL', 'CATTLE', 'SHEEP', 'GOAT'],
    dosePerKg: '1ml per 10kg deep IM',
    withdrawalPeriodDays: 21,
    isColdChainRequired: false,
    buyPriceUsd: 3.2,
    sellPriceUsd: 5.5,
    reorderLevel: 15,
    batch1Id: '22222222-1111-4111-8111-111111111301',
    batch2Id: '22222222-2222-4111-8111-111111111301',
    mov1Id: '33333333-1111-4111-8111-111111111301',
    mov2Id: '33333333-2222-4111-8111-111111111301',
  },
];

/**
 * Seeds deterministic sample data into local IndexedDB on first run (and upgrades
 * older random-UUID seeds) so every device shares the exact same product, batch,
 * and customer UUIDs with the PostgreSQL server.
 */
export async function ensureLocalOfflineSeedData(): Promise<void> {
  const currentVersion =
    typeof localStorage !== 'undefined' ? localStorage.getItem(SEED_VERSION_KEY) : null;
  const existingProductsCount = await db.products.count();
  if (existingProductsCount > 0 && currentVersion === CURRENT_SEED_VERSION) {
    return;
  }

  const now = new Date().toISOString();
  const in25Days = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
  const in180Days = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const expired10DaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  const b1Id = BAXNAANO_BRANCHES.B1.id;
  const b2Id = BAXNAANO_BRANCHES.B2.id;
  const b3Id = BAXNAANO_BRANCHES.B3.id;

  const canonicalProductIds = new Set(CANONICAL_OFFLINE_PRODUCTS.map((p) => p.id));
  const canonicalSkus = new Set([
    ...CANONICAL_OFFLINE_PRODUCTS.map((p) => p.sku),
    'B2-IVER-100',
    'B3-IVER-100',
  ]);

  await db.transaction(
    'rw',
    [db.branches, db.products, db.batches, db.stockMovements, db.customers],
    async () => {
      // Remove legacy random-UUID seeded duplicates so devices don't show duplicate products
      const allProducts = await db.products.toArray();
      for (const p of allProducts) {
        if (canonicalSkus.has(String(p.sku)) && !canonicalProductIds.has(p.id)) {
          const oldBatches = await db.batches.where('productId').equals(p.id).toArray();
          for (const ob of oldBatches) {
            await db.stockMovements.where('batchId').equals(ob.id).delete();
            await db.batches.delete(ob.id);
          }
          await db.products.delete(p.id);
        }
      }

      for (const b of Object.values(BAXNAANO_BRANCHES)) {
        const existingBranch = await db.branches.get(b.id);
        if (!existingBranch) {
          await db.branches.put({ ...b, exchangeRate: 8500 });
        }
      }

      for (const prod of CANONICAL_OFFLINE_PRODUCTS) {
        const existingProd = await db.products.get(prod.id);
        if (!existingProd) {
          const { batch1Id, batch2Id, mov1Id, mov2Id, ...prodRecord } = prod;
          await db.products.put({
            ...prodRecord,
            createdById: 'seed-user',
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          await db.batches.put({
            id: batch1Id,
            branchId: prod.branchId,
            productId: prod.id,
            batchNumber: `${prod.sku.slice(0, 6)}-FEFO1`,
            expiryDate: in25Days,
            buyPriceUsd: prod.buyPriceUsd,
            sellPriceUsd: prod.sellPriceUsd,
            cachedQuantity: 40,
            createdById: 'seed-user',
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          await db.stockMovements.put({
            id: mov1Id,
            branchId: prod.branchId,
            productId: prod.id,
            batchId: batch1Id,
            userId: 'seed-user',
            type: 'INITIAL_STOCK',
            quantityDelta: 40,
            unitCostUsd: prod.buyPriceUsd,
            reason: 'Initial opening stock',
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          await db.batches.put({
            id: batch2Id,
            branchId: prod.branchId,
            productId: prod.id,
            batchNumber: `${prod.sku.slice(0, 6)}-FEFO2`,
            expiryDate: in180Days,
            buyPriceUsd: prod.buyPriceUsd,
            sellPriceUsd: prod.sellPriceUsd,
            cachedQuantity: 85,
            createdById: 'seed-user',
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          await db.stockMovements.put({
            id: mov2Id,
            branchId: prod.branchId,
            productId: prod.id,
            batchId: batch2Id,
            userId: 'seed-user',
            type: 'INITIAL_STOCK',
            quantityDelta: 85,
            unitCostUsd: prod.buyPriceUsd,
            reason: 'Secondary batch stock',
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });

          if (prod.sku === 'B1-AMOX-500') {
            const expBatchId = '22222222-9999-4111-8111-111111111101';
            await db.batches.put({
              id: expBatchId,
              branchId: prod.branchId,
              productId: prod.id,
              batchNumber: 'AMOX-EXP99',
              expiryDate: expired10DaysAgo,
              buyPriceUsd: prod.buyPriceUsd,
              sellPriceUsd: prod.sellPriceUsd,
              cachedQuantity: 12,
              createdById: 'seed-user',
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });
            await db.stockMovements.put({
              id: '33333333-9999-4111-8111-111111111101',
              branchId: prod.branchId,
              productId: prod.id,
              batchId: expBatchId,
              userId: 'seed-user',
              type: 'INITIAL_STOCK',
              quantityDelta: 12,
              unitCostUsd: prod.buyPriceUsd,
              reason: 'Expired batch sample (Blocked by FEFO)',
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });
          }
        }
      }

      const canonicalCustomers = [
        {
          id: '44444444-1111-4111-8111-111111111101',
          branchId: b1Id,
          name: 'Maryan Cabdi Xasan',
          phone: '+252634410011',
          villageOrFarm: 'Arabsiyo Center',
          creditLimitUsd: 150,
          currentBalanceUsd: 0,
          createdById: 'seed-user',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: '44444444-1111-4111-8111-111111111201',
          branchId: b2Id,
          name: 'Geelle Cumar (Geel-dhaqato)',
          phone: '+252634420022',
          villageOrFarm: 'Agabar / Arabsiyo',
          creditLimitUsd: 300,
          currentBalanceUsd: 45,
          createdById: 'seed-user',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: '44444444-1111-4111-8111-111111111301',
          branchId: b3Id,
          name: 'Xaaji Muuse Warsame',
          phone: '+252634430033',
          villageOrFarm: 'Wajaale Road / Gabiley',
          creditLimitUsd: 400,
          currentBalanceUsd: 0,
          createdById: 'seed-user',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ];

      for (const cust of canonicalCustomers) {
        const existingCust = await db.customers.get(cust.id);
        if (!existingCust) {
          await db.customers.put(cust);
        }
      }
    }
  );

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
  }
}
