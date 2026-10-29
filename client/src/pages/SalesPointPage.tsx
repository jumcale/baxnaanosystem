import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShoppingCart,
  Search,
  Barcode,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Snowflake,
  FileText,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import {
  PAYMENT_METHODS,
  PaymentMethodType,
  CurrencyType,
  normalizePaymentToUsd,
  usdToSlsh,
  allocateStockFEFO,
  BAXNAANO_BRANCHES,
} from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import {
  inventoryApi,
  salesApi,
  creditApi,
  settingsApi,
  ServerProductWithFEFO,
  ReceiptData,
  formatServerSaleToReceipt,
} from '../api';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';
import { NumericInput } from '../components/NumericInput';

interface CartItem {
  productId: string;
  branchId: string;
  name: string;
  sku: string;
  unitPriceUsd: number;
  quantity: number;
  maxSellableStock: number;
  discountUsd: number;
  dosageNote: string;
  nextFefoBatchNumber: string;
  nextFefoExpiry: string;
  isColdChainRequired: boolean;
  isPrescriptionOnly: boolean;
  withdrawalPeriodDays: number | null;
}

interface SplitPaymentRow {
  id: string;
  method: PaymentMethodType;
  currency: CurrencyType;
  amountOriginal: number;
  referencePhone: string;
}

