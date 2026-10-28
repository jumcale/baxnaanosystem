import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Package,
  Plus,
  AlertTriangle,
  Snowflake,
  FileText,
  ArrowLeftRight,
  ClipboardCheck,
  History,
  Truck,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  BAXNAANO_BRANCHES,
  SPECIES_ENUM,
  SpeciesType,
} from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { mutateOfflineFirst } from '../db/dexie';
import {
  getOfflineProductsWithFEFO,
  recordOfflinePurchaseStockIn,
  appendOfflineStockMovement,
  performOfflineStockTake,
  createOfflineStockTransfer,
  getOfflineStockTransfers,
  getOfflineStockMovements,
  OfflineStockTransferRecord,
} from '../services/inventory.offline';
import { NumericInput } from '../components/NumericInput';

type InventoryTab =
  | 'products'
  | 'stock_in'
  | 'adjustments'
  | 'transfers'
  | 'stock_take'
  | 'ledger';

export const InventoryPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId, canPerform } = useAuth();

  const [activeTab, setActiveTab] = useState<InventoryTab>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Awaited<ReturnType<typeof getOfflineProductsWithFEFO>>>(
    []
  );
  const [transfers, setTransfers] = useState<OfflineStockTransferRecord[]>([]);
  const [movements, setMovements] = useState<Awaited<ReturnType<typeof getOfflineStockMovements>>>(
    []
  );
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Determine active branch metadata (Pharmacy B1 vs Veterinary B2/B3)
  const currentBranchMeta = useMemo(() => {
    const found = Object.values(BAXNAANO_BRANCHES).find(
      (b) => b.id === activeBranchId || b.code === activeBranchId
    );
    return found || BAXNAANO_BRANCHES.B1;
  }, [activeBranchId]);

  const isPharmacyBranch =
    activeBranchId === 'ALL' || currentBranchMeta.type === 'PHARMACY';
  const isVetBranch =
    activeBranchId === 'ALL' || currentBranchMeta.type === 'VETERINARY';

  const loadLocalInventory = async () => {
    const [list, trfs, movs] = await Promise.all([
      getOfflineProductsWithFEFO(activeBranchId),
      getOfflineStockTransfers(activeBranchId),
      getOfflineStockMovements(activeBranchId),
    ]);
    setProducts(list);
    setTransfers(trfs);
    setMovements(movs);
  };

  useEffect(() => {
    loadLocalInventory();
  }, [activeBranchId]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Filtered products
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(q) ||
        String(p.sku).toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase().includes(q) ||
        String(p.genericName || '').toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  // New Product Form State
  const [newProduct, setNewProduct] = useState({
    branchId: BAXNAANO_BRANCHES.B1.id,
    sku: '',
    barcode: '',
    name: '',
    categoryId: 'default-category',
    unitId: 'default-unit',
    buyPriceUsd: 0,
    sellPriceUsd: 0,
    reorderLevel: 15,
    // Pharmacy
    genericName: '',
    dosageForm: 'Tablet',
    strength: '',
    isPrescriptionOnly: false,
    // Veterinary
    targetSpecies: [] as SpeciesType[],
    dosePerKg: '',
    withdrawalPeriodDays: 0,
    isColdChainRequired: false,
  });

  // Stock-In (Purchase) State
  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: 'default-supplier',
    invoiceNumber: '',
    productId: '',
    batchNumber: '',
    expiryDate: '',
    quantity: 50,
    buyPriceUsd: 0,
    sellPriceUsd: 0,
    paidAmountUsd: 0,
  });

  // Adjustment / Damage Form State
  const [adjustmentForm, setAdjustmentForm] = useState({
    productId: '',
    batchId: '',
    type: 'DAMAGE_EXPIRED' as 'ADJUSTMENT_PLUS' | 'ADJUSTMENT_MINUS' | 'DAMAGE_EXPIRED',
    quantity: 1,
    reason: '',
  });

  // Inter-Branch Transfer Form State
  const [transferForm, setTransferForm] = useState({
    productId: '',
    batchId: '',
    destinationBranchId: BAXNAANO_BRANCHES.B2.id,
    quantity: 1,
    notes: '',
  });

  // Stock Take Counts State (batchId -> physical count)
  const [stockTakeCounts, setStockTakeCounts] = useState<Record<string, number>>({});
  const [varianceResults, setVarianceResults] = useState<
    Awaited<ReturnType<typeof performOfflineStockTake>>['varianceReport'] | null
  >(null);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetBranch =
      activeBranchId === 'ALL' ? newProduct.branchId : activeBranchId;

    await mutateOfflineFirst('products', 'Product', 'CREATE', {
      ...newProduct,
      branchId: targetBranch,
    });

    setShowAddProductModal(false);
    setNewProduct({
      branchId: BAXNAANO_BRANCHES.B1.id,
      sku: '',
      barcode: '',
      name: '',
      categoryId: 'default-category',
      unitId: 'default-unit',
      buyPriceUsd: 0,
      sellPriceUsd: 0,
      reorderLevel: 15,
      genericName: '',
      dosageForm: 'Tablet',
      strength: '',
      isPrescriptionOnly: false,
      targetSpecies: [],
      dosePerKg: '',
      withdrawalPeriodDays: 0,
      isColdChainRequired: false,
    });
    await loadLocalInventory();
    triggerToast(`${newProduct.name} saved offline.`);
  };

  const handleReceivePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const selectedProd = products.find((p) => p.id === purchaseForm.productId);
    const targetBranch =
      activeBranchId === 'ALL'
        ? String(selectedProd?.branchId || BAXNAANO_BRANCHES.B1.id)
        : activeBranchId;

    const buyPrice =
      purchaseForm.buyPriceUsd > 0
        ? purchaseForm.buyPriceUsd
        : Number(selectedProd?.buyPriceUsd || 1);
    const sellPrice =
      purchaseForm.sellPriceUsd > 0
        ? purchaseForm.sellPriceUsd
        : Number(selectedProd?.sellPriceUsd || buyPrice * 1.5);

    await recordOfflinePurchaseStockIn({
      branchId: targetBranch,
      supplierId: purchaseForm.supplierId,
      invoiceNumber: purchaseForm.invoiceNumber,
      paidAmountUsd: Number(purchaseForm.paidAmountUsd),
      userId: user.id,
      items: [
        {
          productId: purchaseForm.productId,
          batchNumber: purchaseForm.batchNumber,
          expiryDate: purchaseForm.expiryDate,
          quantity: Math.max(1, Number(purchaseForm.quantity)),
          buyPriceUsd: buyPrice,
          sellPriceUsd: sellPrice,
        },
      ],
    });

    setPurchaseForm({
      supplierId: 'default-supplier',
      invoiceNumber: '',
      productId: '',
      batchNumber: '',
      expiryDate: '',
      quantity: 50,
      buyPriceUsd: 0,
      sellPriceUsd: 0,
      paidAmountUsd: 0,
    });
    await loadLocalInventory();
    triggerToast(`Batch #${purchaseForm.batchNumber} received into FEFO ledger.`);
  };

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const selectedProd = products.find((p) => p.id === adjustmentForm.productId);
    const targetBranch =
      activeBranchId === 'ALL'
        ? String(selectedProd?.branchId || BAXNAANO_BRANCHES.B1.id)
        : activeBranchId;

    const signedDelta =
      adjustmentForm.type === 'ADJUSTMENT_PLUS'
        ? Math.abs(Number(adjustmentForm.quantity))
        : -Math.abs(Number(adjustmentForm.quantity));

    await appendOfflineStockMovement({
      branchId: targetBranch,
      productId: adjustmentForm.productId,
      batchId: adjustmentForm.batchId,
      userId: user.id,
      type: adjustmentForm.type,
      quantityDelta: signedDelta,
      referenceType: 'ADJUSTMENT',
      reason: adjustmentForm.reason,
    });

    setAdjustmentForm({
      productId: '',
      batchId: '',
      type: 'DAMAGE_EXPIRED',
      quantity: 1,
      reason: '',
    });
    await loadLocalInventory();
    triggerToast('Stock movement appended to ledger.');
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const selectedProd = products.find((p) => p.id === transferForm.productId);
    const sourceBranchId =
      activeBranchId === 'ALL'
        ? String(selectedProd?.branchId || BAXNAANO_BRANCHES.B1.id)
        : activeBranchId;

    try {
      const trf = await createOfflineStockTransfer({
        sourceBranchId,
        destinationBranchId: transferForm.destinationBranchId,
        productId: transferForm.productId,
        batchId: transferForm.batchId,
        quantity: Math.max(1, Number(transferForm.quantity)),
        notes: transferForm.notes,
        userId: user.id,
      });

      setTransferForm({
        productId: '',
        batchId: '',
        destinationBranchId: BAXNAANO_BRANCHES.B2.id,
        quantity: 1,
        notes: '',
      });
      await loadLocalInventory();
      triggerToast(`Transfer #${trf.transferNumber} completed.`);
    } catch (err: unknown) {
      triggerToast(err instanceof Error ? err.message : 'Transfer failed');
    }
  };

  const handleReconcileStockTake = async () => {
    if (!user) return;

    const groupedByBranch = new Map<
      string,
      Array<{ productId: string; batchId: string; physicalCount: number }>
    >();

    for (const p of products) {
      const bId = String(p.branchId);
      const arr = groupedByBranch.get(bId) || [];
      for (const b of p.batches) {
        const counted =
          stockTakeCounts[b.id] !== undefined ? stockTakeCounts[b.id] : b.cachedQuantity;
        arr.push({
          productId: p.id,
          batchId: b.id,
          physicalCount: Number(counted),
        });
      }
      groupedByBranch.set(bId, arr);
    }

    const allVariances: NonNullable<typeof varianceResults> = [];
    for (const [bId, entries] of groupedByBranch.entries()) {
      const report = await performOfflineStockTake({
        branchId: bId,
        userId: user.id,
        reason: 'Periodic Physical Stock Count',
        entries,
      });
      allVariances.push(...report.varianceReport);
    }

    setVarianceResults(allVariances);
    await loadLocalInventory();
    triggerToast('Stock take reconciled against ledger.');
  };

  const toggleTargetSpecies = (sp: SpeciesType) => {
    setNewProduct((prev) => ({
      ...prev,
      targetSpecies: prev.targetSpecies.includes(sp)
        ? prev.targetSpecies.filter((item) => item !== sp)
        : [...prev.targetSpecies, sp],
    }));
  };

  const formatBranchCode = (bId: string) => {
    const found = Object.values(BAXNAANO_BRANCHES).find(
      (b) => b.id === bId || b.code === bId
    );
    return found ? `${found.code} (${found.location})` : bId;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6">
      {/* Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg font-medium">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-7 h-7 text-emerald-600" />
            {t('inventory.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {activeBranchId === 'ALL'
              ? t('branch.all_branches')
              : `${currentBranchMeta.code} - ${currentBranchMeta.name} (${currentBranchMeta.location})`}
          </p>
        </div>

        {canPerform('inventory:write') && (
          <button
            onClick={() => setShowAddProductModal(true)}
            className="min-h-[48px] px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
          >
            <Plus className="w-5 h-5" />
            {t('inventory.actions.add_product')}
          </button>
        )}
      </div>

      {/* Navigation Tabs (Large Mobile-First Touch Targets) */}
      <div className="flex overflow-x-auto gap-2 pb-3 mb-6 border-b border-slate-200 dark:border-slate-800">
        {(
          [
            { id: 'products', icon: Package, label: t('inventory.tabs.products') },
            { id: 'stock_in', icon: Truck, label: t('inventory.tabs.stock_in') },
            { id: 'adjustments', icon: AlertTriangle, label: t('inventory.tabs.adjustments') },
            ...(user?.role !== 'VET_OFFICER'
              ? [{ id: 'transfers' as const, icon: ArrowLeftRight, label: t('inventory.tabs.transfers') }]
              : []),
            { id: 'stock_take', icon: ClipboardCheck, label: t('inventory.tabs.stock_take') },
            { id: 'ledger', icon: History, label: t('inventory.tabs.ledger') },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[48px] px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 whitespace-nowrap transition ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: PRODUCTS & FEFO BATCHES */}
      {activeTab === 'products' && (
        <div>
          <div className="relative mb-4">
            <Search className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`${t('inventory.fields.name')}, ${t('inventory.fields.sku')}, ${t('inventory.fields.barcode')}...`}
              className="w-full min-h-[48px] pl-12 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-md">
                        {String(p.sku)}
                      </span>
                      <h3 className="text-lg font-bold">{String(p.name)}</h3>

                      {/* Pharmacy Badges */}
                      {Boolean(p.isPrescriptionOnly) && (
                        <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 px-2.5 py-1 rounded-full font-semibold flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" />
                          {t('inventory.badges.rx_only')}
                        </span>
                      )}

                      {/* Veterinary Cold Chain Badge */}
                      {Boolean(p.isColdChainRequired) && (
                        <span className="text-xs bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 px-2.5 py-1 rounded-full font-semibold flex items-center gap-1">
                          <Snowflake className="w-3.5 h-3.5" />
                          {t('inventory.badges.cold_chain')}
                        </span>
                      )}

                      {/* Low Stock Alert */}
                      {p.isLowStock && (
                        <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2.5 py-1 rounded-full font-semibold">
                          {t('inventory.badges.low_stock')}
                        </span>
                      )}
                    </div>

                    {/* Clinical Sub-Metadata (Pharmacy vs Vet) */}
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-4">
                      {p.genericName && (
                        <span>
                          {t('inventory.fields.generic_name')}:{' '}
                          <strong>{String(p.genericName)}</strong> ({String(p.dosageForm || '')}{' '}
                          {String(p.strength || '')})
                        </span>
                      )}
                      {Array.isArray(p.targetSpecies) && p.targetSpecies.length > 0 && (
                        <span>
                          {t('inventory.fields.target_species')}:{' '}
                          <strong>
                            {p.targetSpecies
                              .map((sp: string) => t(`inventory.species.${sp}`))
                              .join(', ')}
                          </strong>
                        </span>
                      )}
                      {p.dosePerKg && (
                        <span>
                          {t('inventory.fields.dose_per_kg')}: <strong>{String(p.dosePerKg)}</strong>
                        </span>
                      )}
                      {Number(p.withdrawalPeriodDays) > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          {t('inventory.fields.withdrawal_days')}: {Number(p.withdrawalPeriodDays)}d
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stock & Price Summary */}
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{t('inventory.fields.sell_price')}</div>
                      <div className="text-lg font-bold text-emerald-600">
                        ${Number(p.sellPriceUsd).toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">
                        {t('inventory.fields.sellable_stock')}
                      </div>
                      <div className="text-xl font-extrabold">{p.sellableStock}</div>
                    </div>
                    {p.expiredStock > 0 && (
                      <div className="text-right text-red-600">
                        <div className="text-xs font-semibold flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          {t('inventory.fields.expired_stock')}
                        </div>
                        <div className="text-lg font-bold">{p.expiredStock}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* FEFO Batch Strip */}
                {p.batches.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap gap-2">
                    {p.batches.map((b) => {
                      const badgeColors: Record<string, string> = {
                        EXPIRED: 'bg-red-100 text-red-800 border-red-300 line-through',
                        DAYS_30: 'bg-orange-100 text-orange-800 border-orange-300',
                        DAYS_60: 'bg-amber-100 text-amber-800 border-amber-300',
                        DAYS_90: 'bg-yellow-50 text-yellow-800 border-yellow-300',
                        SAFE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                      };
                      return (
                        <div
                          key={b.id}
                          className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
                            badgeColors[b.expiryBucket] || ''
                          }`}
                        >
                          <span className="font-mono font-bold">#{String(b.batchNumber)}</span>
                          <span>Qty: {b.cachedQuantity}</span>
                          <span>Exp: {String(b.expiryDate).slice(0, 10)}</span>
                          {b.expiryBucket === 'EXPIRED' && (
                            <span className="font-bold uppercase">
                              [{t('inventory.badges.expired_blocked')}]
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: STOCK IN (PURCHASES & SUPPLIERS) */}
      {activeTab === 'stock_in' && (
        <form
          onSubmit={handleReceivePurchase}
          className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 max-w-2xl space-y-4"
        >
          <h2 className="text-lg font-bold">{t('inventory.actions.receive_stock')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Invoice #</label>
              <input
                required
                value={purchaseForm.invoiceNumber}
                onChange={(e) =>
                  setPurchaseForm({ ...purchaseForm, invoiceNumber: e.target.value })
                }
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('inventory.fields.name')}
              </label>
              <select
                required
                value={purchaseForm.productId}
                onChange={(e) => {
                  const pId = e.target.value;
                  const found = products.find((item) => item.id === pId);
                  setPurchaseForm({
                    ...purchaseForm,
                    productId: pId,
                    buyPriceUsd: found ? Number(found.buyPriceUsd) : purchaseForm.buyPriceUsd,
                    sellPriceUsd: found ? Number(found.sellPriceUsd) : purchaseForm.sellPriceUsd,
                  });
                }}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              >
                <option value="">-- Select Product --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {String(p.name)} ({String(p.sku)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('inventory.fields.batch_number')}
              </label>
              <input
                required
                value={purchaseForm.batchNumber}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, batchNumber: e.target.value })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('inventory.fields.expiry_date')}
              </label>
              <input
                type="date"
                required
                value={purchaseForm.expiryDate}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, expiryDate: e.target.value })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <NumericInput
                min={1}
                fallbackOnBlur={1}
                required
                value={purchaseForm.quantity}
                onChange={(val) => setPurchaseForm({ ...purchaseForm, quantity: val })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('inventory.fields.buy_price')} (USD)
              </label>
              <NumericInput
                step="0.01"
                placeholder="0.00"
                required
                value={purchaseForm.buyPriceUsd}
                onChange={(val) => setPurchaseForm({ ...purchaseForm, buyPriceUsd: val })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('inventory.fields.sell_price')} (USD)
              </label>
              <NumericInput
                step="0.01"
                placeholder="0.00"
                required
                value={purchaseForm.sellPriceUsd}
                onChange={(val) => setPurchaseForm({ ...purchaseForm, sellPriceUsd: val })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
          </div>
          <button
            type="submit"
            className="min-h-[48px] px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl"
          >
            {t('inventory.actions.receive_stock')}
          </button>
        </form>
      )}

      {/* TAB 3: ADJUSTMENTS & DAMAGES */}
      {activeTab === 'adjustments' && (
        <form
          onSubmit={handleRecordAdjustment}
          className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 max-w-xl space-y-4"
        >
          <h2 className="text-lg font-bold">{t('inventory.actions.record_adjustment')}</h2>
          <div>
            <label className="block text-sm font-medium mb-1">{t('inventory.fields.name')}</label>
            <select
              required
              value={adjustmentForm.productId}
              onChange={(e) =>
                setAdjustmentForm({ ...adjustmentForm, productId: e.target.value, batchId: '' })
              }
              className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
            >
              <option value="">-- Select Product --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {String(p.name)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('inventory.fields.batch_number')}
            </label>
            <select
              required
              value={adjustmentForm.batchId}
              onChange={(e) => setAdjustmentForm({ ...adjustmentForm, batchId: e.target.value })}
              className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
            >
              <option value="">-- Select Batch --</option>
              {products
                .find((p) => p.id === adjustmentForm.productId)
                ?.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{String(b.batchNumber)} (Qty: {b.cachedQuantity})
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Adjustment Type</label>
              <select
                value={adjustmentForm.type}
                onChange={(e) =>
                  setAdjustmentForm({
                    ...adjustmentForm,
                    type: e.target.value as typeof adjustmentForm.type,
                  })
                }
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              >
                <option value="DAMAGE_EXPIRED">Damage / Expired Write-Off (-)</option>
                <option value="ADJUSTMENT_MINUS">Stock Deduction (-)</option>
                <option value="ADJUSTMENT_PLUS">Positive Found Stock (+)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <NumericInput
                min={1}
                fallbackOnBlur={1}
                required
                value={adjustmentForm.quantity}
                onChange={(val) => setAdjustmentForm({ ...adjustmentForm, quantity: val })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Audit Reason</label>
            <input
              required
              value={adjustmentForm.reason}
              onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })}
              placeholder="e.g., Broken vial during farm transit"
              className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
            />
          </div>
          <button
            type="submit"
            className="min-h-[48px] px-6 py-3 bg-amber-600 text-white font-semibold rounded-xl"
          >
            {t('inventory.actions.record_adjustment')}
          </button>
        </form>
      )}

      {/* TAB 4: INTER-BRANCH STOCK TRANSFERS (B1 <-> B2 <-> B3) */}
      {activeTab === 'transfers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateTransfer}
            className="lg:col-span-5 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4"
          >
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-emerald-600" />
              {t('inventory.tabs.transfers')}
            </h2>

            <div>
              <label className="block text-sm font-medium mb-1">{t('inventory.fields.name')}</label>
              <select
                required
                value={transferForm.productId}
                onChange={(e) =>
                  setTransferForm({ ...transferForm, productId: e.target.value, batchId: '' })
                }
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              >
                <option value="">-- Select Product --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {String(p.name)} ({String(p.sku)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                {t('inventory.fields.batch_number')}
              </label>
              <select
                required
                value={transferForm.batchId}
                onChange={(e) => setTransferForm({ ...transferForm, batchId: e.target.value })}
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              >
                <option value="">-- Select Batch --</option>
                {products
                  .find((p) => p.id === transferForm.productId)
                  ?.batches.filter((b) => b.cachedQuantity > 0 && b.expiryBucket !== 'EXPIRED')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      #{String(b.batchNumber)} (Avail: {b.cachedQuantity})
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Destination Branch</label>
                <select
                  value={transferForm.destinationBranchId}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, destinationBranchId: e.target.value })
                  }
                  className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
                >
                  {Object.values(BAXNAANO_BRANCHES).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} - {b.name} ({b.location})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Quantity</label>
                <NumericInput
                  min={1}
                  fallbackOnBlur={1}
                  required
                  value={transferForm.quantity}
                  onChange={(val) => setTransferForm({ ...transferForm, quantity: val })}
                  className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Transfer Notes</label>
              <input
                value={transferForm.notes}
                onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                placeholder="e.g., Urgent stock replenishment"
                className="w-full min-h-[48px] px-3 py-2 rounded-xl border dark:bg-slate-900"
              />
            </div>

            <button
              type="submit"
              className="w-full min-h-[48px] px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl"
            >
              Execute Inter-Branch Transfer
            </button>
          </form>

          <div className="lg:col-span-7 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
            <h3 className="font-bold text-base">Recent Inter-Branch Transfers</h3>
            {transfers.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">
                No inter-branch transfers recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {transfers.map((trf) => (
                  <div
                    key={trf.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-sm">
                        {trf.productName} ({trf.sku}) — Batch #{trf.batchNumber}
                      </div>
                      <div className="text-slate-500 mt-0.5">
                        {formatBranchCode(trf.branchId)} →{' '}
                        <strong>{formatBranchCode(trf.destinationBranchId)}</strong> |{' '}
                        {new Date(trf.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-extrabold text-base text-emerald-600">
                        {trf.quantity} units
                      </span>
                      <div className="text-[10px] font-bold text-emerald-700 uppercase">
                        {trf.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: STOCK TAKE & VARIANCE REPORT */}
      {activeTab === 'stock_take' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{t('inventory.tabs.stock_take')}</h2>
            <button
              onClick={handleReconcileStockTake}
              className="min-h-[48px] px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl"
            >
              {t('inventory.actions.reconcile_stock_take')}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 dark:bg-slate-700">
                <tr>
                  <th className="p-3">{t('inventory.fields.name')}</th>
                  <th className="p-3">{t('inventory.fields.batch_number')}</th>
                  <th className="p-3">System Ledger Qty</th>
                  <th className="p-3">Physical Count</th>
                  <th className="p-3">Variance</th>
                </tr>
              </thead>
              <tbody>
                {products.flatMap((p) =>
                  p.batches.map((b) => {
                    const counted =
                      stockTakeCounts[b.id] !== undefined
                        ? stockTakeCounts[b.id]
                        : b.cachedQuantity;
                    const diff = counted - b.cachedQuantity;
                    return (
                      <tr key={b.id} className="border-b dark:border-slate-700">
                        <td className="p-3 font-medium">{String(p.name)}</td>
                        <td className="p-3 font-mono">#{String(b.batchNumber)}</td>
                        <td className="p-3 font-bold">{b.cachedQuantity}</td>
                        <td className="p-3">
                          <NumericInput
                            min={0}
                            showZeroAsValue
                            value={counted}
                            onChange={(val) =>
                              setStockTakeCounts({
                                ...stockTakeCounts,
                                [b.id]: val,
                              })
                            }
                            className="w-28 min-h-[42px] px-3 py-1 border rounded-lg dark:bg-slate-900"
                          />
                        </td>
                        <td
                          className={`p-3 font-bold ${
                            diff < 0
                              ? 'text-red-600'
                              : diff > 0
                              ? 'text-emerald-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {varianceResults && (
            <div className="mt-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-900">
              <h3 className="font-bold mb-2">Reconciled Variance Summary</h3>
              <p className="text-xs text-slate-500">
                Total Batches Checked: {varianceResults.length} | Discrepancies Adjusted:{' '}
                {varianceResults.filter((r) => r.variance !== 0).length}
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: IMMUTABLE STOCK MOVEMENT LEDGER */}
      {activeTab === 'ledger' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-600" />
            {t('inventory.tabs.ledger')}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 dark:bg-slate-700">
                <tr>
                  <th className="p-3">Date / Time</th>
                  <th className="p-3">Product</th>
                  <th className="p-3">Batch #</th>
                  <th className="p-3">Movement Type</th>
                  <th className="p-3">Reason / Reference</th>
                  <th className="p-3 text-right">Quantity Delta</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b dark:border-slate-700">
                    <td className="p-3 whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 font-semibold">
                      {m.productName} <span className="text-slate-400 font-mono">({m.sku})</span>
                    </td>
                    <td className="p-3 font-mono">#{m.batchNumber}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 font-mono font-bold">
                        {m.type}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500">{m.reason}</td>
                    <td
                      className={`p-3 text-right font-extrabold text-sm ${
                        m.quantityDelta >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD PRODUCT MODAL (Conditional Pharmacy B1 & Vet B2/B3 Sections) */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCreateProduct}
            className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-xl font-bold">{t('inventory.actions.add_product')}</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeBranchId === 'ALL' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">Target Branch</label>
                  <select
                    value={newProduct.branchId}
                    onChange={(e) => setNewProduct({ ...newProduct, branchId: e.target.value })}
                    className="w-full min-h-[48px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                  >
                    {Object.values(BAXNAANO_BRANCHES).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} - {b.name} ({b.location})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">{t('inventory.fields.sku')}</label>
                <input
                  required
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                  className="w-full min-h-[48px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('inventory.fields.barcode')}
                </label>
                <input
                  value={newProduct.barcode}
                  onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })}
                  className="w-full min-h-[48px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  {t('inventory.fields.name')}
                </label>
                <input
                  required
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  className="w-full min-h-[48px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('inventory.fields.buy_price')} (USD)
                </label>
                <NumericInput
                  step="0.01"
                  placeholder="0.00"
                  required
                  value={newProduct.buyPriceUsd}
                  onChange={(val) => setNewProduct({ ...newProduct, buyPriceUsd: val })}
                  className="w-full min-h-[48px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('inventory.fields.sell_price')} (USD)
                </label>
                <NumericInput
                  step="0.01"
                  placeholder="0.00"
                  required
                  value={newProduct.sellPriceUsd}
                  onChange={(val) => setNewProduct({ ...newProduct, sellPriceUsd: val })}
                  className="w-full min-h-[48px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
            </div>

            {/* Pharmacy Specific Section (B1 Human Health) */}
            {isPharmacyBranch && (
              <div className="p-4 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 space-y-3">
                <h3 className="font-bold text-purple-900 dark:text-purple-300">
                  {t('inventory.fields.pharmacy_section')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    placeholder={t('inventory.fields.generic_name')}
                    value={newProduct.genericName}
                    onChange={(e) => setNewProduct({ ...newProduct, genericName: e.target.value })}
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                  <input
                    placeholder={t('inventory.fields.dosage_form')}
                    value={newProduct.dosageForm}
                    onChange={(e) => setNewProduct({ ...newProduct, dosageForm: e.target.value })}
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                  <input
                    placeholder={t('inventory.fields.strength')}
                    value={newProduct.strength}
                    onChange={(e) => setNewProduct({ ...newProduct, strength: e.target.value })}
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={newProduct.isPrescriptionOnly}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, isPrescriptionOnly: e.target.checked })
                    }
                    className="w-5 h-5"
                  />
                  {t('inventory.fields.prescription_only')}
                </label>
              </div>
            )}

            {/* Veterinary Specific Section (B2 Arabsiyo & B3 Gabiley Livestock Health) */}
            {isVetBranch && (
              <div className="p-4 rounded-xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 space-y-3">
                <h3 className="font-bold text-sky-900 dark:text-sky-300">
                  {t('inventory.fields.vet_section')}
                </h3>
                <div>
                  <span className="block text-xs font-semibold mb-1.5">
                    {t('inventory.fields.target_species')}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {SPECIES_ENUM.filter((s) => s !== 'HUMAN').map((sp) => (
                      <button
                        type="button"
                        key={sp}
                        onClick={() => toggleTargetSpecies(sp)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                          newProduct.targetSpecies.includes(sp)
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white dark:bg-slate-900 border-slate-300'
                        }`}
                      >
                        {t(`inventory.species.${sp}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    placeholder={t('inventory.fields.dose_per_kg')}
                    value={newProduct.dosePerKg}
                    onChange={(e) => setNewProduct({ ...newProduct, dosePerKg: e.target.value })}
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                  <NumericInput
                    min={0}
                    placeholder={t('inventory.fields.withdrawal_days')}
                    value={newProduct.withdrawalPeriodDays}
                    onChange={(val) =>
                      setNewProduct({
                        ...newProduct,
                        withdrawalPeriodDays: val,
                      })
                    }
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={newProduct.isColdChainRequired}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, isColdChainRequired: e.target.checked })
                    }
                    className="w-5 h-5"
                  />
                  {t('inventory.fields.cold_chain')}
                </label>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="min-h-[48px] px-5 py-2.5 rounded-xl border"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[48px] px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold"
              >
                Save Product
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
