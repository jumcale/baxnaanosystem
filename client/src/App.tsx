import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { AppShellLayout } from './components/AppShellLayout';
import { ProtectedModule } from './components/ProtectedModule';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SalesPointPage } from './pages/SalesPointPage';
import { QuotationsPage } from './pages/QuotationsPage';
import { SalesHistoryPage } from './pages/SalesHistoryPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { InventoryPage } from './pages/InventoryPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { CreditRecordsPage } from './pages/CreditRecordsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import './i18n';

const RoleDefaultHome: React.FC = () => {
  const { user, canViewModule, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-emerald-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

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
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedModule><AppShellLayout /></ProtectedModule>}>
              <Route index element={<RoleDefaultHome />} />
              <Route
                path="pos"
                element={
                  <ProtectedModule module="SALES_POINT">
                    <SalesPointPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="quotations"
                element={
                  <ProtectedModule module="QUOTATIONS">
                    <QuotationsPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="sales-history"
                element={
                  <ProtectedModule module="SALES_HISTORY">
                    <SalesHistoryPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="expenses"
                element={
                  <ProtectedModule module="EXPENSES">
                    <ExpensesPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="inventory"
                element={
                  <ProtectedModule module="INVENTORY">
                    <InventoryPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="appointments"
                element={
                  <ProtectedModule module="APPOINTMENTS">
                    <AppointmentsPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="credit"
                element={
                  <ProtectedModule module="CREDIT_RECORDS">
                    <CreditRecordsPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="reports"
                element={
                  <ProtectedModule module="REPORTS">
                    <ReportsPage />
                  </ProtectedModule>
                }
              />
              <Route
                path="settings"
                element={
                  <ProtectedModule module="SETTINGS">
                    <SettingsPage />
                  </ProtectedModule>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </GlobalErrorBoundary>
  );
};
export default App;
