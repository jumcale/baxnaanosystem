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
import { API_BASE, setApiAccessToken } from '../api/client';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  accessToken: string | null;
  isLoading: boolean;
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
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [activeBranchId, setActiveBranchIdState] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_BRANCH_KEY);
      if (saved) return saved;
    }
    return BAXNAANO_BRANCHES.B1.id;
  });

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // ignore network errors on logout
    } finally {
      setAccessToken(null);
      setApiAccessToken(null);
      setUser(null);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('baxnaano_access_token');
        localStorage.removeItem('baxnaano_auth_user');
        localStorage.removeItem(STORAGE_BRANCH_KEY);
      }
    }
  }, []);

  // Hydrate session on app mount via HttpOnly refresh cookie
  useEffect(() => {
    let isMounted = true;

    async function hydrateSession() {
      try {
        // Clear any old legacy tokens from localStorage for security
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('baxnaano_access_token');
          localStorage.removeItem('baxnaano_auth_user');
        }

        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });

        if (res.ok && isMounted) {
          const data = await res.json();
          setAccessToken(data.accessToken);
          setApiAccessToken(data.accessToken);
          const authUser: AuthenticatedUser = {
            ...data.user,
            permissions: ROLE_PERMISSIONS[data.user.role as keyof typeof ROLE_PERMISSIONS] || data.user.permissions || [],
          };
          setUser(authUser);
          if (authUser.role === 'ADMIN') {
            const saved = localStorage.getItem(STORAGE_BRANCH_KEY);
            setActiveBranchIdState(saved || 'ALL');
          } else if (authUser.branchId) {
            setActiveBranchIdState(authUser.branchId);
            localStorage.setItem(STORAGE_BRANCH_KEY, authUser.branchId);
          }
        } else if (isMounted) {
          setUser(null);
          setAccessToken(null);
          setApiAccessToken(null);
        }
      } catch {
        if (isMounted) {
          setUser(null);
          setAccessToken(null);
          setApiAccessToken(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    hydrateSession();

    // Global listener for 401 unauthorized
    const handleUnauthorized = () => {
      logout();
    };
    window.addEventListener('baxnaano:auth-unauthorized', handleUnauthorized);

    return () => {
      isMounted = false;
      window.removeEventListener('baxnaano:auth-unauthorized', handleUnauthorized);
    };
  }, [logout]);

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
    setAccessToken(token);
    setApiAccessToken(token);
    setUser(authUser);
    const initialBranch = authUser.role === 'ADMIN' ? 'ALL' : authUser.branchId!;
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