export const SalesPointPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId, setActiveBranchId } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const productsTopRef = useRef<HTMLDivElement>(null);
  const cartSectionRef = useRef<HTMLFormElement>(null);

  const [products, setProducts] = useState<ServerProductWithFEFO[]>([]);
  const [customers, setCustomers] = useState<Array<any>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number>(10000);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [orderDiscountUsd, setOrderDiscountUsd] = useState<number>(0);
  const [prescriptionRef, setPrescriptionRef] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [payments, setPayments] = useState<SplitPaymentRow[]>([
    {
      id: 'pay-1',
      method: 'CASH',
      currency: 'USD',
      amountOriginal: 0,
      referencePhone: '',
    },
  ]);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<ReceiptData | null>(null);

  const loadPosCatalog = async () => {
    try {
      const [prodList, custList, branches] = await Promise.all([
        inventoryApi.getProducts(activeBranchId),
        creditApi.getCustomers(activeBranchId),
        settingsApi.getBranches(),
      ]);
      setProducts(prodList);
      setCustomers(custList);

      const targetBranch = branches.find(
        (b) => b.id === activeBranchId || b.code === activeBranchId
      ) || branches[0];
      if (targetBranch) {
        if (targetBranch.exchangeRate) setExchangeRate(targetBranch.exchangeRate);
        if (targetBranch.taxRate !== undefined) setTaxRate(targetBranch.taxRate);
      }
    } catch (err: any) {
      console.error('POS Catalog load error:', err);
      setErrorBanner(
        err?.message || 'Server connection error. Unable to load products from database.'
      );
    }
  };

  useEffect(() => {
    loadPosCatalog();
    const onFocus = () => loadPosCatalog();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeBranchId]);

  const handleExchangeRateChange = async (nextVal: number) => {
    if (nextVal > 0) {
      setExchangeRate(nextVal);
      if (activeBranchId && activeBranchId !== 'ALL') {
        try {
          await settingsApi.updateBranchSettings(activeBranchId, { exchangeRate: nextVal });
        } catch {
          // ignore error
        }
      }
    }
  };

  const effectiveRate = exchangeRate > 0 ? exchangeRate : 10000;

  // Fast Search & Barcode Exact Match Listener
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(q) ||
        String(p.sku).toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase() === q ||
        String(p.genericName || '').toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const addToCart = (product: (typeof products)[number]) => {
    setErrorBanner(null);

    // Block if only expired batches or 0 sellable stock
    if (product.sellableStock <= 0) {
      if (product.expiredStock > 0) {
        setErrorBanner(t('pos.errors.expired_blocked'));
      } else {
        setErrorBanner(t('pos.errors.insufficient_stock'));
      }
      return;
    }

    setCart((prev) => {
      if (
        activeBranchId === 'ALL' &&
        prev.length > 0 &&
        prev[0].branchId !== String(product.branchId)
      ) {
        setErrorBanner(t('branch.errors.select_specific_branch_for_write'));
        return prev;
      }

      const existing = prev.find((item) => item.productId === product.id);
      const nextQty = existing ? existing.quantity + 1 : 1;

      // Verify FEFO allocation across non-expired batches
      const fefoCheck = allocateStockFEFO(
        product.batches.map((b) => ({
          id: b.id,
          batchNumber: String(b.batchNumber),
          expiryDate: String(b.expiryDate),
          availableQuantity: b.cachedQuantity,
          buyPriceUsd: Number(b.buyPriceUsd),
          sellPriceUsd: Number(b.sellPriceUsd),
        })),
        nextQty
      );

      if (!fefoCheck.success) {
        setErrorBanner(t('pos.errors.insufficient_stock'));
        return prev;
      }

      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, quantity: nextQty } : item
        );
      }

      return [
        ...prev,
        {
          productId: product.id,
          branchId: String(product.branchId),
          name: String(product.name),
          sku: String(product.sku),
          unitPriceUsd: Number(product.sellPriceUsd),
          quantity: 1,
          maxSellableStock: product.sellableStock,
          discountUsd: 0,
          dosageNote: product.dosePerKg ? `Dose: ${String(product.dosePerKg)}` : '',
          nextFefoBatchNumber: product.nextFefoBatch?.batchNumber || 'FEFO',
          nextFefoExpiry: product.nextFefoBatch?.expiryDate?.slice(0, 10) || '',
          isColdChainRequired: Boolean(product.isColdChainRequired),
          isPrescriptionOnly: Boolean(product.isPrescriptionOnly),
          withdrawalPeriodDays: product.withdrawalPeriodDays
            ? Number(product.withdrawalPeriodDays)
            : null,
        },
      ];
    });
  };

  // Handle Barcode Enter key in search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      const q = searchQuery.trim().toLowerCase();
      const exactMatch = products.find(
        (p) =>
          String(p.barcode || '').toLowerCase() === q ||
          String(p.sku).toLowerCase() === q
      );
      if (exactMatch) {
        addToCart(exactMatch);
        setSearchQuery('');
      } else if (filteredProducts.length === 1) {
        addToCart(filteredProducts[0]);
        setSearchQuery('');
      }
    }
  };

  const updateCartQuantity = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.productId !== productId) return item;
        if (nextQty > item.maxSellableStock) {
          setErrorBanner(t('pos.errors.insufficient_stock'));
          return item;
        }
        return { ...item, quantity: nextQty };
      })
    );
  };

  // Totals Calculation
  const subtotalUsd = useMemo(
    () =>
      Number(
        cart.reduce((sum, item) => sum + item.quantity * item.unitPriceUsd, 0).toFixed(2)
      ),
    [cart]
  );

  const lineDiscountsUsd = useMemo(
    () => Number(cart.reduce((sum, item) => sum + item.discountUsd, 0).toFixed(2)),
    [cart]
  );

  const totalDiscountUsd = Number((lineDiscountsUsd + orderDiscountUsd).toFixed(2));
  const netBeforeTaxUsd = Math.max(0, subtotalUsd - totalDiscountUsd);
  const computedTaxUsd = Number(((netBeforeTaxUsd * Math.max(0, taxRate)) / 100).toFixed(2));
  const totalUsd = Number((netBeforeTaxUsd + computedTaxUsd).toFixed(2));
  const totalSlsh = usdToSlsh(totalUsd, effectiveRate);

  // Sync first payment row amount when cart total changes if only 1 payment row exists
  useEffect(() => {
    if (payments.length === 1) {
      const p0 = payments[0];
      const nextAmt = p0.currency === 'USD' ? totalUsd : totalSlsh;
      setPayments([{ ...p0, amountOriginal: nextAmt }]);
    }
  }, [totalUsd, totalSlsh, effectiveRate]);

  const totalTenderedUsd = useMemo(
    () =>
      Number(
        payments
          .reduce(
            (sum, p) =>
              sum +
              normalizePaymentToUsd(Number(p.amountOriginal || 0), p.currency, effectiveRate),
            0
          )
          .toFixed(2)
      ),
    [payments, effectiveRate]
  );

  const handleAddPaymentSplit = () => {
    const remainingUsd = Math.max(0, Number((totalUsd - totalTenderedUsd).toFixed(2)));
    setPayments((prev) => [
      ...prev,
      {
        id: `pay-${Date.now()}`,
        method: 'EVC_PLUS',
        currency: 'USD',
        amountOriginal: remainingUsd,
        referencePhone: '',
      },
    ]);
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);

    if (!user || cart.length === 0 || isSubmitting) return;

    const targetBranchId =
      activeBranchId === 'ALL'
        ? cart[0]?.branchId || BAXNAANO_BRANCHES.B1.id
        : activeBranchId;

    const hasCreditPayment = payments.some((p) => p.method === 'CREDIT' && p.amountOriginal > 0);
    if (hasCreditPayment && !selectedCustomerId) {
      setErrorBanner(t('pos.errors.credit_requires_customer'));
      return;
    }

    if (totalTenderedUsd + 0.02 < totalUsd) {
      setErrorBanner(t('pos.errors.insufficient_payment'));
      return;
    }

    setIsSubmitting(true);
    try {
      const serverSale = await salesApi.createSale({
        branchId: targetBranchId,
        customerId: selectedCustomerId || undefined,
        currency: 'USD',
        exchangeRateUsed: effectiveRate,
        discountUsd: orderDiscountUsd,
        taxUsd: computedTaxUsd,
        prescriptionRef: prescriptionRef || undefined,
        items: cart.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
          unitPriceUsd: c.unitPriceUsd,
          discountUsd: c.discountUsd,
          dosageNote: c.dosageNote || undefined,
        })),
        payments: payments.map((p) => ({
          method: p.method,
          currency: p.currency,
          amountOriginal: Number(p.amountOriginal),
          referencePhone: p.referencePhone || undefined,
        })),
      });

      const receipt = formatServerSaleToReceipt(serverSale);
      setCompletedReceipt(receipt);
      await loadPosCatalog();
    } catch (err: any) {
      const msg = err?.message || 'Checkout failed. Ensure server connection is active.';
      setErrorBanner(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetNewSale = () => {
    setCart([]);
    setOrderDiscountUsd(0);
    setSelectedCustomerId('');
    setPrescriptionRef('');
    setCompletedReceipt(null);
    setPayments([
      {
        id: 'pay-1',
        method: 'CASH',
        currency: 'USD',
        amountOriginal: 0,
        referencePhone: '',
      },
    ]);
    searchInputRef.current?.focus();
  };

  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const scrollToCartSection = () => {
    cartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToProductsTop = () => {
    productsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      ref={productsTopRef}
      className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 pb-28 md:p-6 lg:pb-6"
    >
      {user?.role === 'ADMIN' && activeBranchId === 'ALL' && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-amber-900 dark:text-amber-200">
            Viewing All Branches (Consolidated). Quick filter by branch:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {Object.values(BAXNAANO_BRANCHES).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveBranchId(b.id)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
              >
                {b.code} ({b.location})
              </button>
            ))}
          </div>
        </div>
      )}

      {errorBanner && (
        <div className="mb-4 p-4 rounded-xl bg-red-600 text-white font-semibold flex items-center justify-between shadow">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile Quick Jump Bar (Products vs Cart & Checkout) */}
      <div className="lg:hidden mb-4 grid grid-cols-2 gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <button
          type="button"
          onClick={scrollToProductsTop}
          className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-[0.99]"
        >
          <Search className="w-3.5 h-3.5 text-emerald-600" />
          <span>Products ({filteredProducts.length})</span>
        </button>
        <button
          type="button"
          onClick={scrollToCartSection}
          className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.99] ${
            cartItemCount > 0
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300'
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          <span>
            {t('pos.cart_title')} ({cartItemCount}) • ${totalUsd.toFixed(2)}
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN (7 cols): Fast Search, Barcode Input & Product Touch Grid */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('pos.search_placeholder')}
                className="w-full min-h-[48px] pl-12 pr-10 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
              <Barcode className="w-5 h-5 absolute right-4 top-3.5 text-emerald-600" />
            </div>

            {/* Configurable Exchange Rate (USD <-> SLSH) */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 px-3 py-2 rounded-xl border dark:border-slate-700">
              <span className="text-xs font-semibold whitespace-nowrap">1 USD =</span>
              <NumericInput
                min={1}
                step="any"
                placeholder="10000"
                fallbackOnBlur={10000}
                value={exchangeRate}
                onChange={handleExchangeRateChange}
                className="w-24 font-bold text-sm bg-transparent border-b border-emerald-500 focus:outline-none text-center"
              />
              <span className="text-xs font-semibold">SLSH</span>
            </div>
          </div>

          {/* Product Touch Cards — Natural page scroll on mobile, inner scroll on lg+ desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:max-h-[72vh] lg:overflow-y-auto lg:pr-1">
            {filteredProducts.map((p) => {
              const isOut = p.sellableStock <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  disabled={isOut}
                  className={`text-left p-4 rounded-2xl border transition flex flex-col justify-between min-h-[120px] ${
                    isOut
                      ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900 opacity-75 cursor-not-allowed'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-500 active:scale-[0.99] shadow-sm'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-slate-500">{String(p.sku)}</span>
                      <div className="flex items-center gap-1">
                        {Boolean(p.isColdChainRequired) && (
                          <Snowflake className="w-4 h-4 text-sky-500" />
                        )}
                        {Boolean(p.isPrescriptionOnly) && (
                          <FileText className="w-4 h-4 text-purple-500" />
                        )}
                      </div>
                    </div>
                    <div className="font-bold text-base mt-1">{String(p.name)}</div>
                    {p.nextFefoBatch && (
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                        FEFO: #{p.nextFefoBatch.batchNumber} (Exp:{' '}
                        {p.nextFefoBatch.expiryDate.slice(0, 10)})
                      </div>
                    )}
                    {isOut && p.expiredStock > 0 && (
                      <div className="text-xs text-red-600 font-bold flex items-center gap-1 mt-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {t('inventory.badges.expired_blocked')} ({p.expiredStock})
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <div>
                      <span className="text-lg font-extrabold text-emerald-600">
                        ${Number(p.sellPriceUsd).toFixed(2)}
                      </span>
                      <span className="text-xs text-slate-400 ml-1.5">
                        ({usdToSlsh(Number(p.sellPriceUsd), effectiveRate).toLocaleString()} SLSH)
                      </span>
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        p.sellableStock > 0
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      Stock: {p.sellableStock}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols): Cart, Customer, Split Payments & Checkout */}
        <form
          ref={cartSectionRef}
          onSubmit={handleCheckout}
          className="scroll-mt-24 lg:col-span-5 bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col justify-between space-y-4"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b dark:border-slate-700 pb-3">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-emerald-600" />
                {t('pos.cart_title')} ({cartItemCount})
              </h2>
              <button
                type="button"
                onClick={scrollToProductsTop}
                className="lg:hidden px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-bold text-emerald-700 dark:text-emerald-300"
              >
                ↑ Products
              </button>
            </div>

            {/* Customer Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5" />
                {t('pos.customer_optional')}
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              >
                <option value="">{t('pos.walk_in_customer')}</option>
                {customers.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.name)} - {String(c.phone)} (Bal: $
                    {Number(c.currentBalanceUsd || 0).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            {/* Cart Items List — Natural page scroll on mobile, inner scroll on lg+ desktop */}
            <div className="space-y-2.5 lg:max-h-[35vh] lg:overflow-y-auto lg:pr-1">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-400">
                  {t('pos.empty_cart')}
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.productId}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-sm">{item.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Batch #{item.nextFefoBatchNumber} | ${item.unitPriceUsd.toFixed(2)} each
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(item.productId, 0)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {/* Large Touch Quantity Stepper */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(item.productId, item.quantity - 1)}
                          className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800 border flex items-center justify-center"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <NumericInput
                          min={1}
                          max={item.maxSellableStock}
                          fallbackOnBlur={1}
                          value={item.quantity}
                          onChange={(val) => {
                            if (val >= 1) updateCartQuantity(item.productId, val);
                          }}
                          className="w-14 h-10 text-center font-bold border rounded-lg dark:bg-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(item.productId, item.quantity + 1)}
                          className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800 border flex items-center justify-center"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="text-right font-bold text-emerald-600">
                        ${(item.quantity * item.unitPriceUsd - item.discountUsd).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Totals Box (Dual Currency USD & SLSH) */}
            <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span>{t('pos.subtotal')}:</span>
                <span>${subtotalUsd.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>{t('pos.discount_usd')}:</span>
                <NumericInput
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  value={orderDiscountUsd}
                  onChange={(val) => setOrderDiscountUsd(Math.max(0, val))}
                  className="w-24 px-2 py-1 text-right rounded border bg-white dark:bg-slate-900 font-semibold"
                />
              </div>
              {computedTaxUsd > 0 && (
                <div className="flex justify-between text-xs">
                  <span>Tax ({taxRate}%):</span>
                  <span>${computedTaxUsd.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-extrabold text-emerald-700 dark:text-emerald-400 pt-1 border-t border-emerald-200 dark:border-emerald-800">
                <span>{t('pos.total_usd')}:</span>
                <span>${totalUsd.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-700 dark:text-slate-300">
                <span>{t('pos.total_slsh')}:</span>
                <span>{totalSlsh.toLocaleString()} SLSH</span>
              </div>
            </div>

            {/* Split Payments Section (Cash, EVC Plus, Zaad, eDahab, Credit) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5" />
                  {t('pos.payment_section')}
                </span>
                <button
                  type="button"
                  onClick={handleAddPaymentSplit}
                  className="text-xs font-bold text-emerald-600 hover:underline"
                >
                  {t('pos.add_payment_split')}
                </button>
              </div>

              {payments.map((pay, idx) => (
                <div
                  key={pay.id}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2"
                >
                  <div className="grid grid-cols-12 gap-2">
                    <select
                      value={pay.method}
                      onChange={(e) => {
                        const updated = [...payments];
                        updated[idx].method = e.target.value as PaymentMethodType;
                        setPayments(updated);
                      }}
                      className="col-span-5 min-h-[42px] px-2 rounded-lg border text-xs font-semibold dark:bg-slate-900"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`pos.methods.${m}`)}
                        </option>
                      ))}
                    </select>

                    <select
                      value={pay.currency}
                      onChange={(e) => {
                        const nextCurr = e.target.value as CurrencyType;
                        const updated = [...payments];
                        updated[idx].currency = nextCurr;
                        updated[idx].amountOriginal =
                          nextCurr === 'USD'
                            ? Number((pay.amountOriginal / effectiveRate).toFixed(2))
                            : usdToSlsh(pay.amountOriginal, effectiveRate);
                        setPayments(updated);
                      }}
                      className="col-span-3 min-h-[42px] px-2 rounded-lg border text-xs font-bold dark:bg-slate-900"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="SLSH">SLSH</option>
                    </select>

                    <NumericInput
                      step="any"
                      placeholder="0.00"
                      value={pay.amountOriginal}
                      onChange={(val) => {
                        const updated = [...payments];
                        updated[idx].amountOriginal = val;
                        setPayments(updated);
                      }}
                      className="col-span-4 min-h-[42px] px-2 rounded-lg border text-right font-bold text-sm dark:bg-slate-900"
                    />
                  </div>

                  {['EVC_PLUS', 'ZAAD', 'EDAHAB'].includes(pay.method) && (
                    <input
                      type="text"
                      placeholder={t('pos.reference_phone')}
                      value={pay.referencePhone}
                      onChange={(e) => {
                        const updated = [...payments];
                        updated[idx].referencePhone = e.target.value;
                        setPayments(updated);
                      }}
                      className="w-full min-h-[38px] px-3 py-1 rounded-lg border text-xs dark:bg-slate-900"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={cart.length === 0 || isSubmitting}
            className="w-full min-h-[54px] bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-base rounded-xl shadow-md transition flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <span>Processing Sale with Central Server...</span>
            ) : (
              `${t('pos.complete_sale')} ($${totalUsd.toFixed(2)})`
            )}
          </button>
        </form>
      </div>

      {/* Sticky Floating Mobile Cart Bar for Instant Access to Checkout */}
      {cartItemCount > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 p-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 shadow-2xl">
          <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {cartItemCount} {cartItemCount === 1 ? 'item' : 'items'} in cart
              </div>
              <div className="text-base font-extrabold text-emerald-700 dark:text-emerald-400 truncate">
                ${totalUsd.toFixed(2)}{' '}
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  ({totalSlsh.toLocaleString()} SLSH)
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={scrollToCartSection}
              className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md flex items-center gap-2 shrink-0 active:scale-[0.98]"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>View Cart & Checkout ↓</span>
            </button>
          </div>
        </div>
      )}

      {/* Thermal 58mm / 80mm & PDF Receipt Preview Modal */}
      {completedReceipt && (
        <ReceiptPreviewModal
          receipt={completedReceipt}
          onCloseAndNewSale={resetNewSale}
        />
      )}
    </div>
  );
};
