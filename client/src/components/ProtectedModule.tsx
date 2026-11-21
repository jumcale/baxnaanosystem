import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, LogIn } from 'lucide-react';
import { AppModule, Permission } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';

interface ProtectedModuleProps {
  module?: AppModule;
  permission?: Permission;
  children: React.ReactNode;
}

/**
 * UI RBAC Guard:
 * - Renders the UI shell immediately if a cached user session exists (non-blocking startup).
 * - If a cold-start or network timeout (10s) occurs before a session is established,
 *   displays a clear error screen with a "Retry Connection" button and a "Go to Sign In" button
 *   instead of an endless loading spinner.
 */
export const ProtectedModule: React.FC<ProtectedModuleProps> = ({
  module,
  permission,
  children,
}) => {
  const {
    user,
    canViewModule,
    canPerform,
    isLoading,
    isRevalidating,
    startupError,
    retrySession,
  } = useAuth();
  const navigate = useNavigate();

  // If we already have an optimistic or authenticated user, render the UI shell immediately!
  if (user) {
    if (module && !canViewModule(module)) {
      return null;
    }
    if (permission && !canPerform(permission)) {
      return null;
    }
    return <>{children}</>;
  }

  // If startup timed out after 10s or encountered a server error with no cached session, show visible error + Retry button
  if (startupError) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-3xl p-6 md:p-8 max-w-md w-full space-y-5 shadow-2xl text-center">
          <div className="w-14 h-14 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/40">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-extrabold text-white">
              Server Connection Timed Out
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              {startupError}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => retrySession()}
              disabled={isRevalidating}
              className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition"
            >
              <RefreshCw className={`w-4 h-4 ${isRevalidating ? 'animate-spin' : ''}`} />
              <span>{isRevalidating ? 'Retrying...' : 'Retry Connection'}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // First-time uncached check (bounded by 10-second AbortController timeout)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col">
        {/* Instant Top Header Skeleton */}
        <header className="h-14 border-b border-slate-800 px-4 md:px-6 flex items-center justify-between bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <img
              src="/baxnaano-logo.jpg"
              alt="Baxnaano"
              className="w-8 h-8 rounded-full object-cover border border-emerald-500/40"
            />
            <div>
              <div className="font-extrabold text-xs tracking-tight text-emerald-400">
                BAXNAANO SYSTEM
              </div>
              <div className="text-[10px] text-slate-400">
                Pharmacy & Veterinary ERP
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            Sign In Now
          </button>
        </header>

        {/* Non-blocking Shell Preview with Status & Skip/Retry Actions */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-xl">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-400 border-t-transparent mx-auto" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-white">
                Connecting to Baxnaano Server...
              </div>
              <p className="text-xs text-slate-400">
                Waking up cloud instance (10s timeout guard active).
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => retrySession()}
                className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition"
              >
                Retry Now
              </button>
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="px-3.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold transition"
              >
                Open Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <Navigate to="/login" replace />;
};
