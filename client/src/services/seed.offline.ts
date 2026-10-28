import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { db } from '../db/dexie';

const SEED_VERSION_KEY = 'baxnaano_seed_version';
const CURRENT_SEED_VERSION = 'v4-vet-32-items';

export interface VetSeedItem {
  itemNo: number;
  name: string;
  costSlsh: number;
  sellSlsh: number;
  buyPriceUsd: number;
  sellPriceUsd: number;
  quantity: number;
  reorderLevel: number;
  expiryDate: string;
  dosageForm: string;
}

/**
 * Official 32-item Veterinary Inventory for B2 (Arabsiyo) and B3 (Gabiley)
 * Base conversion rate: 1 USD = 10,000 SLSH
 */
export const VET_BRANCH_INVENTORY_ITEMS: VetSeedItem[] = [
  { itemNo: 1, name: 'Albendazole 10% 1L', costSlsh: 84800, sellSlsh: 100000, buyPriceUsd: 8.48, sellPriceUsd: 10.0, quantity: 21, reorderLevel: 10, expiryDate: '2026-12-15', dosageForm: 'Oral Suspension' },
  { itemNo: 2, name: 'Albendazole 2.5% 1L', costSlsh: 19080, sellSlsh: 30000, buyPriceUsd: 1.908, sellPriceUsd: 3.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-01-10', dosageForm: 'Oral Suspension' },
  { itemNo: 3, name: 'Albendazole 2.5% 500ml', costSlsh: 12700, sellSlsh: 20000, buyPriceUsd: 1.27, sellPriceUsd: 2.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-06-30', dosageForm: 'Oral Suspension' },
  { itemNo: 4, name: 'Oxytetracycline 20% 100ml', costSlsh: 10000, sellSlsh: 20000, buyPriceUsd: 1.0, sellPriceUsd: 2.0, quantity: 21, reorderLevel: 10, expiryDate: '2029-09-01', dosageForm: 'Injection' },
  { itemNo: 5, name: 'Oxytetracycline 5% 50ml', costSlsh: 4800, sellSlsh: 10000, buyPriceUsd: 0.48, sellPriceUsd: 1.0, quantity: 21, reorderLevel: 10, expiryDate: '2028-01-01', dosageForm: 'Injection' },
  { itemNo: 6, name: 'Tylisin 100ml', costSlsh: 19020, sellSlsh: 30000, buyPriceUsd: 1.902, sellPriceUsd: 3.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-08-10', dosageForm: 'Injection' },
  { itemNo: 7, name: 'Tylisin 50ml', costSlsh: 9500, sellSlsh: 20000, buyPriceUsd: 0.95, sellPriceUsd: 2.0, quantity: 21, reorderLevel: 10, expiryDate: '2026-12-15', dosageForm: 'Injection' },
  { itemNo: 8, name: 'Multivitamine 100ml', costSlsh: 10000, sellSlsh: 20000, buyPriceUsd: 1.0, sellPriceUsd: 2.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-01-10', dosageForm: 'Injection' },
  { itemNo: 9, name: 'Multivitamine 50ml', costSlsh: 5000, sellSlsh: 13000, buyPriceUsd: 0.5, sellPriceUsd: 1.3, quantity: 21, reorderLevel: 10, expiryDate: '2027-06-30', dosageForm: 'Injection' },
  { itemNo: 10, name: 'Penstrapt 100ml', costSlsh: 28000, sellSlsh: 35000, buyPriceUsd: 2.8, sellPriceUsd: 3.5, quantity: 21, reorderLevel: 10, expiryDate: '2029-09-01', dosageForm: 'Injection' },
  { itemNo: 11, name: 'Spray Jordan', costSlsh: 26000, sellSlsh: 40000, buyPriceUsd: 2.6, sellPriceUsd: 4.0, quantity: 22, reorderLevel: 10, expiryDate: '2028-01-01', dosageForm: 'Topical Spray' },
  { itemNo: 12, name: 'Ivermectine 1% 100ml', costSlsh: 10000, sellSlsh: 15000, buyPriceUsd: 1.0, sellPriceUsd: 1.5, quantity: 21, reorderLevel: 10, expiryDate: '2027-08-10', dosageForm: 'Injection' },
  { itemNo: 13, name: 'Albendazole Tab. 300mg', costSlsh: 1500, sellSlsh: 3000, buyPriceUsd: 0.15, sellPriceUsd: 0.3, quantity: 21, reorderLevel: 10, expiryDate: '2026-12-15', dosageForm: 'Bolus / Tablet' },
  { itemNo: 14, name: 'Albendazole Tab. 600mg', costSlsh: 5000, sellSlsh: 7000, buyPriceUsd: 0.5, sellPriceUsd: 0.7, quantity: 21, reorderLevel: 10, expiryDate: '2027-01-10', dosageForm: 'Bolus / Tablet' },
  { itemNo: 15, name: 'Cypermetheine 1% 500ml', costSlsh: 28000, sellSlsh: 40000, buyPriceUsd: 2.8, sellPriceUsd: 4.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-06-30', dosageForm: 'Ectoparasiticide' },
  { itemNo: 16, name: 'Cypermetheine 1% 250ml', costSlsh: 16000, sellSlsh: 22000, buyPriceUsd: 1.6, sellPriceUsd: 2.2, quantity: 21, reorderLevel: 10, expiryDate: '2029-09-01', dosageForm: 'Ectoparasiticide' },
  { itemNo: 17, name: 'Cypermetheine 1% 100ml', costSlsh: 7500, sellSlsh: 15000, buyPriceUsd: 0.75, sellPriceUsd: 1.5, quantity: 21, reorderLevel: 10, expiryDate: '2028-01-01', dosageForm: 'Ectoparasiticide' },
  { itemNo: 18, name: 'Syringes 5ml', costSlsh: 500, sellSlsh: 1000, buyPriceUsd: 0.05, sellPriceUsd: 0.1, quantity: 21, reorderLevel: 10, expiryDate: '2027-08-10', dosageForm: 'Veterinary Supply' },
  { itemNo: 19, name: 'Syringes 10ml', costSlsh: 1000, sellSlsh: 1500, buyPriceUsd: 0.1, sellPriceUsd: 0.15, quantity: 21, reorderLevel: 10, expiryDate: '2026-12-15', dosageForm: 'Veterinary Supply' },
  { itemNo: 20, name: 'syringes 3ml', costSlsh: 1000, sellSlsh: 2000, buyPriceUsd: 0.1, sellPriceUsd: 0.2, quantity: 21, reorderLevel: 10, expiryDate: '2027-01-10', dosageForm: 'Veterinary Supply' },
  { itemNo: 21, name: 'Spray pumps 10L', costSlsh: 60000, sellSlsh: 65000, buyPriceUsd: 6.0, sellPriceUsd: 6.5, quantity: 21, reorderLevel: 10, expiryDate: '2027-06-30', dosageForm: 'Equipment' },
  { itemNo: 22, name: 'Spray pumps 15L', costSlsh: 75000, sellSlsh: 90000, buyPriceUsd: 7.5, sellPriceUsd: 9.0, quantity: 21, reorderLevel: 10, expiryDate: '2029-09-01', dosageForm: 'Equipment' },
  { itemNo: 23, name: 'Ivermwctine 1% 100ml', costSlsh: 20000, sellSlsh: 25000, buyPriceUsd: 2.0, sellPriceUsd: 2.5, quantity: 21, reorderLevel: 10, expiryDate: '2028-01-01', dosageForm: 'Injection' },
  { itemNo: 24, name: 'Gloves', costSlsh: 3000, sellSlsh: 5000, buyPriceUsd: 0.3, sellPriceUsd: 0.5, quantity: 21, reorderLevel: 10, expiryDate: '2027-08-10', dosageForm: 'Veterinary Supply' },
  { itemNo: 25, name: 'Tylosin-Holand 100ml', costSlsh: 47500, sellSlsh: 60000, buyPriceUsd: 4.75, sellPriceUsd: 6.0, quantity: 21, reorderLevel: 10, expiryDate: '2026-12-15', dosageForm: 'Injection' },
  { itemNo: 26, name: 'Ivermectine-Holand 100ml', costSlsh: 47500, sellSlsh: 60000, buyPriceUsd: 4.75, sellPriceUsd: 6.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-01-10', dosageForm: 'Injection' },
  { itemNo: 27, name: 'Vitanour', costSlsh: 21000, sellSlsh: 30000, buyPriceUsd: 2.1, sellPriceUsd: 3.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-06-30', dosageForm: 'Supplement' },
  { itemNo: 28, name: 'Ivermectine-Kenya 100ml', costSlsh: 30000, sellSlsh: 35000, buyPriceUsd: 3.0, sellPriceUsd: 3.5, quantity: 21, reorderLevel: 10, expiryDate: '2029-09-01', dosageForm: 'Injection' },
  { itemNo: 29, name: 'Vitamin B complex', costSlsh: 22000, sellSlsh: 35000, buyPriceUsd: 2.2, sellPriceUsd: 3.5, quantity: 21, reorderLevel: 10, expiryDate: '2028-01-01', dosageForm: 'Injection' },
  { itemNo: 30, name: 'Analgin-Sahan', costSlsh: 22000, sellSlsh: 30000, buyPriceUsd: 2.2, sellPriceUsd: 3.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-08-10', dosageForm: 'Injection' },
  { itemNo: 31, name: 'Ivermectine-jordan 50ml', costSlsh: 22000, sellSlsh: 26000, buyPriceUsd: 2.2, sellPriceUsd: 2.6, quantity: 21, reorderLevel: 10, expiryDate: '2026-12-15', dosageForm: 'Injection' },
  { itemNo: 32, name: 'Sulpha-Tablet', costSlsh: 7000, sellSlsh: 10000, buyPriceUsd: 0.7, sellPriceUsd: 1.0, quantity: 21, reorderLevel: 10, expiryDate: '2027-01-10', dosageForm: 'Bolus / Tablet' },
];

export const B1_PHARMACY_OFFLINE_PRODUCTS = [
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
];

/**
 * Seeds deterministic sample data into local IndexedDB on first run (and upgrades
 * older seeds) so every device shares the exact same product, batch, and customer
 * UUIDs with the PostgreSQL server, including all 32 veterinary items in B2 and B3.
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

  const legacyPlaceholderSkus = new Set([
    'B2-IVER-100ML',
    'B2-PPR-VAC',
    'B3-OXY-20LA',
    'B2-IVER-100',
    'B3-IVER-100',
  ]);
  const b1CanonicalIds = new Set(B1_PHARMACY_OFFLINE_PRODUCTS.map((p) => p.id));
  const b1CanonicalSkus = new Set(B1_PHARMACY_OFFLINE_PRODUCTS.map((p) => p.sku));

  await db.transaction(
    'rw',
    [db.branches, db.products, db.batches, db.stockMovements, db.customers],
    async () => {
      // Remove legacy placeholder B2/B3 products and non-canonical B1 duplicates
      const allProducts = await db.products.toArray();
      for (const p of allProducts) {
        const sku = String(p.sku || '');
        const shouldRemove =
          legacyPlaceholderSkus.has(sku) ||
          (b1CanonicalSkus.has(sku) && !b1CanonicalIds.has(p.id));

        if (shouldRemove) {
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
          await db.branches.put({ ...b, exchangeRate: 10000 });
        } else if (existingBranch.exchangeRate === 8500) {
          await db.branches.put({ ...existingBranch, exchangeRate: 10000 });
        }
      }

      // 1. Seed B1 Pharmacy Products
      for (const prod of B1_PHARMACY_OFFLINE_PRODUCTS) {
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

      // 2. Seed all 32 Veterinary Inventory Items into B2 (Arabsiyo) and B3 (Gabiley)
      const vetBranches = [
        { branch: BAXNAANO_BRANCHES.B2, prefix: '2222', catId: 'cat-default-b2', unitId: 'unit-default-b2' },
        { branch: BAXNAANO_BRANCHES.B3, prefix: '3333', catId: 'cat-default-b3', unitId: 'unit-default-b3' },
      ];

      for (const { branch, prefix, catId, unitId } of vetBranches) {
        for (const item of VET_BRANCH_INVENTORY_ITEMS) {
          const paddedNo = String(item.itemNo).padStart(4, '0');
          const prodId = `11111111-${prefix}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-00000000${paddedNo}`;
          const batchId = `22222222-${prefix}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-00000000${paddedNo}`;
          const movId = `33333333-${prefix}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-00000000${paddedNo}`;
          const sku = `${branch.code}-ITEM-${String(item.itemNo).padStart(2, '0')}`;
          const batchNumber = `${branch.code}-B${String(item.itemNo).padStart(2, '0')}`;
          const expiryIso = new Date(`${item.expiryDate}T00:00:00.000Z`).toISOString();

          const existingProd = await db.products.get(prodId);
          if (!existingProd) {
            await db.products.put({
              id: prodId,
              branchId: branch.id,
              categoryId: catId,
              unitId: unitId,
              sku,
              barcode: `629${prefix.slice(0, 1)}0000${paddedNo}`,
              name: item.name,
              dosageForm: item.dosageForm,
              isPrescriptionOnly: false,
              targetSpecies: ['CAMEL', 'CATTLE', 'SHEEP', 'GOAT'],
              isColdChainRequired: false,
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              reorderLevel: item.reorderLevel,
              createdById: 'seed-user',
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });
          } else {
            await db.products.put({
              ...existingProd,
              name: item.name,
              dosageForm: item.dosageForm,
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              reorderLevel: item.reorderLevel,
              deletedAt: null,
            });
          }

          const existingBatch = await db.batches.get(batchId);
          if (!existingBatch) {
            await db.batches.put({
              id: batchId,
              branchId: branch.id,
              productId: prodId,
              batchNumber,
              expiryDate: expiryIso,
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              cachedQuantity: item.quantity,
              createdById: 'seed-user',
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });

            await db.stockMovements.put({
              id: movId,
              branchId: branch.id,
              productId: prodId,
              batchId: batchId,
              userId: 'seed-user',
              type: 'INITIAL_STOCK',
              quantityDelta: item.quantity,
              unitCostUsd: item.buyPriceUsd,
              reason: `Initial inventory stock (${item.name})`,
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
