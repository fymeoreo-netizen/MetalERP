import { useMemo, useState, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import {
    ReportPrintButton,
    ReportFilterField,
    ReportPrintDocument,
} from "./ReportPrintPage";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { Table } from "@/components/ui/table";
import { ReportLoadState } from "./ReportLoadState";
import { useInventory } from "@/contexts/InventoryContext";
import {
    getFinishedGoodsStore,
    getInventorySection,
    itemTracksUnitCount,
    type InventorySection,
} from "@/lib/itemCatalog";
import { fetchStockValuation, type StockValuationRow } from "@/lib/repositories/reportsRepo";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useInventoryValuationRates } from "@/hooks/useErpQueries";
import { resolveInventoryValuationRateForItem } from "@/lib/inventoryValuationValidation";
import { formatReportAmount } from "@/lib/reportPrintConfig";
import { defaultDrumWeightKg, kgToVarnishDrums } from "@/lib/suppliesRestock";
import { cn } from "@/lib/utils";

type DisplayRow = {
    code: string;
    item: string;
    warehouse: string;
    section: InventorySection | string;
    remainQty: number;
    remainUnits: number;
    tracksUnits: boolean;
    bookUnitCost: number;
    bookValue: number;
    valuationRate: number | null;
    valuationValue: number;
};

const SECTION_ORDER: InventorySection[] = [
    "fg_enameled",
    "fg_strip",
    "fg_copper_wire",
    "rm_scrap",
    "rm_wire8",
    "rm_rod",
    "packing",
    "varnish",
];

const SECTION_LABELS: Record<string, string> = {
    fg_enameled: "Finished Goods — Enameled Wire",
    fg_strip: "Finished Goods — Copper Strip",
    fg_copper_wire: "Finished Goods — Copper Wire",
    rm_scrap: "Raw Material — Scrap",
    rm_wire8: "Raw Material — Wire No 8",
    rm_rod: "Raw Material — Copper Rod",
    packing: "Packing Material",
    varnish: "Varnish",
};

const SECTION_SHORT_LABELS: Record<string, string> = {
    fg_enameled: "Enameled wire",
    fg_strip: "Copper strip",
    fg_copper_wire: "Copper wire",
    rm_scrap: "Scrap",
    rm_wire8: "Wire no 8",
    rm_rod: "Copper rod",
    packing: "Packing",
    varnish: "Varnish",
};

const SECTION_GROUPS: { id: string; label: string; sections: InventorySection[] }[] = [
    {
        id: "fg",
        label: "Finished goods",
        sections: ["fg_enameled", "fg_strip", "fg_copper_wire"],
    },
    {
        id: "rm",
        label: "Raw material",
        sections: ["rm_scrap", "rm_wire8", "rm_rod"],
    },
    {
        id: "supplies",
        label: "Supplies",
        sections: ["packing", "varnish"],
    },
];

const NUM = "text-right tabular-nums";
const EMPTY = "text-right text-slate-400";

function warehouseLabel(section: InventorySection | string): string {
    switch (section) {
        case "fg_enameled":
            return "FG Enameled Wire Store";
        case "fg_strip":
            return "FG Copper Strip Store";
        case "fg_copper_wire":
            return "FG Copper Wire Store";
        case "rm_scrap":
            return "Raw — Scrap";
        case "rm_wire8":
            return "Raw — Wire No 8";
        case "rm_rod":
            return "Raw — Copper Rod";
        case "packing":
            return "Packing Material";
        case "varnish":
            return "Varnish";
        default:
            return "General";
    }
}

