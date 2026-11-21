import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, KeyRound, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  API_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  checkServerHealth,
  fetchWithTimeout,
} from '../api/client';
import { AuthenticatedUser } from '@baxnaano/shared';

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forced password reset state
  const [pendingResetUser, setPendingResetUser] = useState<{
    token: string;
    user: AuthenticatedUser;
    currentPass: string;
  } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Send a lightweight background /health wake-up ping as soon as LoginPage renders
  useEffect(() => {
    checkServerHealth().catch(() => {});
  }, []);

  const performLogin = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/auth/login`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        },
        DEFAULT_REQUEST_TIMEOUT_MS
      );

      if (res.ok) {
        const data = await res.json();
        if (data.user?.mustChangePassword) {
          setPendingResetUser({
            token: data.accessToken,
            user: data.user,
            currentPass: password,
          });
          return;
        }

        login(data.accessToken, data.user);
        navigate('/');
        return;
      }

      if (res.status === 401 || res.status === 400) {
        setError(t('auth.errors.invalid_credentials'));
      } else if (res.status === 429) {
        setError('Too many login attempts. Please wait 15 minutes before trying again.');
      } else if (res.status === 503) {
        setError(
          'Server-ka wuu shaqaynayaa, laakiin database-ka wali wuu kacayaa (503). Fadlan taabo Retry.'
        );
      } else {
        setError(`Server error (${res.status}). Please click Retry.`);
      }
    } catch (err: any) {
      if (err?.isTimeout || err?.code === 'REQUEST_TIMEOUT') {
        setError(
          'Sign-in timed out after 10 seconds (server waking up from sleep). Please click Retry.'
        );
      } else {
        setError(
          'Server-ka lama gaari karo / Central server is unreachable. Please check your internet connection and click Retry.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin();
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long / Furaha sirta ah waa inuu ugu yaraan 8 xaraf noqdaa.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match / Furayaashu isma leka.');
      return;
    }

    if (!pendingResetUser) return;

    setIsLoading(true);
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/auth/change-password`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pendingResetUser.token}`,
          },
          body: JSON.stringify({
            currentPassword: pendingResetUser.currentPass,
            newPassword,
          }),
        },
        DEFAULT_REQUEST_TIMEOUT_MS
      );

      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const updatedUser = body.user || { ...pendingResetUser.user, mustChangePassword: false };
        const freshToken = body.accessToken || pendingResetUser.token;
        login(freshToken, updatedUser);
        navigate('/');
        return;
      }

      const body = await res.json().catch(() => ({}));
      setError(body.message || 'Failed to update password. Please try again.');
    } catch (err: any) {
      setError(
        err?.isTimeout
          ? 'Request timed out after 10 seconds. Please click Retry.'
          : 'Connection error while updating password.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (pendingResetUser) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-3xl p-6 md:p-8 max-w-md w-full space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mx-auto border border-amber-500/40">
              <KeyRound className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold">Password Reset Required</h1>
            <p className="text-xs text-slate-400">
              Please choose a new permanent password to secure your account.
              <br />
              (Waa in aad dejisaa fure cusub oo sugan)
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-600/30 border border-red-500 text-xs font-semibold text-center">
              {error}
            </div>
          )}

          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                New Password / Furaha Cusub (Min 8 chars)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Confirm New Password / Xaqiiji Furaha
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full min-h-[52px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Updating...</span>
                </>
              ) : (
                'Set New Password & Proceed'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          <div className="p-3.5 rounded-xl bg-red-600/25 border border-red-500/80 text-xs font-semibold text-center space-y-2.5">
            <div>{error}</div>
            {username && password && (
              <button
                type="button"
                onClick={performLogin}
                disabled={isLoading}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs inline-flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Retry Sign In</span>
              </button>
            )}
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
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[48px] pl-4 pr-12 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-slate-400 hover:text-emerald-400"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full min-h-[52px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Signing in (10s timeout)...</span>
              </>
            ) : (
              t('auth.sign_in')
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
