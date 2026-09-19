import DashboardLayout from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    ArrowUpRight, ArrowDownRight, DollarSign, Activity,
    Bell, TrendingUp, AlertTriangle, Zap,
    ExternalLink, Lightbulb, Factory, ShoppingCart, Layers
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInventory } from "@/contexts/InventoryContext";
import { getFinishedGoodsStore } from "@/lib/itemCatalog";
import { formatItemLabel } from "@/lib/inventoryStore";
import {
    evaluateProductionAlerts,
    fetchProductionAlerts,
    type ProductionAlertRow,
} from "@/lib/api/dashboard";
import { WeeklyProductionChart, CopperTrendChart } from "@/components/dashboard/DashboardCharts";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useMarketHistory, useMarketQuotes, formatChangePct, formatQuoteValue } from "@/hooks/useMarketData";
import { useDashboardKpis } from "@/hooks/useErpQueries";
import { MotionKpiCard, MotionPanelCard, StaggerContainer, StaggerItem } from "@/components/motion/MotionPrimitives";
import { fetchMarketLatestBrief, type MarketBrief } from "@/lib/repositories/marketRepo";
import { summarizeMarketBrief } from "@/lib/marketBrief";

type TopPartyRow = { code: string; name: string; type: string; fin: number; metal: number };
type ParchiDueRow = { id: string; party: string; amount: number; type: string };
type DashAlert = { severity: "critical" | "warning" | "info"; title: string; desc: string };

