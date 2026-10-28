import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AuthenticatedUser,
  BAXNAANO_BRANCHES,
  ROLE_PERMISSIONS,
  RoleName,
} from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';

const OFFLINE_DEMO_PROFILES: Record<
  string,
  Omit<AuthenticatedUser, 'permissions'>
> = {
  admin: {
    id: 'user-admin-global',
    username: 'admin',
    fullName: 'Guudmare Baxnaano (Global Admin)',
    role: 'ADMIN',
    branchId: null,
    branchCode: null,
    branchType: null,
    language: 'en',
  },
  manager_b1: {
    id: 'user-manager-b1',
    username: 'manager_b1',
    fullName: 'Axmed Cali (B1 Pharmacy Manager - Arabsiyo)',
    role: 'BRANCH_MANAGER',
    branchId: BAXNAANO_BRANCHES.B1.id,
    branchCode: 'B1',
    branchType: 'PHARMACY',
    language: 'en',
  },
  vet_b2: {
    id: 'user-vet-b2',
    username: 'vet_b2',
    fullName: 'Dr. Cabdi Warsame (B2 Vet Officer - Arabsiyo)',
    role: 'VET_OFFICER',
    branchId: BAXNAANO_BRANCHES.B2.id,
    branchCode: 'B2',
    branchType: 'VETERINARY',
    language: 'en',
  },
  vet_b3: {
    id: 'user-vet-b3',
    username: 'vet_b3',
    fullName: 'Dr. Faysal Jaamac (B3 Vet Officer - Gabiley)',
    role: 'VET_OFFICER',
    branchId: BAXNAANO_BRANCHES.B3.id,
    branchCode: 'B3',
    branchType: 'VETERINARY',
    language: 'en',
  },
};

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const apiBase =
      import.meta.env.VITE_API_URL ||
      (typeof window !== 'undefined' && window.location.port !== '5173'
        ? `${window.location.origin}/api`
        : 'http://localhost:4000/api');
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const data = await res.json();
        login(data.accessToken, data.user);
        navigate('/');
        return;
      }
    } catch {
      // Offline fallback to cached/seeded profile
    }

    const profile = OFFLINE_DEMO_PROFILES[username.toLowerCase()];
    if (profile && password === 'Password123!') {
      const authUser: AuthenticatedUser = {
        ...profile,
        permissions: ROLE_PERMISSIONS[profile.role as RoleName],
      };
      login('offline-local-jwt-token', authUser);
      navigate('/');
      return;
    }

    setError(t('auth.errors.invalid_credentials'));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl p-6 md:p-8 max-w-md w-full space-y-6 shadow-2xl">
        <div className="text-center space-y-2">
          <img
            src="/baxnaano-logo.jpg"
            alt="Baxnaano Logo"
            className="w-20 h-20 rounded-full object-cover mx-auto border-2 border-emerald-500/50 shadow-lg"
          />
          <h1 className="text-2xl font-extrabold">{t('app.title')}</h1>
          <p className="text-xs text-slate-400">{t('app.subtitle')}</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-600/30 border border-red-500 text-xs font-semibold text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              {t('auth.username')}
            </label>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              {t('auth.password')}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
            />
          </div>

          <button
            type="submit"
            className="w-full min-h-[52px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition"
          >
            {t('auth.sign_in')}
          </button>
        </form>

        {/* Quick Role Switcher Buttons for Testing RBAC & Branch Isolation */}
        <div className="pt-4 border-t border-slate-700 space-y-2">
          <div className="text-[11px] text-slate-400 font-semibold">
            Quick Role Accounts (Password: Password123!):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(OFFLINE_DEMO_PROFILES).map((uKey) => (
              <button
                key={uKey}
                type="button"
                onClick={() => {
                  setUsername(uKey);
                  setPassword('Password123!');
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 font-mono"
              >
                {uKey}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
