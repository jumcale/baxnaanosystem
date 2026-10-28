import { PrismaClient, BranchType, RoleName, Species, StockMovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BAXNAANO_BRANCHES, ROLE_PERMISSIONS } from '@baxnaano/shared';

const prisma = new PrismaClient();

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

export const B1_PHARMACY_SEED_PRODUCTS = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    branchId: BAXNAANO_BRANCHES.B1.id,
    sku: 'B1-AMOX-500',
    barcode: '629100000101',
    name: 'Amoxicillin 500mg Capsules (20s)',
    genericName: 'Amoxicillin Trihydrate',
    dosageForm: 'Capsule',
    strength: '500mg',
    isPrescriptionOnly: true,
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
    sku: 'B1-PARA-SYR',
    barcode: '629100000102',
    name: 'Paracetamol Pediatric Syrup 120mg/5ml',
    genericName: 'Acetaminophen',
    dosageForm: 'Syrup',
    strength: '120mg/5ml',
    isPrescriptionOnly: false,
    buyPriceUsd: 0.9,
    sellPriceUsd: 1.5,
    reorderLevel: 15,
    batch1Id: '22222222-1111-4111-8111-111111111102',
    batch2Id: '22222222-2222-4111-8111-111111111102',
    mov1Id: '33333333-1111-4111-8111-111111111102',
    mov2Id: '33333333-2222-4111-8111-111111111102',
  },
];

