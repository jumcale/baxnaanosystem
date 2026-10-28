import { v4 as uuidv4 } from 'uuid';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { db } from '../db/dexie';

/**
 * Seeds realistic sample data into local IndexedDB on first run so the PWA
 * is immediately playable offline across all 3 branches:
 * - B1: Baxnaano Pharmacy (Arabsiyo - Human Health)
 * - B2: Baxnaano Veterinary (Arabsiyo - Livestock Health)
 * - B3: Baxnaano Veterinary (Gabiley - Livestock Health)
 */
export async function ensureLocalOfflineSeedData(): Promise<void> {
  const existingProductsCount = await db.products.count();
  if (existingProductsCount > 0) return;

  const now = new Date().toISOString();
  const in25Days = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
  const in180Days = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const expired10DaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  const b1Id = BAXNAANO_BRANCHES.B1.id;
  const b2Id = BAXNAANO_BRANCHES.B2.id;
  const b3Id = BAXNAANO_BRANCHES.B3.id;

  const sampleProducts = [
    // B1 Human Pharmacy (Arabsiyo)
    {
      id: uuidv4(),
      branchId: b1Id,
      categoryId: 'cat-antibiotics',
      unitId: 'unit-box',
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
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: uuidv4(),
      branchId: b1Id,
      categoryId: 'cat-analgesics',
      unitId: 'unit-btl',
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
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    // B2 Veterinary Clinic (Arabsiyo)
    {
      id: uuidv4(),
      branchId: b2Id,
      categoryId: 'cat-vet-antiparasitic',
      unitId: 'unit-vial',
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
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: uuidv4(),
      branchId: b2Id,
      categoryId: 'cat-vet-vaccines',
      unitId: 'unit-vial',
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
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    // B3 Veterinary Clinic (Gabiley)
    {
      id: uuidv4(),
      branchId: b3Id,
      categoryId: 'cat-vet-antibiotics',
      unitId: 'unit-vial',
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
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];

  await db.transaction(
    'rw',
    [db.branches, db.products, db.batches, db.stockMovements, db.customers],
    async () => {
      for (const b of Object.values(BAXNAANO_BRANCHES)) {
        await db.branches.put({ ...b, exchangeRate: 8500 });
      }

      for (const prod of sampleProducts) {
        await db.products.put(prod);

        // Create 2 active FEFO batches + 1 expired batch on first item to demonstrate FEFO & expiry blocking
        const batch1Id = uuidv4();
        await db.batches.put({
          id: batch1Id,
          branchId: prod.branchId,
          productId: prod.id,
          batchNumber: `${prod.sku.slice(0, 6)}-FEFO1`,
          expiryDate: in25Days,
          buyPriceUsd: prod.buyPriceUsd,
          sellPriceUsd: prod.sellPriceUsd,
          cachedQuantity: 40,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });

        await db.stockMovements.put({
          id: uuidv4(),
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

        const batch2Id = uuidv4();
        await db.batches.put({
          id: batch2Id,
          branchId: prod.branchId,
          productId: prod.id,
          batchNumber: `${prod.sku.slice(0, 6)}-FEFO2`,
          expiryDate: in180Days,
          buyPriceUsd: prod.buyPriceUsd,
          sellPriceUsd: prod.sellPriceUsd,
          cachedQuantity: 85,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });

        await db.stockMovements.put({
          id: uuidv4(),
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
          const expBatchId = uuidv4();
          await db.batches.put({
            id: expBatchId,
            branchId: prod.branchId,
            productId: prod.id,
            batchNumber: 'AMOX-EXP99',
            expiryDate: expired10DaysAgo,
            buyPriceUsd: prod.buyPriceUsd,
            sellPriceUsd: prod.sellPriceUsd,
            cachedQuantity: 12,
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
          await db.stockMovements.put({
            id: uuidv4(),
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

      // Seed Sample Customers for B1, B2, B3
      await db.customers.bulkPut([
        {
          id: uuidv4(),
          branchId: b1Id,
          name: 'Maryan Cabdi Xasan',
          phone: '+252634410011',
          villageOrFarm: 'Arabsiyo Center',
          creditLimitUsd: 150,
          currentBalanceUsd: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: uuidv4(),
          branchId: b2Id,
          name: 'Geelle Cumar (Geel-dhaqato)',
          phone: '+252634420022',
          villageOrFarm: 'Agabar / Arabsiyo',
          creditLimitUsd: 300,
          currentBalanceUsd: 45,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: uuidv4(),
          branchId: b3Id,
          name: 'Xaaji Muuse Warsame',
          phone: '+252634430033',
          villageOrFarm: 'Wajaale Road / Gabiley',
          creditLimitUsd: 400,
          currentBalanceUsd: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    }
  );
}
