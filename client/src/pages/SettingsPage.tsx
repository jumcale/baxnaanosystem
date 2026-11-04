import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Globe,
  Database,
  ShieldCheck,
  Save,
  CheckCircle2,
  Users,
  Edit3,
  UserCheck,
} from 'lucide-react';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { settingsApi, StaffUser } from '../api';
import { NumericInput } from '../components/NumericInput';

export const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, activeBranchId } = useAuth();

  const [exchangeRate, setExchangeRate] = useState<number>(10000);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [receiptHeader, setReceiptHeader] = useState<string>('Baxnaano Pharmacy & Veterinary Clinic');
  const [receiptFooter, setReceiptFooter] = useState<string>('Thank you for choosing Baxnaano! / Mahadsanid!');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Staff & Cashier Management State
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingFullName, setEditingFullName] = useState<string>('');
  const [isSavingUser, setIsSavingUser] = useState<boolean>(false);

  const loadStaff = async () => {
    if (user?.role === 'ADMIN') {
      try {
        const users = await settingsApi.getUsers();
        setStaffList(users);
      } catch (err) {
        console.error('Failed to load staff list:', err);
      }
    }
  };

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

    loadStaff();
  }, [activeBranchId, user?.role]);

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
        ...(user?.role === 'ADMIN' ? { exchangeRate: validRate } : {}),
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

  const handleStartEditUser = (u: StaffUser) => {
    setEditingUserId(u.id);
    setEditingFullName(u.fullName);
  };

  const handleSaveUserFullName = async (userId: string) => {
    if (!editingFullName.trim()) return;
    setIsSavingUser(true);
    try {
      await settingsApi.updateUser(userId, { fullName: editingFullName.trim() });
      showTemporaryBanner(
        i18n.language === 'so'
          ? `Magaca cashier-ka si guul leh ayaa loo beddelay!`
          : `Cashier name updated successfully on all receipts and invoices!`
      );
      setEditingUserId(null);
      await loadStaff();
    } catch (err: any) {
      showTemporaryBanner(err?.message || 'Failed to update user name.');
    } finally {
      setIsSavingUser(false);
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3 sm:p-6 space-y-4">
      <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2">
        <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 shrink-0" />
        <span>{t('settings.title')}</span>
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
              {user?.role === 'ADMIN' ? (
                <NumericInput
                  min={1}
                  step="any"
                  placeholder="8500"
                  fallbackOnBlur={8500}
                  value={exchangeRate}
                  onChange={(val) => setExchangeRate(val)}
                  className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900 font-bold"
                />
              ) : (
                <div className="w-full min-h-[44px] px-3 py-2 border rounded-xl bg-slate-100 dark:bg-slate-900 font-bold flex items-center justify-between text-slate-700 dark:text-slate-300">
                  <span>1 USD = {exchangeRate.toLocaleString()} SLSH</span>
                  <span className="text-[11px] text-slate-400 font-normal">Admin Only / Kaliya Maamulaha</span>
                </div>
              )}
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

        {/* Staff & Cashier Names Management (Admin Only) */}
        {user?.role === 'ADMIN' && (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600" />
                  Staff & Cashier Names Management / Maamulka Magacyada Cashiers-ka
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Change the cashier or officer name that appears on printed invoices, receipts, and reports across all branches.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="p-3">Username (Login)</th>
                    <th className="p-3">Branch / Location</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Cashier Display Name (Printed on Invoices)</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {staffList.map((s) => {
                    const isEditing = editingUserId === s.id;
                    return (
                      <tr
                        key={s.id}
                        className={`transition-colors ${
                          isEditing
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/30'
                            : 'hover:bg-slate-100/70 dark:hover:bg-slate-700/40'
                        }`}
                      >
                        <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                          {s.username}
                        </td>
                        <td className="p-3">
                          {s.branchCode ? (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                              {s.branchCode} - {s.branchLocation}
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">Central / All</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
                            {s.role}
                          </span>
                        </td>
                        <td className="p-3">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingFullName}
                              onChange={(e) => setEditingFullName(e.target.value)}
                              className="w-full min-h-[38px] px-3 py-1.5 border border-emerald-500 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
                              placeholder="e.g. Abdirashid (B1 Cashier)"
                              autoFocus
                            />
                          ) : (
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span>{s.fullName}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={isSavingUser}
                                onClick={() => handleSaveUserFullName(s.id)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-sm"
                              >
                                <Save className="w-3.5 h-3.5" />
                                {isSavingUser ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingUserId(null)}
                                className="px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEditUser(s)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold flex items-center gap-1 ml-auto transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Change Name
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
