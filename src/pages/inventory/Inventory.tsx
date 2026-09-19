import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Search,
    AlertCircle,
    Zap,
    Package,
    FlaskConical,
    Recycle,
    ExternalLink,
    ArrowRight,
    Box,
    Layers,
    TrendingDown,
    Pencil,
    Calculator,
    Scale,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { motion } from "framer-motion";
import {
    getDefaultMonthFilters,
    getPartyMaterialSummaries,
    getLivePartyMaterialSummaries,
    mapPartyStockMovementRows,
    formatQty,
    type LivePartyStockRow,
} from "@/lib/partyMovementReport";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { fetchPartyStockMovement } from "@/lib/repositories/reportsRepo";
import {
    fetchScrapTollDropPartySummary,
    fetchScrapTradeRegister,
} from "@/lib/repositories/scrapRepo";
import { fetchMachineScrapLedger } from "@/lib/repositories/reportsRepo";
import { fetchFactoryScrapDispatchRegister } from "@/lib/repositories/reportsRepo";
import type { MachineScrapLedgerRow } from "@/lib/api/scrap";
import type { ScrapTollDropPartyRow, ScrapTradeRegisterRow } from "@/lib/scrapTradeTypes";
import {
    type InventorySection,
    type ItemMasterRecord,
    getInventorySection,
} from "@/lib/itemCatalog";
import { useInventoryValuationRates } from "@/hooks/useErpQueries";
import { resolveInventoryValuationRateForItem } from "@/lib/inventoryValuationValidation";
import { ValuationRatesPanel } from "@/components/inventory/ValuationRatesPanel";
import { useInventory, useInventoryActions, useInventoryMovements } from "@/contexts/InventoryContext";
import type { ScrapPartySummary } from "@/lib/inventoryStore";
import { RestockSuppliesDialog } from "@/components/inventory/RestockSuppliesDialog";
import { SuppliesRestockPanel } from "@/components/inventory/SuppliesRestockPanel";
import { suppliesStockUnit, defaultDrumWeightKg, formatVarnishDrums, kgToVarnishDrums, type SuppliesRestockKind } from "@/lib/suppliesRestock";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@tanstack/react-table";

const CARD =
    "shadow-soft border-slate-100 bg-white transition-all duration-300 hover:shadow-md hover:border-slate-200";

type TabId = "finished_goods" | "raw_material" | "packing_material" | "varnish" | "valuation_rates";

const INVENTORY_TABS: {
    id: TabId;
    label: string;
    short: string;
    icon: typeof Zap;
}[] = [
    { id: "finished_goods", label: "Finished goods", short: "Finished", icon: Zap },
    { id: "raw_material", label: "Raw material", short: "Raw", icon: Recycle },
    { id: "packing_material", label: "Packing", short: "Packing", icon: Package },
    { id: "varnish", label: "Varnish", short: "Varnish", icon: FlaskConical },
    { id: "valuation_rates", label: "Valuation rates", short: "Rates", icon: Calculator },
];

