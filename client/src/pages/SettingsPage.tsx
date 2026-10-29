import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Globe,
  Database,
  ShieldCheck,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { settingsApi } from '../api';
import { NumericInput } from '../components/NumericInput';

export const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, activeBranchId } = useAuth();

  const [exchangeRate, setExchangeRate] = useState<number>(10000);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [receiptHeader, setReceiptHeader] = useState<string>('Baxnaano Pharmacy & Veterinary Clinic');
  const [receiptFooter, setReceiptFooter] = useState<string>('Thank you for choosing Baxnaano! / Mahadsanid!');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.getBranches().then((branches) => {
      const b = branches.find((item) => item.id === activeBranchId || item.code === activeBranchId) || branches[0];
      if (b) {
        if (b.exchangeRate) setExchangeRate(b.exchangeRate);
        if (b.taxRate !== undefined) setTaxRate(b.taxRate);
        if (b.receiptHeader) setReceiptHeader(b.receiptHeader);
        if (b.receiptFooter) setReceiptFooter(b.receiptFooter);
      }
    }).catch((err) => {
      console.error('Failed to load branch settings from server:', err);
    });
  }, [activeBranchId]);

  const showTemporaryBanner = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 4000);
  };

  const switchLanguage = (lang: 'en' | 'so') => {
    i18n.changeLanguage(lang);
    localStorage.setItem('baxnaano_lang_v2', lang);
    showTemporaryBanner(
      `Language switched to ${lang === 'en' ? 'English (Primary)' : 'Af-Soomaali (Secondary)'}`
    );
  };

  const handleSaveBranchSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const validRate = exchangeRate > 0 ? exchangeRate : 10000;
    const targetBranch =
      activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId;

    try {
      const updated = await settingsApi.updateBranchSettings(targetBranch, {
        exchangeRate: validRate,
        taxRate: Math.max(0, taxRate),
        receiptHeader: receiptHeader.trim() || 'Baxnaano Pharmacy & Veterinary Clinic',
        receiptFooter: receiptFooter.trim() || 'Thank you for choosing Baxnaano! / Mahadsanid!',
      });
      setExchangeRate(updated.exchangeRate);
      setTaxRate(updated.taxRate);
      showTemporaryBanner(
        i18n.language === 'so'
          ? `Waa la kaydiyay server-ka! Sarifka cusub: 1 USD = ${updated.exchangeRate.toLocaleString()} SLSH`
          : `Server settings updated! Active Exchange Rate: 1 USD = ${updated.exchangeRate.toLocaleString()} SLSH`
      );
    } catch (err: any) {
      showTemporaryBanner(err?.message || 'Failed to save settings on central server.');
    }
  };

  const resolvedBranchLabel =
    activeBranchId === 'ALL'
      ? 'ALL BRANCHES (B1, B2, B3)'
      : (() => {
          const found = Object.values(BAXNAANO_BRANCHES).find(
            (b) => b.id === activeBranchId || b.code === activeBranchId
          );
          return found ? `${found.code} - ${found.name} (${found.location})` : activeBranchId;
        })();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Settings className="w-7 h-7 text-emerald-600" />
        {t('settings.title')}
      </h1>

      {statusBanner && (
        <div className="p-4 rounded-xl bg-emerald-600 text-white font-semibold flex items-center gap-2 shadow-md">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Language & Localization (Somali / English) */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-600" />
            {t('settings.language_switch')}
          </h2>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => switchLanguage('en')}
              className={`min-h-[48px] flex-1 rounded-xl font-bold border ${
                i18n.language === 'en'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-50 dark:bg-slate-900'
              }`}
            >
              English (Primary)
            </button>
            <button
              type="button"
              onClick={() => switchLanguage('so')}
              className={`min-h-[48px] flex-1 rounded-xl font-bold border ${
                i18n.language === 'so'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-50 dark:bg-slate-900'
              }`}
            >
              Af-Soomaali (Somali)
            </button>
          </div>
        </div>

        {/* Central Authoritative Database Status */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            Central PostgreSQL Database
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Authoritative cloud database with real-time consistency across all branches: B1 (Pharmacy Arabsiyo), B2 (Veterinary Arabsiyo), and B3 (Veterinary Gabiley). All sales, inventory, and finances persist directly to the server.
          </p>
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Online Authoritative Connection Active</span>
          </div>
        </div>

        {/* Currency, Exchange Rate & Receipt Template */}
        <form
          onSubmit={handleSaveBranchSettings}
          className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 md:col-span-2"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-bold text-base flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              {t('settings.branch_profile')} & {t('settings.currency_and_tax')}
            </h2>

            <button
              type="submit"
              className="min-h-[46px] px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
            >
              <Save className="w-4 h-4" />
              {i18n.language === 'so' ? 'Kaydi Dejinta (Save Settings)' : 'Save Settings'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">
                Active Branch Scope
              </label>
              <input
                disabled
                value={resolvedBranchLabel}
                className="w-full min-h-[44px] px-3 py-2 border rounded-xl bg-slate-100 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Default Exchange Rate (1 USD = SLSH)
              </label>
              <NumericInput
                min={1}
                step="any"
                placeholder="8500"
                fallbackOnBlur={8500}
                value={exchangeRate}
                onChange={(val) => setExchangeRate(val)}
                className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Tax Rate (%)</label>
              <NumericInput
                min={0}
                step="0.01"
                placeholder="0"
                value={taxRate}
                onChange={(val) => setTaxRate(val)}
                className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Receipt Header</label>
              <input
                value={receiptHeader}
                onChange={(e) => setReceiptHeader(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold mb-1">Receipt Footer</label>
              <input
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
            </div>
          </div>

          <div className="text-xs text-slate-400">
            Logged in as: <strong>{user?.fullName}</strong> ({user?.role})
          </div>
        </form>
      </div>
    </div>
  );
};
