import React from 'react';
import { Navigate } from 'react-router-dom';
import { AppModule, Permission } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';

interface ProtectedModuleProps {
  module?: AppModule;
  permission?: Permission;
  children: React.ReactNode;
}

/**
 * UI RBAC Guard: Hides / blocks unauthorized routes or UI actions per user role
 */
export const ProtectedModule: React.FC<ProtectedModuleProps> = ({
  module,
  permission,
  children,
}) => {
  const { user, canViewModule, canPerform, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-emerald-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (module && !canViewModule(module)) {
    return null;
  }

  if (permission && !canPerform(permission)) {
    return null;
  }

  return <>{children}</>;
};