function KpiCard({
    label, value, sub, subUp, icon: Icon, iconColor
}: {
    label: string; value: string; sub: string; subUp?: boolean;
    icon: LucideIcon; iconColor: string;
}) {
    return (
        <MotionKpiCard>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <div className={`p-1.5 rounded-lg ${iconColor}`}>
                    <Icon className="h-4 w-4" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-slate-900">{value}</div>
                <div className={`flex items-center gap-1 text-xs font-medium mt-1 ${subUp === false ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {subUp === false ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {sub}
                </div>
            </CardContent>
        </MotionKpiCard>
    );
}

export default function Dashboard() {
    const { catalog, getBalance, getReorderLevel } = useInventory();
    const { data: kpiData, isLoading: kpisLoading } = useDashboardKpis();
    const { byCode } = useMarketQuotes();
    const copperHistory = useMarketHistory("LME_COPPER_USD_T", 7);
    const copper = byCode("LME_COPPER_USD_T");
    const fx = byCode("USD_PKR");
    const implied = byCode("IMPLIED_COPPER_PKR_KG");
    const { up: copperIsUp, text: copperChangeText } = formatChangePct(copper?.change_1d_pct);
    const hasCopper = Boolean(copper);
    const loading = isErpLiveMode() && kpisLoading;
    const kpis = useMemo(
        () => ({
            openPurchaseOrders: kpiData?.openPurchaseOrders ?? 0,
            monthRevenue: kpiData?.monthRevenue ?? 0,
            parchisDueToday: kpiData?.parchisDueToday ?? 0,
            productionByDay: kpiData?.productionByDay ?? [],
        }),
        [kpiData],
    );
    const topParties = useMemo<TopPartyRow[]>(
        () =>
            (kpiData?.topParties ?? []).map((r) => ({
                code: r.party_code,
                name: r.party_name,
                type: r.party_type,
                fin: r.fin_balance_pkr,
                metal: r.metal_balance_kg,
            })),
        [kpiData],
    );
    const parchisDue = useMemo<ParchiDueRow[]>(
        () =>
            (kpiData?.parchisDueTodayRows ?? []).slice(0, 6).map((p) => ({
                id: String(p.parchi_no ?? ""),
                party: String(p.parties?.name ?? p.parties?.code ?? "—"),
                amount: Number(p.open_amount ?? 0),
                type: p.parchi_type === "bank_cheque" ? "Bank Cheque" : "Company Parchi",
            })),
        [kpiData],
    );
    const [productionAlerts, setProductionAlerts] = useState<ProductionAlertRow[]>([]);
    const [marketBrief, setMarketBrief] = useState<MarketBrief | null>(null);

    useEffect(() => {
        if (!isErpLiveMode()) return;
        let cancelled = false;
        const loadAlerts = async () => {
            try {
                await evaluateProductionAlerts();
                const pa = await fetchProductionAlerts("open");
                if (!cancelled) setProductionAlerts(pa);
            } catch {
                if (!cancelled) setProductionAlerts([]);
            }
        };
        void loadAlerts();
        const onProductionUpdated = () => void loadAlerts();
        window.addEventListener("erp:production-updated", onProductionUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener("erp:production-updated", onProductionUpdated);
        };
    }, []);

    useEffect(() => {
        if (!isErpLiveMode()) return;
        let cancelled = false;
        void fetchMarketLatestBrief()
            .then((value) => {
                if (!cancelled) setMarketBrief(value);
            })
            .catch(() => {
                if (!cancelled) setMarketBrief(null);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const fgEnameledKg = useMemo(
        () =>
            catalog
                .filter((i) => getFinishedGoodsStore(i) === "STORE_FG_ENAMELED")
                .reduce((s, i) => s + getBalance(i.code), 0),
        [catalog, getBalance]
    );
    const fgStripKg = useMemo(
        () =>
            catalog
                .filter((i) => getFinishedGoodsStore(i) === "STORE_FG_STRIP")
                .reduce((s, i) => s + getBalance(i.code), 0),
        [catalog, getBalance]
    );
    const lowStockItems = useMemo(
        () =>
            catalog.filter((i) => {
                const threshold = getReorderLevel(i.code);
                return threshold > 0 && getBalance(i.code) <= threshold;
            }),
        [catalog, getBalance, getReorderLevel]
    );
    const lowStockCount = lowStockItems.length;

    const criticalAlerts = useMemo<DashAlert[]>(() => {
        const prod: DashAlert[] = productionAlerts.map((a) => ({
            severity: a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info",
            title: (a.alert_type || "Production alert").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            desc: a.message,
        }));
        const stock: DashAlert[] = lowStockItems.map((i) => ({
            severity: "warning",
            title: `Low stock: ${formatItemLabel(i)}`,
            desc: `${getBalance(i.code).toLocaleString()} ${i.unit} on hand — reorder level ${getReorderLevel(i.code).toLocaleString()} ${i.unit}.`,
        }));
        return [...prod, ...stock];
    }, [productionAlerts, lowStockItems, getBalance, getReorderLevel]);

    const insights = (() => {
        const out: DashAlert[] = [];
        if (copperIsUp === false && hasCopper) {
            out.push({
                severity: "info",
                title: "Copper trending down",
                desc: `The COMEX copper benchmark is ${copperChangeText} over 24h. Review current supplier quotations before booking procurement.`,
            });
        } else if (copperIsUp === true && hasCopper) {
            out.push({
                severity: "warning",
                title: "Copper trending up",
                desc: `The COMEX copper benchmark is ${copperChangeText} over 24h. Review sale rates and current supplier quotations.`,
            });
        }
        if (lowStockCount > 0) {
            out.push({
                severity: "warning",
                title: "Stock below reorder level",
                desc: `${lowStockCount} SKU${lowStockCount === 1 ? "" : "s"} at or under reorder threshold. Plan procurement to avoid line stoppages.`,
            });
        }
        if (kpis.parchisDueToday > 0) {
            out.push({
                severity: "info",
                title: "Parchis maturing today",
                desc: `${kpis.parchisDueToday} parchi commitment${kpis.parchisDueToday === 1 ? "" : "s"} due today — confirm clearance or follow up.`,
            });
        }
        return out;
    })();

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <DashboardLayout>
            <div className="space-y-6">

                {/* ── HEADER ── */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                            Command Center
                        </h1>
                        <p className="text-slate-500 mt-1">Live overview of operations, finance, and market signals.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right mr-2 hidden sm:block">
                            <p className="text-xl font-mono font-bold text-slate-700 leading-none">{timeStr}</p>
                            <p className="text-xs text-slate-400 mt-1">{dateStr}</p>
                        </div>
                        <Button variant="outline" className="shadow-soft border-slate-200">
                            <ExternalLink className="mr-2 h-4 w-4" /> Export
                        </Button>
                        <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft text-white">
                            <Zap className="mr-2 h-4 w-4" /> AI Actions
                        </Button>
                    </div>
                </div>

                {/* ── KPI ROW ── */}
                <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <StaggerItem>
                        <KpiCard
                            label="Total Revenue"
                            value={`Rs. ${(kpis.monthRevenue / 1_000_000).toFixed(1)}M`}
                            sub="Live from posted GL income"
                            subUp={kpis.monthRevenue >= 0}
                            icon={DollarSign}
                            iconColor="bg-slate-100 text-black"
                        />
                    </StaggerItem>
                    <StaggerItem>
                        <KpiCard
                            label="FG Enameled Store"
                            value={`${fgEnameledKg.toLocaleString()} kg`}
                            sub="Live from inventory"
                            subUp={true}
                            icon={Zap}
                            iconColor="bg-slate-100 text-black"
                        />
                    </StaggerItem>
                    <StaggerItem>
                        <KpiCard
                            label="FG Strip Store"
                            value={`${fgStripKg.toLocaleString()} kg`}
                            sub="Live from inventory"
                            subUp={true}
                            icon={Layers}
                            iconColor="bg-slate-100 text-black"
                        />
                    </StaggerItem>
                    <StaggerItem>
                        <KpiCard
                            label="Open Purchase Orders"
                            value={`${kpis.openPurchaseOrders} Orders`}
                            sub={kpis.openPurchaseOrders === 0 ? "No open orders" : "Open & partially-received POs"}
                            subUp={kpis.openPurchaseOrders === 0}
                            icon={ShoppingCart}
                            iconColor="bg-slate-100 text-black"
                        />
                    </StaggerItem>
                    <StaggerItem>
                        <KpiCard
                            label="Low Stock SKUs"
                            value={`${lowStockCount} Items`}
                            sub={lowStockCount > 0 ? "Below reorder level" : "All within thresholds"}
                            subUp={lowStockCount === 0}
                            icon={Bell}
                            iconColor="bg-slate-100 text-black"
                        />
                    </StaggerItem>
                </StaggerContainer>

                {/* ── MAIN GRID ── */}
                <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">

                    {/* LEFT (4/7) */}
                    <div className="lg:col-span-4 space-y-6">

                        {/* Weekly Production Chart */}
                        <MotionPanelCard>
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <CardTitle>Weekly Production</CardTitle>
                                        <CardDescription>Output trends over the last 7 days (kg)</CardDescription>
                                    </div>
                                    <Badge variant="outline" className="text-blue-700 bg-blue-50 border-blue-200 text-xs">This Week</Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[240px] w-full mt-4">
                                    {loading ? (
                                        <div className="h-full w-full flex items-end gap-3 px-2 pb-6 animate-pulse">
                                            {[60, 90, 45, 110, 70, 130, 55].map((h, i) => (
                                                <div key={i} className="flex-1 rounded-t-md bg-slate-100" style={{ height: `${h}px` }} />
                                            ))}
                                        </div>
                                    ) : kpis.productionByDay.length === 0 ? (
                                        <div className="h-full w-full flex flex-col items-center justify-center text-center text-slate-400">
                                            <Factory className="h-8 w-8 mb-2 text-slate-300" />
                                            <p className="text-sm font-medium text-slate-500">No production posted in the last 7 days</p>
                                            <p className="text-xs mt-1">Output will appear here once batches are posted.</p>
                                        </div>
                                    ) : (
                                    <WeeklyProductionChart data={kpis.productionByDay} />
                                    )}
                                </div>
                            </CardContent>
                        </MotionPanelCard>

                        {/* Top Parties Exposure */}
                        <MotionPanelCard>
                            <CardHeader className="pb-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle>Top Party Exposure</CardTitle>
                                        <CardDescription>Financial + Metal Khata dual-ledger view</CardDescription>
                                    </div>
                                    <Button variant="outline" size="sm" className="text-xs">View All</Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {loading ? (
                                        [0, 1, 2].map((i) => (
                                            <div key={i} className="h-[58px] rounded-xl border border-slate-100 bg-slate-50/50 animate-pulse" />
                                        ))
                                    ) : topParties.length === 0 ? (
                                        <p className="text-sm text-slate-400 py-6 text-center">No outstanding party balances.</p>
                                    ) : (
                                        topParties.map((p) => {
                                            const isCust = p.type === "customer" || p.type === "both";
                                            const tag = isCust ? "CUST" : "VEND";
                                            const finUp = p.fin >= 0;
                                            const metalUp = p.metal >= 0;
                                            return (
                                                <Link
                                                    to={`/reports?report=unified-ledgers&party=${encodeURIComponent(p.code)}`}
                                                    key={p.code}
                                                    className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 motion-row-hover hover:bg-slate-50"
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${isCust ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                                                            {tag}
                                                        </div>
                                                        <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                                                    </div>
                                                    <div className="flex gap-6 text-right shrink-0">
                                                        <div>
                                                            <p className={`text-xs font-semibold ${finUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                {Math.abs(p.fin).toLocaleString(undefined, { maximumFractionDigits: 0 })} {finUp ? 'Dr' : 'Cr'}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <p className={`text-xs font-semibold font-mono ${metalUp ? 'text-blue-600' : 'text-rose-600'}`}>
                                                                {Math.abs(p.metal).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                                                            </p>
                                                        </div>
                                                    </div>
                                                </Link>
                                            );
                                        })
                                    )}
                                </div>
                            </CardContent>
                        </MotionPanelCard>

                        {/* AI / System Suggestions */}
                        <MotionPanelCard className="border-indigo-100 bg-indigo-50/30">
                            <CardHeader className="pb-4">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-indigo-100 rounded-lg">
                                        <Lightbulb className="h-4 w-4 text-indigo-600" />
                                    </div>
                                    <CardTitle>System Intelligence</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {loading ? (
                                        [0, 1].map((i) => (
                                            <div key={i} className="h-[72px] bg-white rounded-xl border border-indigo-100 shadow-sm animate-pulse" />
                                        ))
                                    ) : insights.length === 0 ? (
                                        <div className="flex gap-3 p-4 bg-white rounded-xl border border-indigo-100 shadow-sm">
                                            <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                                <TrendingUp className="h-4 w-4 text-emerald-600" />
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-slate-900 text-sm">All systems nominal</h4>
                                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">No procurement, stock, or commitment signals need attention right now.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        insights.map((s, i) => (
                                            <div key={i} className={`flex gap-3 p-4 bg-white rounded-xl border shadow-sm ${s.severity === 'warning' ? 'border-amber-100' : 'border-indigo-100'}`}>
                                                <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${s.severity === 'warning' ? 'bg-amber-50' : 'bg-indigo-50'}`}>
                                                    {s.severity === 'warning'
                                                        ? <AlertTriangle className="h-4 w-4 text-amber-600" />
                                                        : <TrendingUp className="h-4 w-4 text-indigo-600" />}
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold text-slate-900 text-sm">{s.title}</h4>
                                                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{s.desc}</p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </MotionPanelCard>
                    </div>

                    {/* RIGHT (3/7) */}
                    <div className="lg:col-span-3 space-y-6">

                        {/* Market trends and compact brief */}
                        <MotionPanelCard>
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <CardTitle>Copper Market</CardTitle>
                                        <CardDescription>COMEX futures benchmark, 7 day</CardDescription>
                                    </div>
                                    <Badge variant="outline" className={`text-xs ${copperIsUp ? "text-emerald-700 bg-emerald-50 border-emerald-200" : copperIsUp === false ? "text-rose-700 bg-rose-50 border-rose-200" : "text-slate-600"}`}>
                                        {copperIsUp != null ? (copperIsUp ? "Up" : "Down") : "Market"}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[140px] w-full -mx-2 mt-2">
                                    {copperHistory.loading ? (
                                        <div className="h-full w-full animate-pulse bg-slate-50 rounded-lg" />
                                    ) : (
                                    <CopperTrendChart
                                        data={
                                            copperHistory.chartData.length
                                                ? copperHistory.chartData.map((d) => ({
                                                      date: d.name,
                                                      value: d.price,
                                                  }))
                                                : [{ date: "-", value: 0 }]
                                        }
                                    />
                                    )}
                                </div>
                                <div className="space-y-3 mt-4 pt-4 border-t border-slate-100">
                                    {[
                                        { name: "COMEX copper", q: copper },
                                        { name: "USD / PKR", q: fx },
                                        { name: "Implied PKR/kg", q: implied },
                                    ].map(({ name, q }) => {
                                        const chg = formatChangePct(q?.change_1d_pct);
                                        return (
                                        <div key={name} className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-slate-600">{name}</span>
                                            <div className="text-right">
                                                <span className="block text-sm font-bold text-slate-900">{formatQuoteValue(q)}</span>
                                                <span className={`text-xs font-semibold ${chg.up ? 'text-emerald-600' : chg.up === false ? 'text-rose-600' : 'text-slate-400'}`}>{chg.text}</span>
                                            </div>
                                        </div>
                                    );})}
                                </div>
                                <div className="mt-4 border-t border-slate-200 pt-4">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold uppercase text-slate-500">Market brief</span>
                                            {marketBrief?.signal && (
                                                <Badge
                                                    variant="outline"
                                                    className="h-5 rounded border-black bg-white px-1.5 text-[10px] uppercase text-black hover:bg-white"
                                                >
                                                    {marketBrief.signal}
                                                </Badge>
                                            )}
                                        </div>
                                        <Link to="/market" className="text-xs font-medium text-slate-600 hover:text-black">
                                            Open <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
                                        </Link>
                                    </div>
                                    <p className="min-h-10 text-xs leading-5 text-slate-600">
                                        {marketBrief
                                            ? summarizeMarketBrief(marketBrief.content_md, 210)
                                            : "No market brief has been generated yet."}
                                    </p>
                                </div>
                            </CardContent>
                        </MotionPanelCard>

                        {/* Critical Alerts */}
                        <MotionPanelCard className="border-rose-100 bg-rose-50/10">
                            <CardHeader className="pb-4">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-rose-100 rounded-lg">
                                        <Bell className="h-4 w-4 text-rose-600" />
                                    </div>
                                    <CardTitle>Critical Alerts</CardTitle>
                                    <Badge className="ml-auto bg-rose-100 text-rose-700 hover:bg-rose-100 text-xs">{criticalAlerts.length} Active</Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {loading ? (
                                        [0, 1, 2].map((i) => (
                                            <div key={i} className="h-[60px] rounded-xl bg-white border border-slate-100 shadow-sm animate-pulse" />
                                        ))
                                    ) : criticalAlerts.length === 0 ? (
                                        <p className="text-sm text-slate-400 py-6 text-center">No active alerts. All clear.</p>
                                    ) : (
                                        criticalAlerts.slice(0, 6).map((a, i) => (
                                            <div key={i} className="flex gap-3 p-3 rounded-xl bg-white border border-slate-100 shadow-sm">
                                                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${a.severity === 'critical' ? 'bg-rose-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-400'}`} />
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-slate-900">{a.title}</p>
                                                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{a.desc}</p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </MotionPanelCard>

                        {/* Parchis Due */}
                        <MotionPanelCard className="border-amber-100 bg-amber-50/20">
                            <CardHeader className="pb-4">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-amber-100 rounded-lg">
                                        <Activity className="h-4 w-4 text-amber-600" />
                                    </div>
                                    <CardTitle>Parchis Due Today</CardTitle>
                                    <Badge className="ml-auto bg-amber-100 text-amber-700 hover:bg-amber-100 text-xs">{parchisDue.length} Pending</Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {loading ? (
                                        [0, 1, 2].map((i) => (
                                            <div key={i} className="h-[58px] bg-white rounded-xl border border-slate-100 shadow-sm animate-pulse" />
                                        ))
                                    ) : parchisDue.length === 0 ? (
                                        <p className="text-sm text-slate-400 py-6 text-center">No parchis due today.</p>
                                    ) : (
                                        parchisDue.map((p) => (
                                            <div key={p.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-amber-200 transition-colors">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-slate-900 truncate">{p.id} · {p.party}</p>
                                                    <p className="text-xs text-slate-500 mt-0.5 font-mono">{p.type} · PKR {p.amount.toLocaleString()}</p>
                                                </div>
                                                <Link to="/parchis" className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md text-slate-400 hover:text-amber-600 hover:bg-amber-50">
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </Link>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </MotionPanelCard>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