function formatPkr(n: number): string {
    if (n >= 1_000_000) return `₨ ${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `₨ ${(n / 1_000).toFixed(1)}K`;
    return `₨ ${n.toLocaleString()}`;
}

function demoScrapPartyRows(summary: ScrapPartySummary[]): ScrapTollDropPartyRow[] {
    const sources: ScrapTollDropPartyRow[] = summary
        .filter((r) => r.receivedKg > 0)
        .map((r) => ({
            party_code: r.partyId,
            party_name: r.partyName,
            party_role: "source" as const,
            scrap_kg: r.receivedKg,
            avg_rate: r.receivedKg > 0 ? Math.round((r.receivedAmount / r.receivedKg) * 1000) / 1000 : 0,
            scrap_amount: r.receivedAmount,
            trade_count: 0,
        }));
    const destinations: ScrapTollDropPartyRow[] = summary
        .filter((r) => r.sentKg > 0)
        .map((r) => ({
            party_code: r.partyId,
            party_name: r.partyName,
            party_role: "destination" as const,
            scrap_kg: r.sentKg,
            avg_rate: r.sentKg > 0 ? Math.round((r.sentAmount / r.sentKg) * 1000) / 1000 : 0,
            scrap_amount: r.sentAmount,
            trade_count: 0,
        }));
    return [...sources, ...destinations];
}

function KpiCard({
    label,
    value,
    sub,
    icon: Icon,
    iconBg,
}: {
    label: string;
    value: string;
    sub?: string;
    icon: typeof Box;
    iconBg: string;
}) {
    return (
        <Card className={cn(CARD, "hover:-translate-y-0.5")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">{label}</CardTitle>
                <div className={cn("p-1.5", iconBg)}>
                    <Icon className="h-4 w-4" />
                </div>
                        </CardHeader>
                        <CardContent>
                <div className="text-2xl font-bold text-slate-900 tracking-tight">{value}</div>
                {sub ? <p className="text-xs text-slate-500 mt-1">{sub}</p> : null}
                        </CardContent>
                    </Card>
    );
}

function SectionCard({
    title,
    description,
    children,
    className,
}: {
    title: string;
    description?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <Card className={cn(CARD, "hover:translate-y-0", className)}>
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-900">{title}</CardTitle>
                {description ? <CardDescription className="text-sm text-slate-500">{description}</CardDescription> : null}
                        </CardHeader>
            <CardContent>{children}</CardContent>
                    </Card>
    );
}

type StockRow = { item: ItemMasterRecord; qty: number; units: number; status: string };

function StockTable({
    rows,
    searchQuery,
    stockKind,
    showUnits,
    onEditStock,
    getAvgUnitCost,
}: {
    rows: StockRow[];
    searchQuery: string;
    stockKind?: SuppliesRestockKind;
    showUnits?: boolean;
    onEditStock?: (itemCode: string) => void;
    getAvgUnitCost?: (itemCode: string) => number | null;
}) {
    const filtered = useMemo(
        () =>
            rows.filter(
                (row) =>
                    !searchQuery ||
                    row.item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    row.item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    row.item.sizeSpec.toLowerCase().includes(searchQuery.toLowerCase()),
            ),
        [rows, searchQuery],
    );

    const columns = useMemo<ColumnDef<StockRow, unknown>[]>(() => {
        const cols: ColumnDef<StockRow, unknown>[] = [
            {
                id: "code",
                accessorFn: (row) => row.item.code,
                header: "Code",
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-slate-500">{row.original.item.code}</span>
                ),
            },
            {
                id: "name",
                accessorFn: (row) => row.item.name,
                header: "Item",
                cell: ({ row }) => (
                    <span className="font-medium text-slate-800">{row.original.item.name}</span>
                ),
            },
            {
                id: "spec",
                accessorFn: (row) => row.item.sizeSpec,
                header: "Spec",
                cell: ({ row }) => (
                    <span className="text-slate-600">{row.original.item.sizeSpec || "—"}</span>
                ),
            },
            {
                id: "qty",
                accessorFn: (row) => row.qty,
                header: "Qty (kg)",
                meta: { align: "right" },
                cell: ({ row }) => (
                    <span className="tabular-nums font-semibold text-slate-900">
                        {row.original.qty.toLocaleString()}
                    </span>
                ),
            },
        ];
        if (showUnits) {
            cols.push({
                id: "units",
                accessorFn: (row) => row.units,
                header: "Units",
                meta: { align: "right" },
                cell: ({ row }) => (
                    <span className="tabular-nums text-slate-800">
                        {row.original.units > 0 ? row.original.units.toLocaleString() : "—"}
                    </span>
                ),
            });
        }
        if (stockKind === "varnish") {
            cols.push({
                id: "drums",
                enableSorting: false,
                header: "Drums",
                meta: { align: "right" },
                cell: ({ row }) => {
                    const drumWeight = defaultDrumWeightKg(row.original.item);
                    return (
                        <span className="tabular-nums text-purple-800 text-xs">
                            {formatVarnishDrums(row.original.qty, drumWeight)}
                            <span className="block text-[10px] text-slate-400 font-normal">
                                @ {drumWeight} kg/drum
                            </span>
                        </span>
                    );
                },
            });
            cols.push({
                id: "avgCost",
                enableSorting: false,
                header: "Avg cost",
                meta: { align: "right" },
                cell: ({ row }) => {
                    const avg = getAvgUnitCost?.(row.original.item.code);
                    const drumWeight = defaultDrumWeightKg(row.original.item);
                    if (avg == null || avg <= 0) {
                        return <span className="text-slate-400 text-xs">—</span>;
                    }
                    const perDrum = avg * drumWeight;
                    return (
                        <span className="tabular-nums text-slate-800 text-xs">
                            ₨ {avg.toLocaleString(undefined, { maximumFractionDigits: 2 })} / kg
                            {perDrum > 0 ? (
                                <span className="block text-[10px] text-slate-400 font-normal">
                                    ≈ ₨ {perDrum.toLocaleString(undefined, { maximumFractionDigits: 0 })} / drum
                                </span>
                            ) : null}
                        </span>
                    );
                },
            });
        }
        if (stockKind === "packing") {
            cols.push({
                id: "avgCost",
                enableSorting: false,
                header: "Avg cost",
                meta: { align: "right" },
                cell: ({ row }) => {
                    const avg = getAvgUnitCost?.(row.original.item.code);
                    const uom = suppliesStockUnit("packing", row.original.item);
                    if (avg == null || avg <= 0) {
                        return <span className="text-slate-400 text-xs">—</span>;
                    }
                    return (
                        <span className="tabular-nums text-slate-800 text-xs">
                            ₨ {avg.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {uom}
                        </span>
                    );
                },
            });
        }
        cols.push(
            {
                id: "uom",
                enableSorting: false,
                header: "UOM",
                cell: ({ row }) => (
                    <span className="text-slate-500 text-xs">
                        {stockKind ? suppliesStockUnit(stockKind, row.original.item) : row.original.item.unit}
                    </span>
                ),
            },
            {
                id: "status",
                accessorFn: (row) => row.status,
                header: "Status",
                meta: { align: "right" },
                cell: ({ row }) => (
                    <span
                        className={cn(
                            "inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full",
                            row.original.status === "Low"
                                ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
                        )}
                    >
                        {row.original.status}
                    </span>
                ),
            },
        );
        if (onEditStock) {
            cols.push({
                id: "actions",
                enableSorting: false,
                header: () => <span className="sr-only">Edit</span>,
                meta: { align: "right" },
                cell: ({ row }) => (
                    <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-900"
                            onClick={() => onEditStock(row.original.item.code)}
                            title="Edit stock"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                ),
            });
        }
        return cols;
    }, [stockKind, showUnits, onEditStock, getAvgUnitCost]);

    return (
        <DataTable
            columns={columns}
            data={filtered}
            getRowId={(row) => row.item.code}
            hideSearch
            pageSize={0}
            emptyMessage="No items match your search."
        />
    );
}

function ScrapPartyList({ rows, emptyLabel }: { rows: ScrapTollDropPartyRow[]; emptyLabel: string }) {
    if (rows.length === 0) {
        return (
            <p className="text-sm text-slate-400 py-10 text-center bg-slate-50/50 border border-dashed border-slate-200">
                {emptyLabel}
            </p>
        );
    }
    return (
        <ul className="space-y-2">
            {rows.map((row) => (
                <li
                    key={`${row.party_role}-${row.party_code}`}
                    className="flex items-center justify-between gap-4 border border-slate-100 bg-slate-50/40 px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                    <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate text-sm">{row.party_name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{row.party_code}</p>
                                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                        <p className="font-semibold text-slate-900 text-sm">{row.scrap_kg.toLocaleString()} kg</p>
                        <p className="text-xs text-slate-500">@ {row.avg_rate.toLocaleString()} /kg · {formatPkr(row.scrap_amount)}</p>
                                        </div>
                </li>
            ))}
        </ul>
    );
}

export default function Inventory() {
    const {
        catalog,
        balances,
        unitBalances,
        getBalance,
        getUnitBalance,
        getAvgUnitCost,
        getReorderLevel,
        scrapPartySummary,
    } = useInventory();
    const { refresh: refreshInventory } = useInventoryActions();
    const movements = useInventoryMovements({ limit: 12 });
    const liveMode = useBackendLiveMode();
    const [activeTab, setActiveTab] = useState<TabId>("raw_material");
    const [searchQuery, setSearchQuery] = useState("");
    const [livePartyRows, setLivePartyRows] = useState<LivePartyStockRow[]>([]);
    const [scrapPartyRows, setScrapPartyRows] = useState<ScrapTollDropPartyRow[]>([]);
    const [recentTrades, setRecentTrades] = useState<ScrapTradeRegisterRow[]>([]);
    const [machineScrapRows, setMachineScrapRows] = useState<MachineScrapLedgerRow[]>([]);
    const [factoryDispatchRows, setFactoryDispatchRows] = useState<Awaited<ReturnType<typeof fetchFactoryScrapDispatchRegister>>>([]);
    const [restockOpen, setRestockOpen] = useState(false);
    const [restockKind, setRestockKind] = useState<SuppliesRestockKind>("packing");
    const [restockItemCode, setRestockItemCode] = useState<string | undefined>();
    const [restockRefreshKey, setRestockRefreshKey] = useState(0);

    const bumpRestockHistory = () => setRestockRefreshKey((k) => k + 1);

    const handleSuppliesRestockChanged = useCallback(() => {
        bumpRestockHistory();
        void refreshInventory();
    }, [refreshInventory]);

    const openRestock = (kind: SuppliesRestockKind, itemCode?: string) => {
        setRestockKind(kind);
        setRestockItemCode(itemCode);
        setRestockOpen(true);
    };

    const buildRows = (sections: InventorySection[]) =>
        catalog
            .filter((item) => sections.includes(getInventorySection(item)))
            .map((item) => {
                const qty = getBalance(item.code);
                const unitsRaw = getUnitBalance(item.code);
                const units =
                    sections.includes("varnish") && unitsRaw <= 0 && qty > 0
                        ? kgToVarnishDrums(qty, defaultDrumWeightKg(item))
                        : unitsRaw;
                const threshold = getReorderLevel(item.code);
                return { item, qty, units, status: qty <= threshold ? "Low" : "Available" };
            });

    const fgEnameled = useMemo(() => buildRows(["fg_enameled"]), [catalog, balances, unitBalances]);
    const fgStrip = useMemo(() => buildRows(["fg_strip"]), [catalog, balances, unitBalances]);
    const fgCopperWire = useMemo(() => buildRows(["fg_copper_wire"]), [catalog, balances, unitBalances]);
    const rmScrap = useMemo(() => buildRows(["rm_scrap"]), [catalog, balances, unitBalances]);
    const rmWire = useMemo(() => buildRows(["rm_wire8"]), [catalog, balances, unitBalances]);
    const rmRod = useMemo(() => buildRows(["rm_rod"]), [catalog, balances, unitBalances]);
    const packing = useMemo(() => buildRows(["packing"]), [catalog, balances, unitBalances]);
    const varnish = useMemo(() => buildRows(["varnish"]), [catalog, balances, unitBalances]);
    const finishedGoods = useMemo(() => [...fgEnameled, ...fgStrip, ...fgCopperWire], [fgEnameled, fgStrip, fgCopperWire]);
    const rawMaterial = useMemo(() => [...rmScrap, ...rmWire, ...rmRod], [rmScrap, rmWire, rmRod]);

    const allRows = useMemo(
        () => [...finishedGoods, ...rawMaterial, ...packing, ...varnish],
        [finishedGoods, rawMaterial, packing, varnish],
    );

    const { data: valuationRates = [] } = useInventoryValuationRates();
    const valuationAsOf = useMemo(() => new Date().toISOString().slice(0, 10), []);

    const totalValuationLabel = useMemo(() => {
        const total = allRows.reduce((sum, row) => {
            const rate = resolveInventoryValuationRateForItem(row.item, valuationRates, valuationAsOf);
            return sum + row.qty * (rate ?? 0);
        }, 0);
        return formatPkr(total);
    }, [allRows, valuationRates, valuationAsOf]);

    const lowStockCount = allRows.filter((row) => row.status === "Low").length;
    const factoryScrapByDept = useMemo(() => {
        const map: Record<string, number> = { drawing: 0, enamel: 0, workshop: 0 };
        for (const r of machineScrapRows) {
            const dept = r.department.toLowerCase();
            if (dept in map) map[dept] += r.generated_kg;
        }
        return map;
    }, [machineScrapRows]);
    const totalFactoryScrapGenerated = useMemo(
        () => machineScrapRows.reduce((s, r) => s + r.generated_kg, 0),
        [machineScrapRows],
    );
    const totalFactoryScrapSent = useMemo(
        () => factoryDispatchRows.filter((d) => d.status === "posted").reduce((s, d) => s + d.net_weight, 0),
        [factoryDispatchRows],
    );
    const monthFilters = useMemo(() => getDefaultMonthFilters(), []);

    useEffect(() => {
        if (!liveMode) {
            setLivePartyRows([]);
            setScrapPartyRows(demoScrapPartyRows(scrapPartySummary));
            setRecentTrades([]);
            setMachineScrapRows([]);
            setFactoryDispatchRows([]);
            return;
        }
        const loadPartyStock = () => {
            void fetchPartyStockMovement(monthFilters.dateFrom, monthFilters.dateTo).then((rows) => {
                setLivePartyRows(mapPartyStockMovementRows(rows as Record<string, unknown>[]));
            });
        };
        loadPartyStock();
        const onInvoiceUpdated = () => loadPartyStock();
        window.addEventListener("erp:invoice-updated", onInvoiceUpdated);
        return () => window.removeEventListener("erp:invoice-updated", onInvoiceUpdated);
    }, [liveMode, monthFilters.dateFrom, monthFilters.dateTo, scrapPartySummary]);

    useEffect(() => {
        if (!liveMode) return;
        const loadMachineScrap = () => {
            void fetchMachineScrapLedger({
                from: monthFilters.dateFrom,
                to: monthFilters.dateTo,
            })
                .then(setMachineScrapRows)
                .catch(() => setMachineScrapRows([]));
        };
        loadMachineScrap();
        const onProductionUpdated = () => loadMachineScrap();
        window.addEventListener("erp:production-updated", onProductionUpdated);
        return () => window.removeEventListener("erp:production-updated", onProductionUpdated);
    }, [liveMode, monthFilters.dateFrom, monthFilters.dateTo]);

    useEffect(() => {
        if (!liveMode || activeTab !== "raw_material") return;
        void fetchFactoryScrapDispatchRegister(monthFilters.dateFrom, monthFilters.dateTo)
            .then(setFactoryDispatchRows)
            .catch(() => setFactoryDispatchRows([]));
        void fetchScrapTollDropPartySummary(monthFilters.dateFrom, monthFilters.dateTo)
            .then(setScrapPartyRows)
            .catch(() => setScrapPartyRows([]));
        void fetchScrapTradeRegister(monthFilters.dateFrom, monthFilters.dateTo)
            .then((rows) =>
                setRecentTrades(
                    rows.slice(0, 10).map((r: Record<string, unknown>) => ({
                        trade_no: String(r.trade_no ?? ""),
                        trade_date: String(r.trade_date ?? ""),
                        source_name: String(r.source_name ?? ""),
                        dest_name: String(r.dest_name ?? ""),
                        item_code: String(r.item_code ?? ""),
                        bilty_no: r.bilty_no != null ? String(r.bilty_no) : null,
                        vehicle_no: r.vehicle_no != null ? String(r.vehicle_no) : null,
                        net_weight: Number(r.net_weight ?? 0),
                        unit_rate: Number(r.unit_rate ?? 0),
                        amount: Number(r.amount ?? 0),
                    })),
                ),
            )
            .catch(() => setRecentTrades([]));
    }, [liveMode, activeTab, monthFilters.dateFrom, monthFilters.dateTo]);

    const monthRmReceived = useMemo(() => {
        const received = getPartyMaterialSummaries("received", monthFilters);
        const sum = (section: string) =>
            received.filter((r) => r.materialGroup === section).reduce((s, r) => s + r.totalQty, 0);
        return { scrap: sum("rm_scrap"), wire8: sum("rm_wire8"), rod: sum("rm_rod") };
    }, [monthFilters]);

    const scrapFromSources = useMemo(() => scrapPartyRows.filter((r) => r.party_role === "source"), [scrapPartyRows]);
    const scrapToDestinations = useMemo(
        () => scrapPartyRows.filter((r) => r.party_role === "destination"),
        [scrapPartyRows],
    );

    const reportLink = `/reports?report=party-stock&from=${monthFilters.dateFrom}&to=${monthFilters.dateTo}`;

    const rodMovements = useMemo(
        () =>
            movements.slice(0, 12).filter(
                (m) =>
                    (m.itemCode === "RM-CR-001" || m.itemCode === "RM-CR-002") &&
                    (m.type === "PURCHASE_INVOICE" || m.type === "PURCHASE_RETURN"),
            ),
        [movements],
    );

    const renderFinished = () => (
        <SectionCard title="Finished goods warehouse" description="Enameled wire, copper wire, and copper strip on hand.">
            <StockTable rows={finishedGoods} searchQuery={searchQuery} showUnits />
        </SectionCard>
    );

    const renderRawMaterial = () => (
        <div className="space-y-5">
            <SectionCard title="Raw material warehouse" description="Scrap, wire no. 8, and rod.">
                <StockTable rows={rawMaterial} searchQuery={searchQuery} showUnits />
            </SectionCard>

            {liveMode && (
                <Card className={cn(CARD, "border-l-4 border-l-amber-500 hover:translate-y-0")}>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                        <div>
                            <CardTitle className="text-sm font-semibold text-slate-900">Factory scrap generated (MTD)</CardTitle>
                            <CardDescription className="text-xs">
                                Per machine — recorded when sent to vendor (not warehouse stock).
                            </CardDescription>
                                    </div>
                        <Button variant="outline" size="sm" asChild className="h-8 text-xs shadow-soft shrink-0">
                            <Link to="/production/scrap-dispatch">Dispatch</Link>
                        </Button>
                            </CardHeader>
                    <CardContent className="p-0">
                        {machineScrapRows.length === 0 ? (
                            <p className="px-4 py-6 text-sm text-slate-500 text-center">
                                No factory scrap recorded this month — use Factory Scrap to record machine scrap.
                            </p>
                        ) : (
                            <TableScroller>
                                <Table noWrapper className="text-sm min-w-[520px]">
                                    <TableHeader>
                                        <TableRow className="border-slate-100">
                                            <TableHead className="h-8 text-slate-500">Dept</TableHead>
                                            <TableHead className="text-slate-500">Machine</TableHead>
                                            <TableHead className="text-slate-500">Scrap SKU</TableHead>
                                            <TableHead className="text-right text-slate-500">Generated</TableHead>
                                            <TableHead className="text-right text-slate-500">Sent</TableHead>
                                            <TableHead className="text-right text-slate-500">Scrap %</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {machineScrapRows.map((r) => (
                                            <TableRow key={r.machine_id} className="border-slate-50">
                                                <TableCell className="py-2 capitalize text-xs">{r.department}</TableCell>
                                                <TableCell className="py-2">
                                                    <span className="font-mono text-xs">{r.machine_code}</span>
                                                    <span className="text-slate-500 text-xs"> — {r.machine_name}</span>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs py-2">{r.scrap_item_code || "—"}</TableCell>
                                                <TableCell className="text-right py-2 tabular-nums">
                                                    {r.generated_kg.toLocaleString()} kg
                                                </TableCell>
                                                <TableCell className="text-right py-2 tabular-nums">
                                                    {r.dispatched_kg.toLocaleString()} kg
                                                </TableCell>
                                                <TableCell
                                                    className={`text-right py-2 font-semibold tabular-nums ${
                                                        r.over_limit ? "text-rose-700" : "text-slate-700"
                                                    }`}
                                                >
                                                    {r.scrap_pct}%
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableScroller>
                        )}
                            </CardContent>
                        </Card>
            )}

            {liveMode && factoryDispatchRows.length > 0 && (
                <Card className={cn(CARD, "border-l-4 border-l-blue-500 hover:translate-y-0")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-900">Factory scrap sent to vendors (MTD)</CardTitle>
                        <CardDescription className="text-xs">Posted factory scrap dispatches this month.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <TableScroller>
                            <Table noWrapper className="text-sm min-w-[480px]">
                                <TableHeader>
                                    <TableRow className="border-slate-100">
                                        <TableHead className="h-8 text-slate-500">Date</TableHead>
                                        <TableHead className="text-slate-500">Dispatch</TableHead>
                                        <TableHead className="text-slate-500">Vendor</TableHead>
                                        <TableHead className="text-slate-500">Machines</TableHead>
                                        <TableHead className="text-right text-slate-500">Kg</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {factoryDispatchRows
                                        .filter((d) => d.status === "posted")
                                        .slice(0, 12)
                                        .map((d) => (
                                            <TableRow key={d.dispatch_id} className="border-slate-50">
                                                <TableCell className="py-2 text-xs">{d.dispatch_date}</TableCell>
                                                <TableCell className="py-2 font-mono text-xs">{d.dispatch_no}</TableCell>
                                                <TableCell className="py-2 text-xs">{d.vendor_name}</TableCell>
                                                <TableCell className="py-2 text-xs font-mono">{d.machines || "—"}</TableCell>
                                                <TableCell className="text-right py-2 tabular-nums">{d.net_weight.toLocaleString()} kg</TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </TableScroller>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <Card className={cn(CARD, "border-l-4 border-l-emerald-500 hover:translate-y-0")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-900">Scrap from parties</CardTitle>
                        <CardDescription className="text-xs">Who gave you scrap — kg, rate, amount (this month).</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ScrapPartyList
                            rows={scrapFromSources}
                            emptyLabel='No scrap received from parties this month. Post trades with customer as "From".'
                        />
                    </CardContent>
                </Card>
                <Card className={cn(CARD, "border-l-4 border-l-blue-500 hover:translate-y-0")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-900">Scrap to parties</CardTitle>
                        <CardDescription className="text-xs">Who you delivered scrap to — kg, rate, amount.</CardDescription>
                            </CardHeader>
                            <CardContent>
                        <ScrapPartyList rows={scrapToDestinations} emptyLabel="No scrap delivered to parties this month." />
                    </CardContent>
                </Card>
            </div>

            {recentTrades.length > 0 && (
                <Card className={cn(CARD, "hover:translate-y-0 overflow-hidden")}>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-sm font-semibold">Recent scrap trades</CardTitle>
                            <CardDescription className="text-xs">Posted trades with line rates.</CardDescription>
                        </div>
                        <Button variant="outline" size="sm" asChild className="h-8 text-xs shadow-soft">
                            <Link to="/scrap">All trades</Link>
                        </Button>
                    </CardHeader>
                    <CardContent className="p-0">
                        <ul className="divide-y divide-slate-100">
                            {recentTrades.map((t) => (
                                <li
                                    key={t.trade_no}
                                    className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3 text-sm hover:bg-slate-50/80 transition-colors"
                                >
                                    <span className="font-mono text-xs text-blue-600 shrink-0">{t.trade_no}</span>
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1 text-slate-700">
                                        <span className="truncate font-medium">{t.source_name}</span>
                                        <ArrowRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                                        <span className="truncate font-medium">{t.dest_name}</span>
                                </div>
                                    <span className="text-xs text-slate-500 tabular-nums sm:text-right shrink-0">
                                        {t.net_weight.toLocaleString()} kg @ {t.unit_rate.toLocaleString()}/kg · {formatPkr(t.amount)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                            </CardContent>
                        </Card>
            )}

            {lowStockCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-900 bg-amber-50/80 border border-amber-200/80 px-4 py-3 shadow-soft">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    {lowStockCount} item(s) below reorder level in raw material.
                </div>
            )}

            {rodMovements.length > 0 && (
                <SectionCard title="Recent rod purchases">
                    <TableScroller>
                        <Table noWrapper className="text-sm min-w-[480px]">
                            <TableHeader>
                                <TableRow className="border-slate-100">
                                    <TableHead className="h-8 text-slate-500">Date</TableHead>
                                    <TableHead className="text-slate-500">Item</TableHead>
                                    <TableHead className="text-right text-slate-500">Qty</TableHead>
                                    <TableHead className="text-slate-500">Mode</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rodMovements.map((m) => (
                                    <TableRow key={m.id} className="border-slate-50">
                                        <TableCell className="py-2">{new Date(m.at).toLocaleDateString()}</TableCell>
                                        <TableCell className="font-mono text-xs py-2">{m.itemCode}</TableCell>
                                        <TableCell className="text-right py-2">{m.qty.toLocaleString()}</TableCell>
                                        <TableCell className="py-2 capitalize text-xs text-slate-600">
                                            {m.purchaseMode ?? "—"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableScroller>
                </SectionCard>
            )}
        </div>
    );

    const renderPacking = () => (
        <div className="space-y-6">
            <SectionCard
                title="Packing material"
                description="Goats, paper, wrappers, and related items."
                className="relative"
            >
                <div className="flex justify-end mb-3">
                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => openRestock("packing")}>
                        <Package className="h-4 w-4 mr-2" />
                        Restock packing
                    </Button>
                </div>
                <StockTable rows={packing} searchQuery={searchQuery} stockKind="packing" getAvgUnitCost={getAvgUnitCost} />
            </SectionCard>
            <SectionCard title="Restock register">
                <SuppliesRestockPanel
                    kind="packing"
                    refreshKey={restockRefreshKey}
                    onStockChanged={handleSuppliesRestockChanged}
                />
            </SectionCard>
        </div>
    );

    const renderVarnish = () => (
        <div className="space-y-6">
            <SectionCard title="Varnish / chemicals" description="Golden and black varnish — stock in kg; 200 kg per drum. Restock updates weighted avg cost (WAC). Enamel production deducts kg.">
                <div className="flex justify-end mb-3">
                    <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => openRestock("varnish")}>
                        <FlaskConical className="h-4 w-4 mr-2" />
                        Restock varnish
                    </Button>
                </div>
                <StockTable
                    rows={varnish}
                    searchQuery={searchQuery}
                    stockKind="varnish"
                    showUnits
                    getAvgUnitCost={getAvgUnitCost}
                />
            </SectionCard>
            <SectionCard title="Restock register">
                <SuppliesRestockPanel
                    kind="varnish"
                    refreshKey={restockRefreshKey}
                    onStockChanged={handleSuppliesRestockChanged}
                />
            </SectionCard>
        </div>
    );

    const tabPanels: Record<TabId, () => ReactNode> = {
        finished_goods: renderFinished,
        raw_material: renderRawMaterial,
        packing_material: renderPacking,
        varnish: renderVarnish,
        valuation_rates: () => <ValuationRatesPanel />,
    };

    return (
        <DashboardLayout>
            <div className="space-y-6 scrollbar-gutter-stable overflow-x-hidden">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Inventory</h1>
                        <p className="text-slate-500 mt-1">Stock on hand, warehouses, and material movement.</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <Button variant="outline" size="sm" asChild className="shadow-soft border-slate-200">
                            <Link to="/inventory/adjustments">
                                <Scale className="h-4 w-4 mr-2" />
                                Stock adjustments
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="shadow-soft border-slate-200">
                            <Link to={reportLink}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Party movement
                            </Link>
                        </Button>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search code, name, spec…"
                                className="pl-9 h-10 w-full sm:w-[220px] bg-slate-50 border-slate-200"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard
                        label="Valuation"
                        value={totalValuationLabel}
                        sub="Configured valuation rates"
                        icon={Box}
                        iconBg="bg-slate-100 text-black"
                    />
                    <KpiCard
                        label="Active SKUs"
                        value={String(allRows.length)}
                        sub="Across all warehouses"
                        icon={Layers}
                        iconBg="bg-slate-100 text-black"
                    />
                    <KpiCard
                        label="Low stock"
                        value={lowStockCount > 0 ? String(lowStockCount) : "None"}
                        sub={lowStockCount > 0 ? "Below reorder level" : "All above threshold"}
                        icon={TrendingDown}
                        iconBg="bg-slate-100 text-black"
                    />
                    <KpiCard
                        label="Factory scrap (MTD)"
                        value={liveMode ? `${totalFactoryScrapGenerated.toLocaleString()} kg` : "—"}
                        sub={
                            liveMode
                                ? `Generated · Sent ${totalFactoryScrapSent.toLocaleString()} kg · Draw ${factoryScrapByDept.drawing.toLocaleString()} Enam ${factoryScrapByDept.enamel.toLocaleString()} WS ${factoryScrapByDept.workshop.toLocaleString()}`
                                : "Live mode only"
                        }
                        icon={Recycle}
                        iconBg="bg-slate-100 text-black"
                    />
                </div>

                {/* Month strip */}
                <div className="flex flex-wrap gap-x-6 gap-y-2 border border-slate-200/80 bg-white/80 px-4 py-3 shadow-soft text-sm">
                    <span className="text-slate-500 w-full sm:w-auto text-xs font-medium uppercase tracking-wide">
                        This month
                    </span>
                    <span className="text-slate-700">
                        RM scrap in <strong className="text-slate-900">{formatQty(monthRmReceived.scrap)}</strong>
                    </span>
                    <span className="text-slate-700">
                        Wire 8 in <strong className="text-slate-900">{formatQty(monthRmReceived.wire8)}</strong>
                    </span>
                    <span className="text-slate-700">
                        Factory scrap <strong className="text-slate-900">{totalFactoryScrapGenerated.toLocaleString()} kg</strong>
                    </span>
                    <span className="text-slate-700">
                        Sent to vendors <strong className="text-slate-900">{totalFactoryScrapSent.toLocaleString()} kg</strong>
                    </span>
                </div>

                {/* Tabs */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="space-y-4">
                    <Card className="shadow-soft border-slate-100 p-1.5 bg-white">
                        <TabsList className="relative grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 h-auto gap-1 bg-transparent p-0">
                            {INVENTORY_TABS.map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <TabsTrigger
                                        key={tab.id}
                                        value={tab.id}
                                        className={cn(
                                            "relative z-10 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                                            "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                                            "data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:text-slate-800",
                                            "data-[state=active]:text-slate-900",
                                        )}
                                    >
                                        {isActive && (
                                            <motion.span
                                                layoutId="inventory-tab-bg"
                                                className="absolute inset-0 bg-white shadow-sm ring-1 ring-slate-200/80"
                                                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                                            />
                                        )}
                                        <Icon className="h-4 w-4 shrink-0 relative z-10" />
                                        <span className="relative z-10 sm:hidden">{tab.short}</span>
                                        <span className="relative z-10 hidden sm:inline">{tab.label}</span>
                                    </TabsTrigger>
                                );
                            })}
                        </TabsList>
                    </Card>

                    <div className="border border-slate-200/80 bg-white shadow-soft overflow-hidden">
                        <div key={activeTab} role="tabpanel" className="p-4 sm:p-6">
                            {tabPanels[activeTab]()}
                        </div>
                    </div>
                </Tabs>

                <RestockSuppliesDialog
                    open={restockOpen}
                    onOpenChange={setRestockOpen}
                    kind={restockKind}
                    preselectedItemCode={restockItemCode}
                    onSaved={bumpRestockHistory}
                />
            </div>
        </DashboardLayout>
    );
}
