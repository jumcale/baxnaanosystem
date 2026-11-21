import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { AppShellLayout } from './components/AppShellLayout';
import { ProtectedModule } from './components/ProtectedModule';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import './i18n';

// Lazy-loaded route modules for fast initial bundle download & instant first paint
const SalesPointPage = lazy(() =>
  import('./pages/SalesPointPage').then((m) => ({ default: m.SalesPointPage }))
);
const QuotationsPage = lazy(() =>
  import('./pages/QuotationsPage').then((m) => ({ default: m.QuotationsPage }))
);
const SalesHistoryPage = lazy(() =>
  import('./pages/SalesHistoryPage').then((m) => ({ default: m.SalesHistoryPage }))
);
const ExpensesPage = lazy(() =>
  import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage }))
);
const InventoryPage = lazy(() =>
  import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const AppointmentsPage = lazy(() =>
  import('./pages/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage }))
);
const CreditRecordsPage = lazy(() =>
  import('./pages/CreditRecordsPage').then((m) => ({ default: m.CreditRecordsPage }))
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

const RouteContentFallback: React.FC = () => (
  <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-4 animate-pulse">
    <div className="h-16 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
      <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
      <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
      <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
    </div>
    <div className="h-64 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
  </div>
);

const RoleDefaultHome: React.FC = () => {
  const { user, canViewModule } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (canViewModule('DASHBOARD')) return <DashboardPage />;
  if (canViewModule('SALES_POINT')) return <Navigate to="/pos" replace />;
  if (canViewModule('INVENTORY')) return <Navigate to="/inventory" replace />;
  return <Navigate to="/login" replace />;
};

export const App: React.FC = () => {
  return (
    <GlobalErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteContentFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <ProtectedModule>
                    <AppShellLayout />
                  </ProtectedModule>
                }
              >
                <Route index element={<RoleDefaultHome />} />
                <Route
                  path="pos"
                  element={
                    <ProtectedModule module="SALES_POINT">
                      <Suspense fallback={<RouteContentFallback />}>
                        <SalesPointPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="quotations"
                  element={
                    <ProtectedModule module="QUOTATIONS">
                      <Suspense fallback={<RouteContentFallback />}>
                        <QuotationsPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="sales-history"
                  element={
                    <ProtectedModule module="SALES_HISTORY">
                      <Suspense fallback={<RouteContentFallback />}>
                        <SalesHistoryPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="expenses"
                  element={
                    <ProtectedModule module="EXPENSES">
                      <Suspense fallback={<RouteContentFallback />}>
                        <ExpensesPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="inventory"
                  element={
                    <ProtectedModule module="INVENTORY">
                      <Suspense fallback={<RouteContentFallback />}>
                        <InventoryPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="appointments"
                  element={
                    <ProtectedModule module="APPOINTMENTS">
                      <Suspense fallback={<RouteContentFallback />}>
                        <AppointmentsPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="credit"
                  element={
                    <ProtectedModule module="CREDIT_RECORDS">
                      <Suspense fallback={<RouteContentFallback />}>
                        <CreditRecordsPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <ProtectedModule module="REPORTS">
                      <Suspense fallback={<RouteContentFallback />}>
                        <ReportsPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <ProtectedModule module="SETTINGS">
                      <Suspense fallback={<RouteContentFallback />}>
                        <SettingsPage />
                      </Suspense>
                    </ProtectedModule>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </GlobalErrorBoundary>
  );
};
export default App;
