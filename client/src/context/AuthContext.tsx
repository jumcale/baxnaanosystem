import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  AuthenticatedUser,
  AppModule,
  Permission,
  canAccessModule,
  hasPermission,
  BAXNAANO_BRANCHES,
  ROLE_PERMISSIONS,
} from '@baxnaano/shared';
import i18n from '../i18n';
import {
  API_BASE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  setApiAccessToken,
} from '../api/client';
import { purgeLegacyOfflineStorage } from '../lib/legacyCleanup';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isRevalidating: boolean;
  startupError: string | null;
  retrySession: () => Promise<void>;
  /** Active branch ID ('ALL' allowed only for ADMIN) */
  activeBranchId: string;
  setActiveBranchId: (branchId: string) => void;
  login: (token: string, user: AuthenticatedUser) => void;
  logout: () => Promise<void>;
  updateUser: (user: AuthenticatedUser) => void;
  canViewModule: (mod: AppModule) => boolean;
  canPerform: (perm: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_BRANCH_KEY = 'baxnaano_active_branch';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Strictly in-memory user & accessToken (never stored in localStorage or sessionStorage)
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRevalidating, setIsRevalidating] = useState<boolean>(true);
  const [startupError, setStartupError] = useState<string | null>(null);

  const [activeBranchId, setActiveBranchIdState] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_BRANCH_KEY);
      if (saved) return saved;
    }
    return BAXNAANO_BRANCHES.B1.id;
  });

  const clearAuthState = useCallback(() => {
    setAccessToken(null);
    setApiAccessToken(null);
    setUser(null);
    purgeLegacyOfflineStorage();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_BRANCH_KEY);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchWithTimeout(
        `${API_BASE}/auth/logout`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        },
        4000
      );
    } catch {
      // ignore network errors on logout
    } finally {
      clearAuthState();
      setStartupError(null);
      setIsLoading(false);
    }
  }, [clearAuthState]);

  const hydrateSession = useCallback(async () => {
    setIsRevalidating(true);
    setStartupError(null);
    setIsLoading(true);

    try {
      purgeLegacyOfflineStorage();

      const res = await fetchWithTimeout(
        `${API_BASE}/auth/refresh`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        },
        DEFAULT_REQUEST_TIMEOUT_MS
      );

      if (res.ok) {
        const data = await res.json();
        setAccessToken(data.accessToken);
        setApiAccessToken(data.accessToken);
        const authUser: AuthenticatedUser = {
          ...data.user,
          permissions:
            ROLE_PERMISSIONS[data.user.role as keyof typeof ROLE_PERMISSIONS] ||
            data.user.permissions ||
            [],
        };
        setUser(authUser);
        setStartupError(null);

        if (authUser.role === 'ADMIN') {
          const saved = localStorage.getItem(STORAGE_BRANCH_KEY);
          setActiveBranchIdState(saved || 'ALL');
        } else if (authUser.branchId) {
          setActiveBranchIdState(authUser.branchId);
          localStorage.setItem(STORAGE_BRANCH_KEY, authUser.branchId);
        }
      } else if (res.status === 401 || res.status === 403) {
        clearAuthState();
        setStartupError(null);
      } else {
        const msg =
          res.status === 503
            ? 'Server is awake, but the database is still starting up (HTTP 503). Please click Retry in a few seconds.'
            : `Server returned HTTP ${res.status} while starting up. Please click Retry.`;
        setStartupError(msg);
      }
    } catch (err: any) {
      const isTimeout = err?.isTimeout || err?.code === 'REQUEST_TIMEOUT';
      const message = isTimeout
        ? 'The server took longer than 10 seconds to respond (Render cold start). Click Retry to connect.'
        : err?.message ||
          'Unable to reach the Baxnaano server. Please check your connection and click Retry.';
      setStartupError(message);
    } finally {
      setIsLoading(false);
      setIsRevalidating(false);
    }
  }, [clearAuthState]);

  useEffect(() => {
    hydrateSession();

    const handleUnauthorized = () => {
      clearAuthState();
    };
    window.addEventListener('baxnaano:auth-unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('baxnaano:auth-unauthorized', handleUnauthorized);
    };
  }, [hydrateSession, clearAuthState]);

  useEffect(() => {
    if (user) {
      if (user.role !== 'ADMIN' && user.branchId) {
        setActiveBranchIdState(user.branchId);
        localStorage.setItem(STORAGE_BRANCH_KEY, user.branchId);
      }
      const savedLang = localStorage.getItem('baxnaano_lang_v2');
      if (savedLang === 'en' || savedLang === 'so') {
        i18n.changeLanguage(savedLang);
      } else {
        i18n.changeLanguage('en');
      }
    }
  }, [user]);

  const setActiveBranchId = (branchId: string) => {
    if (user && user.role !== 'ADMIN') return;
    setActiveBranchIdState(branchId);
    localStorage.setItem(STORAGE_BRANCH_KEY, branchId);
  };

  const login = (token: string, authUser: AuthenticatedUser) => {
    const normalizedUser: AuthenticatedUser = {
      ...authUser,
      permissions:
        ROLE_PERMISSIONS[authUser.role as keyof typeof ROLE_PERMISSIONS] ||
        authUser.permissions ||
        [],
    };
    setAccessToken(token);
    setApiAccessToken(token);
    setUser(normalizedUser);
    setStartupError(null);
    setIsLoading(false);
    const initialBranch = normalizedUser.role === 'ADMIN' ? 'ALL' : normalizedUser.branchId!;
    setActiveBranchIdState(initialBranch);
    localStorage.setItem(STORAGE_BRANCH_KEY, initialBranch);
  };

  const updateUser = (updatedUser: AuthenticatedUser) => {
    setUser(updatedUser);
  };

  const canViewModule = (mod: AppModule): boolean => {
    if (!user) return false;
    return canAccessModule(user.role, mod);
  };

  const canPerform = (perm: Permission): boolean => {
    if (!user) return false;
    return hasPermission(user.role, perm);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        isRevalidating,
        startupError,
        retrySession: hydrateSession,
        activeBranchId,
        setActiveBranchId,
        login,
        logout,
        updateUser,
        canViewModule,
        canPerform,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
