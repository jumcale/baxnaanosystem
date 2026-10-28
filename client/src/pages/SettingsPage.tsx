import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Globe,
  Database,
  Upload,
  ShieldCheck,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import {
  exportFullOfflineDatabaseBackup,
  restoreFullOfflineDatabaseBackup,
} from '../services/reports.offline';
import {
  getSavedBranchSettingsSync,
  loadBranchSettings,
  saveBranchSettings,
} from '../services/settings.offline';
import { NumericInput } from '../components/NumericInput';

export const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, activeBranchId } = useAuth();

  const initialSettings = getSavedBranchSettingsSync(activeBranchId);

  const [exchangeRate, setExchangeRate] = useState<number>(initialSettings.exchangeRate);
  const [taxRate, setTaxRate] = useState<number>(initialSettings.taxRate);
  const [receiptHeader, setReceiptHeader] = useState<string>(initialSettings.receiptHeader);
  const [receiptFooter, setReceiptFooter] = useState<string>(initialSettings.receiptFooter);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    loadBranchSettings(activeBranchId).then((cfg) => {
      setExchangeRate(cfg.exchangeRate);
      setTaxRate(cfg.taxRate);
      setReceiptHeader(cfg.receiptHeader);
      setReceiptFooter(cfg.receiptFooter);
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
    const validRate = exchangeRate > 0 ? exchangeRate : 8500;
    const saved = await saveBranchSettings(activeBranchId, {
      exchangeRate: validRate,
      taxRate: Math.max(0, taxRate),
      receiptHeader: receiptHeader.trim() || 'Baxnaano Pharmacy & Veterinary Clinic',
      receiptFooter:
        receiptFooter.trim() || 'Thank you for choosing Baxnaano! / Mahadsanid!',
    });
    setExchangeRate(saved.exchangeRate);
    setTaxRate(saved.taxRate);
    showTemporaryBanner(
      i18n.language === 'so'
        ? `Waa la kaydiyay! Sarifka cusub: 1 USD = ${saved.exchangeRate.toLocaleString()} SLSH`
        : `Settings saved! Active Exchange Rate: 1 USD = ${saved.exchangeRate.toLocaleString()} SLSH`
    );
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await restoreFullOfflineDatabaseBackup(text);
    showTemporaryBanner('Offline database backup restored successfully.');
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

        {/* Offline Backup & Restore (Admin Only to Prevent Cross-User Data Access) */}
        {user?.role === 'ADMIN' && (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
            <h2 className="font-bold text-base flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-600" />
              {t('settings.backup_restore')}
            </h2>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={exportFullOfflineDatabaseBackup}
                className="min-h-[48px] px-4 py-2.5 bg-slate-900 text-white font-semibold rounded-xl text-sm"
              >
                {t('settings.download_backup')}
              </button>
              <label className="min-h-[48px] px-4 py-2.5 border rounded-xl font-semibold text-sm flex items-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                {t('settings.restore_backup')}
                <input
                  type="file"
                  accept="application/json"
                  onChange={handleRestoreFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

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