async function main() {
  console.log('🌱 Seeding Baxnaano Pharmacy & Veterinary Clinic database...');

  // 1. Seed Branches (B1 Arabsiyo Pharmacy, B2 Arabsiyo Vet, B3 Gabiley Vet)
  for (const branchDef of Object.values(BAXNAANO_BRANCHES)) {
    await prisma.branch.upsert({
      where: { code: branchDef.code },
      update: {
        name: branchDef.name,
        type: branchDef.type as BranchType,
        location: branchDef.location,
        exchangeRate: 10000.0,
      },
      create: {
        id: branchDef.id,
        code: branchDef.code,
        name: branchDef.name,
        type: branchDef.type as BranchType,
        location: branchDef.location,
        exchangeRate: 10000.0,
        receiptHeader: `${branchDef.name} - ${branchDef.location}`,
        receiptFooter: 'Thank you for choosing Baxnaano! / Mahadsanid!',
      },
    });
  }

  // 2. Seed Roles
  const roleMap: Record<string, string> = {};
  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName as RoleName },
      update: { permissions },
      create: {
        name: roleName as RoleName,
        description: `${roleName} role for Baxnaano`,
        permissions,
      },
    });
    roleMap[roleName] = role.id;
  }

  // 3. Seed Users across all Roles & Branches (Default Password: Password123!)
  const defaultPasswordHash = await bcrypt.hash('Password123!', 12);

  await prisma.user.deleteMany({
    where: {
      username: { in: ['pharmacist_b1', 'cashier_b1'] },
    },
  });

  const seedUsers = [
    {
      id: 'user-admin-global',
      username: 'admin',
      fullName: 'Guudmare Baxnaano (Global Admin)',
      role: 'ADMIN',
      branchId: null,
    },
    {
      id: 'user-manager-b1',
      username: 'manager_b1',
      fullName: 'Axmed Cali (B1 Pharmacy Manager - Arabsiyo)',
      role: 'BRANCH_MANAGER',
      branchId: BAXNAANO_BRANCHES.B1.id,
    },
    {
      id: 'user-manager-b2',
      username: 'manager_b2',
      fullName: 'Maxamed Nuur (B2 Vet Manager - Arabsiyo)',
      role: 'BRANCH_MANAGER',
      branchId: BAXNAANO_BRANCHES.B2.id,
    },
    {
      id: 'user-vet-b2',
      username: 'vet_b2',
      fullName: 'Dr. Cabdi Warsame (B2 Vet Officer - Arabsiyo)',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B2.id,
    },
    {
      id: 'user-vet-b3',
      username: 'vet_b3',
      fullName: 'Dr. Faysal Jaamac (B3 Vet Officer - Gabiley)',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B3.id,
    },
    {
      id: 'user-cashier-b3',
      username: 'cashier_b3',
      fullName: 'Aamina Faarax (B3 Cashier - Gabiley)',
      role: 'CASHIER',
      branchId: BAXNAANO_BRANCHES.B3.id,
    },
  ];

  let adminUserId = '';
  for (const u of seedUsers) {
    const createdUser = await prisma.user.upsert({
      where: { username: u.username },
      update: {
        fullName: u.fullName,
        roleId: roleMap[u.role],
        branchId: u.branchId,
      },
      create: {
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        roleId: roleMap[u.role],
        branchId: u.branchId,
        passwordHash: defaultPasswordHash,
        language: 'en',
      },
    });
    if (u.username === 'admin') adminUserId = createdUser.id;
  }

  // 4. Seed Categories & Units per Branch
  const branchCategories: Record<string, string> = {};
  const branchUnits: Record<string, string> = {};

  for (const branchDef of Object.values(BAXNAANO_BRANCHES)) {
    const category = await prisma.category.upsert({
      where: { branchId_name: { branchId: branchDef.id, name: 'General Medicines' } },
      update: {},
      create: {
        id: `cat-default-${branchDef.code.toLowerCase()}`,
        branchId: branchDef.id,
        name: 'General Medicines',
        nameSo: 'Daawooyinka Guud',
      },
    });
    branchCategories[branchDef.id] = category.id;

    const unit = await prisma.unit.upsert({
      where: { branchId_name: { branchId: branchDef.id, name: 'Unit' } },
      update: {},
      create: {
        id: `unit-default-${branchDef.code.toLowerCase()}`,
        branchId: branchDef.id,
        name: 'Unit',
        abbreviation: 'pcs',
      },
    });
    branchUnits[branchDef.id] = unit.id;
  }

  // 5A. Seed B1 Pharmacy Sample Products
  const in25Days = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
  const in180Days = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

  for (const prodDef of B1_PHARMACY_SEED_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { branchId_sku: { branchId: prodDef.branchId, sku: prodDef.sku } },
      update: {
        name: prodDef.name,
        barcode: prodDef.barcode,
        buyPriceUsd: prodDef.buyPriceUsd,
        sellPriceUsd: prodDef.sellPriceUsd,
      },
      create: {
        id: prodDef.id,
        branchId: prodDef.branchId,
        categoryId: branchCategories[prodDef.branchId],
        unitId: branchUnits[prodDef.branchId],
        sku: prodDef.sku,
        barcode: prodDef.barcode,
        name: prodDef.name,
        genericName: prodDef.genericName,
        dosageForm: prodDef.dosageForm,
        strength: prodDef.strength,
        isPrescriptionOnly: prodDef.isPrescriptionOnly,
        targetSpecies: [],
        buyPriceUsd: prodDef.buyPriceUsd,
        sellPriceUsd: prodDef.sellPriceUsd,
        reorderLevel: prodDef.reorderLevel,
      },
    });

    const batch1Num = `${prodDef.sku.slice(0, 6)}-FEFO1`;
    const batch1 = await prisma.productBatch.upsert({
      where: {
        branchId_productId_batchNumber: {
          branchId: prodDef.branchId,
          productId: product.id,
          batchNumber: batch1Num,
        },
      },
      update: {},
      create: {
        id: prodDef.batch1Id,
        branchId: prodDef.branchId,
        productId: product.id,
        batchNumber: batch1Num,
        expiryDate: in25Days,
        buyPriceUsd: prodDef.buyPriceUsd,
        sellPriceUsd: prodDef.sellPriceUsd,
        cachedQuantity: 40,
      },
    });

    const b1Moves = await prisma.stockMovement.count({ where: { batchId: batch1.id } });
    if (b1Moves === 0) {
      await prisma.stockMovement.create({
        data: {
          id: prodDef.mov1Id,
          branchId: prodDef.branchId,
          productId: product.id,
          batchId: batch1.id,
          userId: adminUserId,
          type: StockMovementType.INITIAL_STOCK,
          quantityDelta: 40,
          unitCostUsd: prodDef.buyPriceUsd,
          reason: 'Initial opening stock',
        },
      });
    }

    const batch2Num = `${prodDef.sku.slice(0, 6)}-FEFO2`;
    const batch2 = await prisma.productBatch.upsert({
      where: {
        branchId_productId_batchNumber: {
          branchId: prodDef.branchId,
          productId: product.id,
          batchNumber: batch2Num,
        },
      },
      update: {},
      create: {
        id: prodDef.batch2Id,
        branchId: prodDef.branchId,
        productId: product.id,
        batchNumber: batch2Num,
        expiryDate: in180Days,
        buyPriceUsd: prodDef.buyPriceUsd,
        sellPriceUsd: prodDef.sellPriceUsd,
        cachedQuantity: 85,
      },
    });

    const b2Moves = await prisma.stockMovement.count({ where: { batchId: batch2.id } });
    if (b2Moves === 0) {
      await prisma.stockMovement.create({
        data: {
          id: prodDef.mov2Id,
          branchId: prodDef.branchId,
          productId: product.id,
          batchId: batch2.id,
          userId: adminUserId,
          type: StockMovementType.INITIAL_STOCK,
          quantityDelta: 85,
          unitCostUsd: prodDef.buyPriceUsd,
          reason: 'Secondary batch stock',
        },
      });
    }
  }

  // 5B. Clean up legacy sample B2/B3 placeholder products & seed the 32 Official Veterinary Inventory Items
  await prisma.product.updateMany({
    where: {
      sku: {
        in: ['B2-IVER-100ML', 'B2-PPR-VAC', 'B3-OXY-20LA', 'B2-IVER-100', 'B3-IVER-100'],
      },
    },
    data: {
      deletedAt: new Date(),
    },
  });

  const vetBranches = [
    { branch: BAXNAANO_BRANCHES.B2, prefix: '2222' },
    { branch: BAXNAANO_BRANCHES.B3, prefix: '3333' },
  ];

  for (const { branch, prefix } of vetBranches) {
    for (const item of VET_BRANCH_INVENTORY_ITEMS) {
      const paddedNo = String(item.itemNo).padStart(4, '0');
      const prodId = `11111111-${prefix}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-00000000${paddedNo}`;
      const batchId = `22222222-${prefix}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-00000000${paddedNo}`;
      const movId = `33333333-${prefix}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-00000000${paddedNo}`;
      const sku = `${branch.code}-ITEM-${String(item.itemNo).padStart(2, '0')}`;
      const batchNumber = `${branch.code}-B${String(item.itemNo).padStart(2, '0')}`;
      const expiryDate = new Date(`${item.expiryDate}T00:00:00.000Z`);

      const product = await prisma.product.upsert({
        where: { branchId_sku: { branchId: branch.id, sku } },
        update: {
          name: item.name,
          buyPriceUsd: item.buyPriceUsd,
          sellPriceUsd: item.sellPriceUsd,
          reorderLevel: item.reorderLevel,
          dosageForm: item.dosageForm,
        },
        create: {
          id: prodId,
          branchId: branch.id,
          categoryId: branchCategories[branch.id],
          unitId: branchUnits[branch.id],
          sku,
          barcode: `629${prefix.slice(0, 1)}0000${paddedNo}`,
          name: item.name,
          dosageForm: item.dosageForm,
          isPrescriptionOnly: false,
          targetSpecies: [Species.CAMEL, Species.CATTLE, Species.SHEEP, Species.GOAT],
          buyPriceUsd: item.buyPriceUsd,
          sellPriceUsd: item.sellPriceUsd,
          reorderLevel: item.reorderLevel,
        },
      });

      const batch = await prisma.productBatch.upsert({
        where: {
          branchId_productId_batchNumber: {
            branchId: branch.id,
            productId: product.id,
            batchNumber,
          },
        },
        update: {
          expiryDate,
          buyPriceUsd: item.buyPriceUsd,
          sellPriceUsd: item.sellPriceUsd,
        },
        create: {
          id: batchId,
          branchId: branch.id,
          productId: product.id,
          batchNumber,
          expiryDate,
          buyPriceUsd: item.buyPriceUsd,
          sellPriceUsd: item.sellPriceUsd,
          cachedQuantity: item.quantity,
        },
      });

      const existingMoves = await prisma.stockMovement.count({ where: { batchId: batch.id } });
      if (existingMoves === 0) {
        await prisma.stockMovement.create({
          data: {
            id: movId,
            branchId: branch.id,
            productId: product.id,
            batchId: batch.id,
            userId: adminUserId,
            type: StockMovementType.INITIAL_STOCK,
            quantityDelta: item.quantity,
            unitCostUsd: item.buyPriceUsd,
            reason: `Initial inventory stock (${item.name})`,
          },
        });
      }
    }
  }

  // 6. Seed Canonical Customers per Branch
  const seedCustomers = [
    {
      id: '44444444-1111-4111-8111-111111111101',
      branchId: BAXNAANO_BRANCHES.B1.id,
      name: 'Maryan Cabdi Xasan',
      phone: '+252634410011',
      villageOrFarm: 'Arabsiyo Center',
      creditLimitUsd: 150,
      currentBalanceUsd: 0,
    },
    {
      id: '44444444-1111-4111-8111-111111111201',
      branchId: BAXNAANO_BRANCHES.B2.id,
      name: 'Geelle Cumar (Geel-dhaqato)',
      phone: '+252634420022',
      villageOrFarm: 'Agabar / Arabsiyo',
      creditLimitUsd: 300,
      currentBalanceUsd: 45,
    },
    {
      id: '44444444-1111-4111-8111-111111111301',
      branchId: BAXNAANO_BRANCHES.B3.id,
      name: 'Xaaji Muuse Warsame',
      phone: '+252634430033',
      villageOrFarm: 'Wajaale Road / Gabiley',
      creditLimitUsd: 400,
      currentBalanceUsd: 0,
    },
  ];

  for (const cust of seedCustomers) {
    await prisma.customer.upsert({
      where: { id: cust.id },
      update: {},
      create: cust,
    });
  }

  console.log('✅ Seed completed successfully (including 32 items in B2 and 32 items in B3).');
}

main()
  .catch((e) => {
    console.error(e);
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
