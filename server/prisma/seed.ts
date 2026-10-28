import { PrismaClient, BranchType, RoleName, Species, StockMovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BAXNAANO_BRANCHES, ROLE_PERMISSIONS } from '@baxnaano/shared';

const prisma = new PrismaClient();

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

  // Remove deprecated/deleted accounts if present
  await prisma.user.deleteMany({
    where: {
      username: { in: ['pharmacist_b1', 'cashier_b1'] },
    },
  });

  const seedUsers = [
    {
      username: 'admin',
      fullName: 'Guudmare Baxnaano (Global Admin)',
      role: 'ADMIN',
      branchId: null,
    },
    {
      username: 'manager_b1',
      fullName: 'Axmed Cali (B1 Pharmacy Manager - Arabsiyo)',
      role: 'BRANCH_MANAGER',
      branchId: BAXNAANO_BRANCHES.B1.id,
    },
    {
      username: 'manager_b2',
      fullName: 'Maxamed Nuur (B2 Vet Manager - Arabsiyo)',
      role: 'BRANCH_MANAGER',
      branchId: BAXNAANO_BRANCHES.B2.id,
    },
    {
      username: 'vet_b2',
      fullName: 'Dr. Cabdi Warsame (B2 Vet Officer - Arabsiyo)',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B2.id,
    },
    {
      username: 'vet_b3',
      fullName: 'Dr. Faysal Jaamac (B3 Vet Officer - Gabiley)',
      role: 'VET_OFFICER',
      branchId: BAXNAANO_BRANCHES.B3.id,
    },
    {
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

  // 4. Seed Categories, Units, Sample Products, FEFO Batches & Ledger Movements per Branch
  const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const in240Days = new Date(Date.now() + 240 * 24 * 60 * 60 * 1000);

  for (const branchDef of Object.values(BAXNAANO_BRANCHES)) {
    const category = await prisma.category.upsert({
      where: { branchId_name: { branchId: branchDef.id, name: 'General Medicines' } },
      update: {},
      create: {
        branchId: branchDef.id,
        name: 'General Medicines',
        nameSo: 'Daawooyinka Guud',
      },
    });

    const unit = await prisma.unit.upsert({
      where: { branchId_name: { branchId: branchDef.id, name: 'Unit' } },
      update: {},
      create: {
        branchId: branchDef.id,
        name: 'Unit',
        abbreviation: 'pcs',
      },
    });

    const isPharmacy = branchDef.type === 'PHARMACY';
    const sku = isPharmacy ? `${branchDef.code}-AMOX-500` : `${branchDef.code}-IVER-100`;

    const product = await prisma.product.upsert({
      where: { branchId_sku: { branchId: branchDef.id, sku } },
      update: {},
      create: {
        branchId: branchDef.id,
        categoryId: category.id,
        unitId: unit.id,
        sku,
        barcode: isPharmacy ? '629100000101' : '629200000201',
        name: isPharmacy
          ? 'Amoxicillin 500mg Capsules (20s)'
          : 'Ivermectin 1% Veterinary Injection (100ml)',
        buyPriceUsd: isPharmacy ? 1.8 : 4.5,
        sellPriceUsd: isPharmacy ? 3.0 : 7.5,
        reorderLevel: 15,
        genericName: isPharmacy ? 'Amoxicillin Trihydrate' : 'Ivermectin',
        dosageForm: isPharmacy ? 'Capsule' : 'Injection',
        strength: isPharmacy ? '500mg' : '1% w/v',
        isPrescriptionOnly: isPharmacy,
        targetSpecies: isPharmacy
          ? []
          : ([Species.CAMEL, Species.CATTLE, Species.SHEEP, Species.GOAT] as Species[]),
        dosePerKg: isPharmacy ? null : '1ml per 50kg subcutaneous',
        withdrawalPeriodDays: isPharmacy ? null : 28,
        isColdChainRequired: false,
      },
    });

    const batch = await prisma.productBatch.upsert({
      where: {
        branchId_productId_batchNumber: {
          branchId: branchDef.id,
          productId: product.id,
          batchNumber: `${branchDef.code}-BATCH-01`,
        },
      },
      update: {},
      create: {
        branchId: branchDef.id,
        productId: product.id,
        batchNumber: `${branchDef.code}-BATCH-01`,
        expiryDate: in60Days < in240Days ? in60Days : in240Days,
        buyPriceUsd: product.buyPriceUsd,
        sellPriceUsd: product.sellPriceUsd,
        cachedQuantity: 100,
      },
    });

    const existingMovements = await prisma.stockMovement.count({
      where: { batchId: batch.id },
    });
    if (existingMovements === 0) {
      await prisma.stockMovement.create({
        data: {
          branchId: branchDef.id,
          productId: product.id,
          batchId: batch.id,
          userId: adminUserId,
          type: StockMovementType.INITIAL_STOCK,
          quantityDelta: 100,
          unitCostUsd: product.buyPriceUsd,
          reason: 'Initial seeded stock',
        },
      });
    }
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
