import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileBarChart,
  Printer,
  Download,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  reportsApi,
  inventoryApi,
  creditApi,
  exportToExcelCsv,
  ServerProductWithFEFO,
  CustomerAging,
  DashboardAnalyticsResponse,
} from '../api';

export const ReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const { activeBranchId } = useAuth();

  const [period, setPeriod] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [products, setProducts] = useState<ServerProductWithFEFO[]>([]);
  const [customers, setCustomers] = useState<CustomerAging[]>([]);
  const [dashData, setDashData] = useState<DashboardAnalyticsResponse | null>(null);

  useEffect(() => {
    const refresh = () => {
      Promise.all([
        inventoryApi.getProducts(activeBranchId),
        creditApi.getCustomers(activeBranchId),
        reportsApi.getDashboard(activeBranchId),
      ]).then(([prods, custs, dash]) => {
        setProducts(prods);
        setCustomers(custs);
        setDashData(dash);
      }).catch((err) => {
        console.error('Reports load error:', err);
      });
    };
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeBranchId, period]);

  const stockCostValuationUsd = products.reduce(
    (sum, p) => sum + p.sellableStock * Number(p.buyPriceUsd || 0),
    0
  );
  const stockRetailValuationUsd = products.reduce(
    (sum, p) => sum + p.sellableStock * Number(p.sellPriceUsd || 0),
    0
  );

  const handleExportExcel = () => {
    const rows = products.map((p) => ({
      SKU: p.sku,
      ProductName: p.name,
      SellableStock: p.sellableStock,
      ExpiredBlockedStock: p.expiredStock,
      BuyPriceUSD: Number(p.buyPriceUsd).toFixed(2),
      SellPriceUSD: Number(p.sellPriceUsd).toFixed(2),
      StockCostValuationUSD: (p.sellableStock * Number(p.buyPriceUsd)).toFixed(2),
      EarliestExpiry: p.earliestExpiry ? String(p.earliestExpiry).slice(0, 10) : 'N/A',
    }));
    exportToExcelCsv(`Baxnaano_Report_${activeBranchId}_${period}`, rows);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      {/* Header & Export Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileBarChart className="w-7 h-7 text-emerald-600" />
          {t('reports.title')}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold ${
                period === p
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-slate-800 border'
              }`}
            >
              {t(`reports.period_${p.toLowerCase()}`)}
            </button>
          ))}

          <button
            onClick={() => window.print()}
            className="min-h-[44px] px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            {t('reports.export_pdf')}
          </button>

          <button
            onClick={handleExportExcel}
            className="min-h-[44px] px-4 py-2 bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            {t('reports.export_excel')}
          </button>
        </div>
      </div>

      {/* Profit & Loss & Stock Valuation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <h2 className="font-bold text-base">{t('reports.pnl_section')}</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Today Revenue (USD):</span>
              <strong className="text-emerald-600">
                ${dashData?.kpis.todaySalesUsd.toFixed(2) || '0.00'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Gross Profit (USD):</span>
              <strong>${dashData?.kpis.todayGrossProfitUsd.toFixed(2) || '0.00'}</strong>
            </div>
            <div className="flex justify-between">
              <span>Approved Expenses (USD):</span>
              <strong className="text-amber-600">
                -${dashData?.kpis.todayExpensesUsd.toFixed(2) || '0.00'}
              </strong>
            </div>
            <div className="flex justify-between pt-2 border-t dark:border-slate-700 text-base font-extrabold">
              <span>Net Profit (USD):</span>
              <span className="text-sky-600">
                ${dashData?.kpis.todayNetProfitUsd.toFixed(2) || '0.00'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <h2 className="font-bold text-base">{t('reports.stock_valuation')}</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Total Inventory Cost Value (Buy Price):</span>
              <strong>${stockCostValuationUsd.toFixed(2)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Total Retail Value (Sell Price):</span>
              <strong className="text-emerald-600">${stockRetailValuationUsd.toFixed(2)}</strong>
            </div>
            <div className="flex justify-between pt-2 border-t dark:border-slate-700 font-bold">
              <span>Projected Margin:</span>
              <span>${(stockRetailValuationUsd - stockCostValuationUsd).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Credit Aging & Top Movers */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h2 className="font-bold text-base">{t('reports.credit_aging')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 dark:bg-slate-700">
              <tr>
                <th className="p-2.5">Customer</th>
                <th className="p-2.5">0 - 30 Days</th>
                <th className="p-2.5">31 - 60 Days</th>
                <th className="p-2.5">60+ Days</th>
                <th className="p-2.5 text-right">Total Due (USD)</th>
              </tr>
            </thead>
            <tbody>
              {customers
                .filter((c) => c.currentBalanceUsd > 0)
                .map((c) => (
                  <tr key={c.id} className="border-b dark:border-slate-700">
                    <td className="p-2.5 font-semibold">{String(c.name)}</td>
                    <td className="p-2.5">${c.aging.bucket0to30Usd.toFixed(2)}</td>
                    <td className="p-2.5">${c.aging.bucket31to60Usd.toFixed(2)}</td>
                    <td className="p-2.5 text-red-600 font-bold">
                      ${c.aging.bucket60PlusUsd.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right font-extrabold">
                      ${c.currentBalanceUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
