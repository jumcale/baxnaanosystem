import React, { createContext, useContext, useState, useEffect } from 'react';
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

interface AuthContextValue {
  user: AuthenticatedUser | null;
  accessToken: string | null;
  /** Active branch ID ('ALL' allowed only for ADMIN) */
  activeBranchId: string;
  setActiveBranchId: (branchId: string) => void;
  login: (token: string, user: AuthenticatedUser) => void;
  logout: () => void;
  canViewModule: (mod: AppModule) => boolean;
  canPerform: (perm: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_USER_KEY = 'baxnaano_auth_user';
const STORAGE_TOKEN_KEY = 'baxnaano_access_token';
const STORAGE_BRANCH_KEY = 'baxnaano_active_branch';
const REMOVED_USERNAMES = new Set(['pharmacist_b1', 'cashier_b1']);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(() => {
    const raw = localStorage.getItem(STORAGE_USER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthenticatedUser;
      if (REMOVED_USERNAMES.has(parsed.username?.toLowerCase())) {
        localStorage.removeItem(STORAGE_USER_KEY);
        localStorage.removeItem(STORAGE_TOKEN_KEY);
        localStorage.removeItem(STORAGE_BRANCH_KEY);
        return null;
      }
      return {
        ...parsed,
        permissions: ROLE_PERMISSIONS[parsed.role] || parsed.permissions || [],
      };
    } catch {
      return null;
    }
  });

  const [accessToken, setAccessToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_TOKEN_KEY)
  );

  const [activeBranchId, setActiveBranchIdState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_BRANCH_KEY);
    if (saved) return saved;
    if (user?.role === 'ADMIN') return 'ALL';
    return user?.branchId || BAXNAANO_BRANCHES.B1.id;
  });

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
    // Non-admin users cannot switch branches
    if (user && user.role !== 'ADMIN') return;
    setActiveBranchIdState(branchId);
    localStorage.setItem(STORAGE_BRANCH_KEY, branchId);
  };

  const login = (token: string, authUser: AuthenticatedUser) => {
    setAccessToken(token);
    setUser(authUser);
    localStorage.setItem(STORAGE_TOKEN_KEY, token);
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(authUser));
    const initialBranch = authUser.role === 'ADMIN' ? 'ALL' : authUser.branchId!;
    setActiveBranchIdState(initialBranch);
    localStorage.setItem(STORAGE_BRANCH_KEY, initialBranch);
  };

  const logout = () => {
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_USER_KEY);
    localStorage.removeItem(STORAGE_BRANCH_KEY);
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
        activeBranchId,
        setActiveBranchId,
        login,
        logout,
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
