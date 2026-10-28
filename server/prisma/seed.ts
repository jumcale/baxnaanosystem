import { PrismaClient, BranchType, RoleName, Species, StockMovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BAXNAANO_BRANCHES, ROLE_PERMISSIONS } from '@baxnaano/shared';

const prisma = new PrismaClient();

export const CANONICAL_SEED_PRODUCTS = [
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
    targetSpecies: [] as Species[],
    dosePerKg: null,
    withdrawalPeriodDays: null,
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
    sku: 'B1-PARA-SYR',
    barcode: '629100000102',
    name: 'Paracetamol Pediatric Syrup 120mg/5ml',
    genericName: 'Acetaminophen',
    dosageForm: 'Syrup',
    strength: '120mg/5ml',
    isPrescriptionOnly: false,
    targetSpecies: [] as Species[],
    dosePerKg: null,
    withdrawalPeriodDays: null,
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
    sku: 'B2-IVER-100ML',
    barcode: '629200000201',
    name: 'Ivermectin 1% Injection (100ml Vial)',
    genericName: 'Ivermectin',
    dosageForm: 'Injection',
    strength: '1% w/v',
    isPrescriptionOnly: false,
    targetSpecies: [Species.CAMEL, Species.CATTLE, Species.SHEEP, Species.GOAT],
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
    sku: 'B2-PPR-VAC',
    barcode: '629200000202',
    name: 'PPR Sheep & Goat Vaccine (100 Doses)',
    genericName: 'Peste des Petits Ruminants Live Attenuated',
    dosageForm: 'Lyophilized Vaccine',
    strength: '100 Doses',
    isPrescriptionOnly: true,
    targetSpecies: [Species.SHEEP, Species.GOAT],
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
    sku: 'B3-OXY-20LA',
    barcode: '629300000301',
    name: 'Oxytetracycline 20% Long Acting (100ml)',
    genericName: 'Oxytetracycline Dihydrate',
    dosageForm: 'Injection',
    strength: '200mg/ml',
    isPrescriptionOnly: false,
    targetSpecies: [Species.CAMEL, Species.CATTLE, Species.SHEEP, Species.GOAT],
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
      },
      create: {
        id: branchDef.id,
        code: branchDef.code,
        name: branchDef.name,
        type: branchDef.type as BranchType,
        location: branchDef.location,
        exchangeRate: 8500.0,
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

  // 4. Seed Categories, Units, & Suppliers per Branch
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

  // 5. Seed Canonical Products, FEFO Batches & Initial Movements
  const in25Days = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
  const in180Days = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const expired10DaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  for (const prodDef of CANONICAL_SEED_PRODUCTS) {
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
        targetSpecies: prodDef.targetSpecies,
        dosePerKg: prodDef.dosePerKg,
        withdrawalPeriodDays: prodDef.withdrawalPeriodDays,
        isColdChainRequired: prodDef.isColdChainRequired,
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

    if (prodDef.sku === 'B1-AMOX-500') {
      const expBatch = await prisma.productBatch.upsert({
        where: {
          branchId_productId_batchNumber: {
            branchId: prodDef.branchId,
            productId: product.id,
            batchNumber: 'AMOX-EXP99',
          },
        },
        update: {},
        create: {
          id: '22222222-9999-4111-8111-111111111101',
          branchId: prodDef.branchId,
          productId: product.id,
          batchNumber: 'AMOX-EXP99',
          expiryDate: expired10DaysAgo,
          buyPriceUsd: prodDef.buyPriceUsd,
          sellPriceUsd: prodDef.sellPriceUsd,
          cachedQuantity: 12,
        },
      });
      const expMoves = await prisma.stockMovement.count({ where: { batchId: expBatch.id } });
      if (expMoves === 0) {
        await prisma.stockMovement.create({
          data: {
            id: '33333333-9999-4111-8111-111111111101',
            branchId: prodDef.branchId,
            productId: product.id,
            batchId: expBatch.id,
            userId: adminUserId,
            type: StockMovementType.INITIAL_STOCK,
            quantityDelta: 12,
            unitCostUsd: prodDef.buyPriceUsd,
            reason: 'Expired batch sample (Blocked by FEFO)',
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

  console.log('✅ Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