function formatBookMoney(value: number, liveMode: boolean): string {
    if (!liveMode) return "—";
    if (value === 0) return "₨ 0";
    return `₨ ${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
}

function formatValuationMoney(value: number): string {
    return formatReportAmount(value, { showZero: false });
}

function formatValuationRate(rate: number | null): string {
    if (rate == null || rate === 0) return "—";
    return `₨ ${rate.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
}

function formatQtyKg(value: number): string {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

function formatUnits(value: number, tracksUnits: boolean): string {
    if (!tracksUnits || value === 0) return "—";
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function mapLiveRow(r: StockValuationRow): DisplayRow {
    const section = r.inventory_section || "varnish";
    const tracksUnits = [
        "fg_enameled",
        "fg_strip",
        "fg_copper_wire",
        "rm_scrap",
        "rm_wire8",
        "rm_rod",
        "varnish",
    ].includes(section);
    return {
        code: r.item_code,
        item: r.item_name,
        warehouse: r.warehouse_code || warehouseLabel(section),
        section,
        remainQty: Number(r.on_hand_qty),
        remainUnits: Number(r.on_hand_units ?? 0),
        tracksUnits,
        bookUnitCost: Number(r.book_unit_cost),
        bookValue: Number(r.book_value),
        valuationRate: r.valuation_unit_rate != null ? Number(r.valuation_unit_rate) : null,
        valuationValue: Number(r.valuation_value ?? 0),
    };
}

function SubtotalCells({
    label,
    onHandKg,
    onHandUnits,
    tracksUnitsInSection,
    bookTotal,
    valTotal,
    liveMode,
}: {
    label: string;
    onHandKg: number;
    onHandUnits: number;
    tracksUnitsInSection: boolean;
    bookTotal: number;
    valTotal: number;
    liveMode: boolean;
}) {
    return (
        <tr className="report-row-total border-b border-slate-200">
            <td colSpan={3} className={`${NUM} font-medium text-slate-700`}>
                {label} — Total
            </td>
            <td className={`${NUM} font-semibold`}>{formatQtyKg(onHandKg)}</td>
            <td className={`${NUM} font-semibold`}>{formatUnits(onHandUnits, tracksUnitsInSection)}</td>
            <td className={EMPTY}>—</td>
            <td className={`${NUM} font-semibold`}>{formatBookMoney(bookTotal, liveMode)}</td>
            <td className={EMPTY}>—</td>
            <td className={`${NUM} font-semibold`}>{formatValuationMoney(valTotal)}</td>
        </tr>
    );
}

function defaultSelectedSections(): Set<string> {
    return new Set(SECTION_ORDER);
}

export default function StockValuationReport() {
    const [show, setShow] = useState(false);
    const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
    const [selectedSections, setSelectedSections] = useState<Set<string>>(defaultSelectedSections);
    const [searchQuery, setSearchQuery] = useState("");
    const { catalog, getBalance, getUnitBalance } = useInventory();
    const liveMode = useBackendLiveMode();
    const { data: valuationRates = [] } = useInventoryValuationRates();
    const [liveRows, setLiveRows] = useState<StockValuationRow[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        setShow(true);
        setError(null);
        if (!liveMode) {
            setLiveRows(null);
            return;
        }
        setLoading(true);
        try {
            const rows = await fetchStockValuation(asOf);
            setLiveRows(rows);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load stock valuation.";
            setError(message);
            setLiveRows(null);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const rows = useMemo((): DisplayRow[] => {
        if (liveMode) {
            if (!liveRows) return [];
            return liveRows.map(mapLiveRow);
        }
        return catalog.flatMap((item) => {
            const remainQty = getBalance(item.code);
            const remainUnitsRaw = getUnitBalance(item.code);
            if (remainQty === 0 && remainUnitsRaw === 0) return [];
            const section = getInventorySection(item);
            const remainUnits =
                section === "varnish" && remainUnitsRaw <= 0 && remainQty > 0
                    ? kgToVarnishDrums(remainQty, defaultDrumWeightKg(item))
                    : remainUnitsRaw;
            const valuationRate = resolveInventoryValuationRateForItem(item, valuationRates, asOf);
            const valuationValue = remainQty * (valuationRate ?? 0);
            return [
                {
                    code: item.code,
                    item: `${item.name} (${item.sizeSpec})`,
                    warehouse: getFinishedGoodsStore(item)
                        ? getFinishedGoodsStore(item) === "STORE_FG_ENAMELED"
                            ? "FG Enameled Wire Store"
                            : "FG Copper Strip Store"
                        : warehouseLabel(section),
                    section,
                    remainQty,
                    remainUnits,
                    tracksUnits: itemTracksUnitCount(item),
                    bookUnitCost: 0,
                    bookValue: 0,
                    valuationRate,
                    valuationValue,
                },
            ];
        });
    }, [catalog, getBalance, getUnitBalance, liveMode, liveRows, valuationRates, asOf]);

    const filteredRows = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return rows.filter((row) => {
            if (!selectedSections.has(String(row.section))) return false;
            if (!q) return true;
            return (
                row.code.toLowerCase().includes(q) ||
                row.item.toLowerCase().includes(q) ||
                row.warehouse.toLowerCase().includes(q)
            );
        });
    }, [rows, selectedSections, searchQuery]);

    const grouped = useMemo(() => {
        const map = new Map<string, DisplayRow[]>();
        for (const row of filteredRows) {
            const key = String(row.section);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(row);
        }
        const orderedKeys = [
            ...SECTION_ORDER.filter((s) => map.has(s)),
            ...[...map.keys()].filter((k) => !SECTION_ORDER.includes(k as InventorySection)),
        ];
        return orderedKeys.map((section) => ({
            section,
            label: SECTION_LABELS[section] ?? section,
            rows: map.get(section) ?? [],
        }));
    }, [filteredRows]);

    const toggleSection = (section: string) => {
        setSelectedSections((prev) => {
            const next = new Set(prev);
            if (next.has(section)) next.delete(section);
            else next.add(section);
            return next;
        });
    };

    const applyCategoryPreset = (preset: "all" | "fg" | "rm" | "supplies") => {
        if (preset === "all") {
            setSelectedSections(defaultSelectedSections());
            return;
        }
        const group = SECTION_GROUPS.find((g) => g.id === preset);
        if (group) setSelectedSections(new Set(group.sections));
    };

    const grandBook = filteredRows.reduce((s, r) => s + r.bookValue, 0);
    const grandValuation = filteredRows.reduce((s, r) => s + r.valuationValue, 0);
    const totalOnHand = filteredRows.reduce((s, r) => s + r.remainQty, 0);
    const totalOnHandUnits = filteredRows.reduce((s, r) => s + r.remainUnits, 0);
    const hasUnitTrackedRows = filteredRows.some((r) => r.tracksUnits);
    const hasData = filteredRows.length > 0;
    const allSectionsSelected = SECTION_ORDER.every((s) => selectedSections.has(s));
    const noneSelected = selectedSections.size === 0;

    return (
        <div className="space-y-4">
            <Card className="shadow-soft border-slate-100 print:hidden">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Stock valuation</CardTitle>
                    <CardDescription>
                        On-hand inventory valued at book WAC and configured valuation rates. Filter by stock
                        category before or after generating.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant={allSectionsSelected ? "default" : "outline"}
                            size="sm"
                            className={cn(allSectionsSelected && "bg-blue-600 hover:bg-blue-700")}
                            onClick={() => applyCategoryPreset("all")}
                        >
                            All stock
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applyCategoryPreset("fg")}
                        >
                            Finished goods
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applyCategoryPreset("rm")}
                        >
                            Raw material
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applyCategoryPreset("supplies")}
                        >
                            Supplies
                        </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <ReportFilterField label="As of date">
                            <Input
                                id="sv-as-of"
                                type="date"
                                className="h-9"
                                value={asOf}
                                onChange={(e) => setAsOf(e.target.value)}
                            />
                        </ReportFilterField>
                        <ReportFilterField label="Search items" className="sm:col-span-2 lg:col-span-1">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    id="sv-search"
                                    type="search"
                                    placeholder="Code, name, or warehouse…"
                                    className="h-9 pl-9 pr-9"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                                {searchQuery ? (
                                    <button
                                        type="button"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                                        onClick={() => setSearchQuery("")}
                                        aria-label="Clear search"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                ) : null}
                            </div>
                        </ReportFilterField>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                                Stock categories
                            </p>
                            <p className="text-xs text-slate-500 tabular-nums">
                                {selectedSections.size} of {SECTION_ORDER.length} selected
                                {show && rows.length > 0 ? ` · ${filteredRows.length} items shown` : ""}
                            </p>
                        </div>
                        {SECTION_GROUPS.map((group) => (
                            <div key={group.id} className="space-y-2">
                                <p className="text-sm font-medium text-slate-700">{group.label}</p>
                                <div className="flex flex-wrap gap-2">
                                    {group.sections.map((section) => {
                                        const active = selectedSections.has(section);
                                        return (
                                            <Button
                                                key={section}
                                                type="button"
                                                size="sm"
                                                variant={active ? "default" : "outline"}
                                                className={cn(
                                                    "h-8 rounded-full px-3.5 text-xs font-medium shadow-none",
                                                    active
                                                        ? "bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                                                        : "bg-white text-slate-700 hover:bg-slate-100 border-slate-200",
                                                )}
                                                onClick={() => toggleSection(section)}
                                            >
                                                {SECTION_SHORT_LABELS[section]}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                            className="bg-blue-600 hover:bg-blue-700"
                            onClick={() => void handleGenerate()}
                            disabled={loading || noneSelected}
                        >
                            <Search className="h-4 w-4 mr-2" />
                            {loading ? "Loading…" : "Generate report"}
                        </Button>
                        {show && !loading && !error && hasData ? <ReportPrintButton /> : null}
                        {noneSelected ? (
                            <span className="text-xs text-amber-700">Select at least one stock category.</span>
                        ) : null}
            </div>

                    <ReportLoadState
                        loading={show && loading}
                        error={show && !loading ? error : null}
                        empty={show && !loading && !error && !hasData}
                        emptyMessage={
                            rows.length > 0 && filteredRows.length === 0
                                ? "No items match the selected stock categories or search."
                                : "No inventory on hand to value."
                        }
                    />
                </CardContent>
            </Card>

            {show && !loading && !error && hasData && (
                <ReportPrintDocument
                    reportTitle="Stock Valuation Report"
                    subtitle={
                        liveMode
                            ? "Book WAC from ledger · Valuation from Inventory → Valuation rates"
                            : "Demo inventory · Valuation from configured rates (book WAC N/A offline)"
                    }
                    density="compact"
                    asOfDate={asOf}
                    className="max-w-full"
                >
                    <TableScroller className="w-full">
                        <Table noWrapper className="report-table report-table--compact w-full min-w-[900px]">
                        <thead>
                            <tr>
                                <th>Item Code</th>
                                <th>Description</th>
                                <th>Warehouse</th>
                                <th className="text-right">On Hand (kg)</th>
                                <th className="text-right">Units</th>
                                <th className="text-right">Book WAC</th>
                                <th className="text-right">Book Value</th>
                                <th className="text-right">Val. Rate</th>
                                <th className="text-right">Val. Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grouped.map((group) => {
                                const subBook = group.rows.reduce((s, r) => s + r.bookValue, 0);
                                const subVal = group.rows.reduce((s, r) => s + r.valuationValue, 0);
                                const subOnHand = group.rows.reduce((s, r) => s + r.remainQty, 0);
                                const subUnits = group.rows.reduce((s, r) => s + r.remainUnits, 0);
                                const tracksUnitsInSection = group.rows.some((r) => r.tracksUnits);
                                return (
                                    <Fragment key={group.section}>
                                        <tr className="report-group-header">
                                            <td colSpan={9}>{group.label}</td>
                                        </tr>
                                        {group.rows.map((r) => (
                                            <tr key={`${r.code}-${r.warehouse}`}>
                                                <td className="font-mono text-xs">{r.code}</td>
                                                <td>{r.item}</td>
                                                <td className="text-xs">{r.warehouse}</td>
                                                <td className={NUM}>{formatQtyKg(r.remainQty)}</td>
                                                <td className={NUM}>{formatUnits(r.remainUnits, r.tracksUnits)}</td>
                                                <td className={NUM}>{formatBookMoney(r.bookUnitCost, liveMode)}</td>
                                                <td className={NUM}>{formatBookMoney(r.bookValue, liveMode)}</td>
                                                <td className={NUM}>{formatValuationRate(r.valuationRate)}</td>
                                                <td className={`${NUM} font-medium`}>
                                                    {formatValuationMoney(r.valuationValue)}
                                                </td>
                                </tr>
                            ))}
                                        <SubtotalCells
                                            label={group.label}
                                            onHandKg={subOnHand}
                                            onHandUnits={subUnits}
                                            tracksUnitsInSection={tracksUnitsInSection}
                                            bookTotal={subBook}
                                            valTotal={subVal}
                                            liveMode={liveMode}
                                        />
                                    </Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="report-row-total">
                                <td colSpan={3} className={`${NUM} font-bold`}>
                                    Grand Total — Selected Stock
                                </td>
                                <td className={`${NUM} font-bold`}>{formatQtyKg(totalOnHand)}</td>
                                <td className={`${NUM} font-bold`}>
                                    {formatUnits(totalOnHandUnits, hasUnitTrackedRows)}
                                </td>
                                <td className={EMPTY}>—</td>
                                <td className={`${NUM} font-bold`}>{formatBookMoney(grandBook, liveMode)}</td>
                                <td className={EMPTY}>—</td>
                                <td className={`${NUM} font-bold`}>
                                    {formatReportAmount(grandValuation, { showZero: true })}
                                </td>
                            </tr>
                        </tfoot>
                    </Table>
                    </TableScroller>
                </ReportPrintDocument>
            )}
        </div>
    );
}
