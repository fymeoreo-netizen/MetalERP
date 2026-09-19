import { lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import LandingPage from "./pages/public/LandingPage";
import NotFoundPage from "./pages/public/NotFoundPage";
import Login from "./pages/auth/Login";
import TwoFactor from "./pages/auth/TwoFactor";
import ForgotPassword from "./pages/auth/ForgotPassword";
import { InventoryProvider } from "./contexts/InventoryContext";
import { AppSessionProvider, useAppSession } from "./contexts/AppSessionContext";
import { AuthStaffLayout } from "./components/auth/RequireStaffAccess";
import { AppShell } from "./components/layout/AppShell";
import { AnimatedOutlet } from "./components/layout/AnimatedOutlet";
import { NOT_FOUND_PATH, STAFF_LOGIN_PATH } from "./lib/publicSiteConfig";
import { GlobalErrorBoundary } from "./components/error/GlobalErrorBoundary";
import { Toaster } from "./components/ui/toaster";
import { Toaster as SonnerToaster } from "./components/ui/sonner";

const DashboardRouter = lazy(() => import("./pages/dashboard/DashboardRouter"));
const Purchase = lazy(() => import("./pages/procurement/Purchase"));
const Production = lazy(() => import("./pages/production/Production"));
const EnamelProduction = lazy(() => import("./pages/production/EnamelProduction"));
const DrawingWeeklyWages = lazy(() => import("./pages/production/DrawingWeeklyWages"));
const ProductionSettings = lazy(() => import("./pages/admin/ProductionSettings"));
const ItemTypeSettings = lazy(() => import("./pages/admin/ItemTypeSettings"));
const Inventory = lazy(() => import("./pages/inventory/Inventory"));
const StockAdjustments = lazy(() => import("./pages/inventory/StockAdjustments"));
const Cashbook = lazy(() => import("./pages/financials/Cashbook"));
const JournalVoucher = lazy(() => import("./pages/financials/JournalVoucher"));
const Sales = lazy(() => import("./pages/sales/Sales"));
const Reports = lazy(() => import("./pages/reports/Reports"));
const LedgersPage = lazy(() => import("./pages/reports/LedgersPage"));
const ParchiRegister = lazy(() => import("./pages/financials/ParchiRegister"));
const PeriodCostingDashboard = lazy(() => import("./pages/financials/PeriodCostingDashboard"));
const Alerts = lazy(() => import("./pages/alerts/Alerts"));
const SystemAudit = lazy(() => import("./pages/admin/SystemAudit"));
const MarketIntelligence = lazy(() => import("./pages/market/MarketIntelligence"));
const ErpAssistant = lazy(() => import("./pages/assistant/ErpAssistant"));
const TriangleTrade = lazy(() => import("./pages/trading/TriangleTrade"));
const FactoryScrapDispatch = lazy(() => import("./pages/trading/FactoryScrapDispatch"));
const UserManagement = lazy(() => import("./pages/admin/UserManagement"));
const ChartOfAccounts = lazy(() => import("./pages/masters/ChartOfAccounts"));
const ItemMaster = lazy(() => import("./pages/masters/ItemMaster"));
const PartyMaster = lazy(() => import("./pages/masters/PartyMaster"));
const LaborRateMatrix = lazy(() => import("./pages/masters/LaborRateMatrix"));
const WattaMaster = lazy(() => import("./pages/masters/WattaMaster"));
const RateManagement = lazy(() => import("./pages/ratemanagement/RateManagement"));
const UnifiedPartyDashboard = lazy(() => import("./pages/masters/UnifiedPartyDashboard"));

function AdminLayout() {
    const { ready, userId, isAdmin } = useAppSession();
    if (!ready) return null;
    if (!userId) return <Navigate to={NOT_FOUND_PATH} replace />;
    if (!isAdmin) return <Navigate to="/dashboard" replace />;
    return <Outlet />;
}

/** Single inventory provider for all staff routes — avoids re-fetch on every navigation. */
function StaffShellLayout() {
    return (
        <InventoryProvider>
            <AppShell>
                <AnimatedOutlet />
            </AppShell>
        </InventoryProvider>
    );
}

function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path={NOT_FOUND_PATH} element={<NotFoundPage />} />
            <Route path={STAFF_LOGIN_PATH} element={<Login />} />
            <Route path="/auth/login" element={<Navigate to={STAFF_LOGIN_PATH} replace />} />
            <Route path="/auth/2fa" element={<TwoFactor />} />
            <Route path="/auth/forgot-password" element={<ForgotPassword />} />

            <Route element={<StaffShellLayout />}>
                <Route element={<AdminLayout />}>
                    <Route path="/admin/users" element={<UserManagement />} />
                    <Route path="/admin/production-settings" element={<ProductionSettings />} />
                    <Route path="/admin/item-types" element={<ItemTypeSettings />} />
                    <Route path="/audit" element={<SystemAudit />} />
                </Route>

                <Route element={<AuthStaffLayout />}>
                    <Route path="/masters/coa" element={<ChartOfAccounts />} />
                    <Route path="/masters/items" element={<ItemMaster />} />
                    <Route path="/masters/parties" element={<PartyMaster />} />
                    <Route path="/masters/parties/:id" element={<UnifiedPartyDashboard />} />
                    <Route path="/masters/labor-rates" element={<LaborRateMatrix />} />
                    <Route path="/masters/watta" element={<WattaMaster />} />

                    <Route path="/dashboard" element={<DashboardRouter />} />
                    <Route path="/purchase" element={<Purchase />} />
                    <Route path="/sales" element={<Sales />} />
                    <Route path="/cashbook" element={<Cashbook />} />
                    <Route path="/journal-vouchers" element={<JournalVoucher />} />
                    <Route path="/financials" element={<Navigate to="/cashbook" replace />} />
                    <Route path="/parchis" element={<ParchiRegister />} />
                    <Route path="/period-costing" element={<PeriodCostingDashboard />} />
                    <Route path="/ledgers" element={<LedgersPage />} />
                    <Route path="/rate-management" element={<RateManagement />} />
                    <Route path="/production" element={<Production />} />
                    <Route path="/production/enamel" element={<EnamelProduction />} />
                    <Route path="/production/workshop" element={<Navigate to="/production/enamel" replace />} />
                    <Route path="/production/drawing-wages" element={<DrawingWeeklyWages />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/inventory/adjustments" element={<StockAdjustments />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/alerts" element={<Alerts />} />
                    <Route path="/market" element={<MarketIntelligence />} />
                    <Route path="/assistant" element={<ErpAssistant />} />
                    <Route path="/scrap" element={<TriangleTrade />} />
                    <Route path="/production/scrap-dispatch" element={<FactoryScrapDispatch />} />
                </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    );
}

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <GlobalErrorBoundary>
                <Router>
                    <AppSessionProvider>
                        <AppRoutes />
                    </AppSessionProvider>
                </Router>
            </GlobalErrorBoundary>
            <Toaster />
            <SonnerToaster />
        </QueryClientProvider>
    );
}

export default App;
