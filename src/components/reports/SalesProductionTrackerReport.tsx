import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
    ReportFilterField,
} from "./ReportPrintPage";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { ItemCombobox, type ItemComboboxGroup } from "@/components/invoices/ItemCombobox";
import {
    fetchSalesDetailReport,
    fetchProductionDetailReport,
    fetchItemLedger,
    fetchWarehousesForFilter,
    type SalesDetailRow,
    type ProductionDetailRow,
    type ItemLedgerRow,
    type WarehouseFilterRow,
} from "@/lib/repositories/reportsRepo";
import { fetchProductionMachines, type ProductionMachineRow } from "@/lib/api/production";
import { getCustomers, getVendors, initPartyCatalog } from "@/lib/partyCatalog";
import {
    getItemCatalog,
    getSalesInvoiceItemGroupLabel,
    type ItemMasterRecord,
} from "@/lib/itemCatalog";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

function reportDefaultRange() {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    return { from: firstOfMonth, to: endOfMonth };
}

const MOVEMENT_LABELS: Record<string, string> = {
    opening: "Opening",
    purchase_in: "Purchase In",
    purchase_return_out: "Purchase Return",
    sales_out: "Sales Out",
    sales_return_in: "Sales Return",
    production_receipt: "Production In",
    production_issue: "Production Issue",
    scrap_in: "Scrap In",
    scrap_out: "Scrap Out",
    adjustment_in: "Adjustment In",
    adjustment_out: "Adjustment Out",
    transfer_in: "Transfer In",
    transfer_out: "Transfer Out",
};

function movementLabel(type: string): string {
    return MOVEMENT_LABELS[type] ?? type;
}

function buildItemComboboxGroups(): ItemComboboxGroup[] {
    const items = getItemCatalog();
    const byGroup = new Map<string, ItemMasterRecord[]>();
    for (const item of items) {
        const label = getSalesInvoiceItemGroupLabel(item);
        const arr = byGroup.get(label) ?? [];
        arr.push(item);
        byGroup.set(label, arr);
    }
    return Array.from(byGroup.entries())
        .map(([label, groupItems]) => ({
            label,
            items: groupItems
                .slice()
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((i) => ({ code: i.code, name: i.name, sizeSpec: i.sizeSpec })),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            {message}
        </div>
    );
}

export default function SalesProductionTrackerReport() {
    return (
        <Tabs defaultValue="sales" className="space-y-4">
            <TabsList className="bg-slate-100 p-1">
                <TabsTrigger value="sales" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    Sales
                </TabsTrigger>
                <TabsTrigger value="production" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    Production
                </TabsTrigger>
                <TabsTrigger value="item" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    Item Tracker
                </TabsTrigger>
            </TabsList>
            <TabsContent value="sales" className="space-y-4">
                <SalesTab />
            </TabsContent>
            <TabsContent value="production" className="space-y-4">
                <ProductionTab />
            </TabsContent>
            <TabsContent value="item" className="space-y-4">
                <ItemTrackerTab />
            </TabsContent>
        </Tabs>
    );
}

// ---------------------------------------------------------------------------
// Sales tab
// ---------------------------------------------------------------------------

function SalesTab() {
    const { toast } = useToast();
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [partyCode, setPartyCode] = useState<string>("all");
    const [itemCode, setItemCode] = useState<string>("");
    const [sizeSpec, setSizeSpec] = useState<string>("");
    const [rows, setRows] = useState<SalesDetailRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);

    const parties = useMemo(() => [...getCustomers(), ...getVendors()], []);
    const partyOptions = useMemo(() => toPartyComboboxOptions(parties), [parties]);

    useEffect(() => {
        void initPartyCatalog();
    }, []);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({ title: "Demo mode", description: "Sign in with live ERP to load sales.", variant: "destructive" });
                setRows([]);
                return;
            }
            const data = await fetchSalesDetailReport({
                from: dateFrom,
                to: dateTo,
                partyCode: partyCode === "all" ? undefined : partyCode,
                itemCode: itemCode.trim() || undefined,
                sizeSpec: sizeSpec.trim() || undefined,
            });
            setRows(data);
        } catch (e) {
            toast({ title: "Report failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, r) => {
                acc.netWeight += Number(r.net_weight) || 0;
                acc.units += Number(r.unit_count) || 0;
                acc.amount += Number(r.line_amount) || 0;
                return acc;
            },
            { netWeight: 0, units: 0, amount: 0 },
        );
    }, [rows]);

    return (
        <div className="space-y-4">
            <ReportPrintControls actions={show && !loading && rows.length > 0 ? <ReportPrintButton /> : null}>
                <ReportFilterField label="From">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="Party">
                    <PartyCombobox
                        value={partyCode}
                        onValueChange={setPartyCode}
                        options={partyOptions}
                        placeholder="All parties"
                        leadingOptions={[{ value: "all", label: "All parties" }]}
                        showCode
                        className="h-8"
                    />
                </ReportFilterField>
                <ReportFilterField label="Item code">
                    <Input
                        value={itemCode}
                        onChange={(e) => setItemCode(e.target.value)}
                        placeholder="e.g. FG-ENW-023"
                        className="h-8 w-40"
                    />
                </ReportFilterField>
                <ReportFilterField label="Size">
                    <Input
                        value={sizeSpec}
                        onChange={(e) => setSizeSpec(e.target.value)}
                        placeholder="e.g. SWG 23"
                        className="h-8 w-32"
                    />
                </ReportFilterField>
                <Button size="sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
            </ReportPrintControls>

            {show && !loading && rows.length === 0 && <EmptyState message="No posted sales in this period." />}

            {show && !loading && rows.length > 0 && (
                <ReportPrintDocument reportTitle="Sales Detail" dateFrom={dateFrom} dateTo={dateTo}>
                    <ReportTable className="min-w-[900px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Date</th>
                                <th className="py-2 px-2 text-left">Doc</th>
                                <th className="py-2 px-2 text-left">Type</th>
                                <th className="py-2 px-2 text-left">Party</th>
                                <th className="py-2 px-2 text-left">Item</th>
                                <th className="py-2 px-2 text-left">Size</th>
                                <th className="py-2 px-2 text-right">Net kg</th>
                                <th className="py-2 px-2 text-right">Units</th>
                                <th className="py-2 px-2 text-right">Rate</th>
                                <th className="py-2 px-2 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr
                                    key={`${r.doc_no}-${i}`}
                                    className={cn("border-b border-slate-100", r.direction === "return" && "text-rose-700")}
                                >
                                    <td className="py-1.5 px-2 font-mono">{r.doc_date}</td>
                                    <td className="py-1.5 px-2 font-mono">{r.doc_no}</td>
                                    <td className="py-1.5 px-2 capitalize">{r.direction}</td>
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-xs text-slate-500">{r.party_code}</span> {r.party_name}
                                    </td>
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-xs text-slate-500">{r.item_code}</span> {r.item_name}
                                    </td>
                                    <td className="py-1.5 px-2">{r.size_spec ?? "—"}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{Number(r.net_weight).toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{Number(r.unit_count).toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{Number(r.unit_price).toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{Number(r.line_amount).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-slate-800 bg-slate-50 font-semibold">
                                <td className="py-2 px-2" colSpan={6}>
                                    Totals ({rows.length} rows)
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{totals.netWeight.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right font-mono">{totals.units.toLocaleString()}</td>
                                <td className="py-2 px-2" />
                                <td className="py-2 px-2 text-right font-mono">{totals.amount.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Production tab
// ---------------------------------------------------------------------------

function ProductionTab() {
    const { toast } = useToast();
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [machineId, setMachineId] = useState<string>("all");
    const [department, setDepartment] = useState<string>("all");
    const [sizeSpec, setSizeSpec] = useState<string>("");
    const [machines, setMachines] = useState<ProductionMachineRow[]>([]);
    const [rows, setRows] = useState<ProductionDetailRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (!isErpLiveMode()) return;
        void fetchProductionMachines()
            .then((m) => setMachines(m))
            .catch(() => setMachines([]));
    }, []);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({ title: "Demo mode", description: "Sign in with live ERP to load production.", variant: "destructive" });
                setRows([]);
                return;
            }
            const data = await fetchProductionDetailReport({
                from: dateFrom,
                to: dateTo,
                machineId: machineId === "all" ? undefined : machineId,
                sizeSpec: sizeSpec.trim() || undefined,
                department: department === "all" ? undefined : department,
            });
            setRows(data);
        } catch (e) {
            toast({ title: "Report failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    // Group rows by machine (null machine grouped under "Unassigned").
    const grouped = useMemo(() => {
        const map = new Map<string, { machine: ProductionDetailRow | null; lines: ProductionDetailRow[] }>();
        for (const r of rows) {
            const key = r.machine_id ?? "__none__";
            const existing = map.get(key);
            if (existing) {
                existing.lines.push(r);
            } else {
                map.set(key, { machine: r, lines: [r] });
            }
        }
        return Array.from(map.values());
    }, [rows]);

    const grandTotals = useMemo(() => {
        return rows.reduce(
            (acc, r) => {
                acc.netWeight += Number(r.net_weight) || 0;
                acc.units += Number(r.unit_count) || 0;
                return acc;
            },
            { netWeight: 0, units: 0 },
        );
    }, [rows]);

    return (
        <div className="space-y-4">
            <ReportPrintControls actions={show && !loading && rows.length > 0 ? <ReportPrintButton /> : null}>
                <ReportFilterField label="From">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="Machine">
                    <Select value={machineId} onValueChange={setMachineId}>
                        <SelectTrigger className="h-8 w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All machines</SelectItem>
                            {machines.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                    {m.machine_code} — {m.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <ReportFilterField label="Dept">
                    <Select value={department} onValueChange={setDepartment}>
                        <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="drawing">Drawing</SelectItem>
                            <SelectItem value="enamel">Enamel</SelectItem>
                            <SelectItem value="workshop">Workshop</SelectItem>
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <ReportFilterField label="Size">
                    <Input
                        value={sizeSpec}
                        onChange={(e) => setSizeSpec(e.target.value)}
                        placeholder="e.g. SWG 23"
                        className="h-8 w-32"
                    />
                </ReportFilterField>
                <Button size="sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
            </ReportPrintControls>

            {show && !loading && rows.length === 0 && <EmptyState message="No posted production in this period." />}

            {show && !loading && rows.length > 0 && (
                <ReportPrintDocument reportTitle="Production Detail" dateFrom={dateFrom} dateTo={dateTo} groupedBy="Machine">
                    <ReportTable className="min-w-[900px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Date</th>
                                <th className="py-2 px-2 text-left">Batch</th>
                                <th className="py-2 px-2 text-left">Line</th>
                                <th className="py-2 px-2 text-left">Item</th>
                                <th className="py-2 px-2 text-left">Size</th>
                                <th className="py-2 px-2 text-right">Net kg</th>
                                <th className="py-2 px-2 text-right">Units</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grouped.map((g, gi) => {
                                const subtotal = g.lines.reduce(
                                    (acc, r) => {
                                        acc.netWeight += Number(r.net_weight) || 0;
                                        acc.units += Number(r.unit_count) || 0;
                                        return acc;
                                    },
                                    { netWeight: 0, units: 0 },
                                );
                                const machineLabel = g.machine?.machine_code
                                    ? `${g.machine.machine_code} — ${g.machine.machine_name ?? ""} (${g.machine.department ?? ""})`
                                    : "Unassigned";
                                return (
                                    <ProductionMachineGroup
                                        key={g.machine?.machine_id ?? `__none_${gi}__`}
                                        label={machineLabel}
                                        lines={g.lines}
                                        subtotal={subtotal}
                                    />
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-slate-800 bg-slate-50 font-semibold">
                                <td className="py-2 px-2" colSpan={5}>
                                    Grand total ({rows.length} lines)
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{grandTotals.netWeight.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right font-mono">{grandTotals.units.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}

function ProductionMachineGroup({
    label,
    lines,
    subtotal,
}: {
    label: string;
    lines: ProductionDetailRow[];
    subtotal: { netWeight: number; units: number };
}) {
    return (
        <>
            <tr className="bg-slate-200/70 border-b border-slate-300">
                <td className="py-1.5 px-2 font-semibold text-slate-800" colSpan={7}>
                    {label}
                </td>
            </tr>
            {lines.map((r, i) => (
                <tr key={`${r.batch_no}-${i}`} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 font-mono">{r.batch_date}</td>
                    <td className="py-1.5 px-2 font-mono">{r.batch_no}</td>
                    <td className="py-1.5 px-2 capitalize">{r.line_type}</td>
                    <td className="py-1.5 px-2">
                        <span className="font-mono text-xs text-slate-500">{r.item_code}</span> {r.item_name}
                    </td>
                    <td className="py-1.5 px-2">{r.size_spec ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{Number(r.net_weight).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{Number(r.unit_count).toLocaleString()}</td>
                </tr>
            ))}
            <tr className="bg-slate-50 border-b-2 border-slate-300 font-semibold">
                <td className="py-1.5 px-2" colSpan={5}>
                    Subtotal — {label}
                </td>
                <td className="py-1.5 px-2 text-right font-mono">{subtotal.netWeight.toLocaleString()}</td>
                <td className="py-1.5 px-2 text-right font-mono">{subtotal.units.toLocaleString()}</td>
            </tr>
        </>
    );
}

// ---------------------------------------------------------------------------
// Item tracker tab
// ---------------------------------------------------------------------------

function ItemTrackerTab() {
    const { toast } = useToast();
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [itemCode, setItemCode] = useState<string>("");
    const [warehouseId, setWarehouseId] = useState<string>("all");
    const [warehouses, setWarehouses] = useState<WarehouseFilterRow[]>([]);
    const [rows, setRows] = useState<ItemLedgerRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);

    const itemGroups = useMemo(() => buildItemComboboxGroups(), []);

    useEffect(() => {
        if (!isErpLiveMode()) return;
        void fetchWarehousesForFilter()
            .then((w) => setWarehouses(w))
            .catch(() => setWarehouses([]));
    }, []);

    const handleGenerate = async () => {
        if (!itemCode.trim()) {
            toast({ title: "Item required", description: "Pick an item to track.", variant: "destructive" });
            return;
        }
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({ title: "Demo mode", description: "Sign in with live ERP to load ledger.", variant: "destructive" });
                setRows([]);
                return;
            }
            const data = await fetchItemLedger({
                from: dateFrom,
                to: dateTo,
                itemCode: itemCode.trim(),
                warehouseId: warehouseId === "all" ? undefined : warehouseId,
            });
            setRows(data);
        } catch (e) {
            toast({ title: "Report failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, r) => {
                acc.qtyIn += Number(r.qty_in) || 0;
                acc.qtyOut += Number(r.qty_out) || 0;
                acc.unitsIn += Number(r.units_in) || 0;
                acc.unitsOut += Number(r.units_out) || 0;
                return acc;
            },
            { qtyIn: 0, qtyOut: 0, unitsIn: 0, unitsOut: 0 },
        );
    }, [rows]);

    return (
        <div className="space-y-4">
            <ReportPrintControls actions={show && !loading && rows.length > 0 ? <ReportPrintButton /> : null}>
                <ReportFilterField label="Item">
                    <ItemCombobox
                        value={itemCode}
                        onSelect={setItemCode}
                        groups={itemGroups}
                        placeholder="Pick an item"
                        className="h-8 w-56"
                    />
                </ReportFilterField>
                <ReportFilterField label="From">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="Warehouse">
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                        <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All warehouses</SelectItem>
                            {warehouses.map((w) => (
                                <SelectItem key={w.id} value={w.id}>
                                    {w.code} — {w.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <Button size="sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
            </ReportPrintControls>

            {show && !loading && rows.length === 0 && <EmptyState message="No movements for this item in the period." />}

            {show && !loading && rows.length > 0 && (
                <ReportPrintDocument
                    reportTitle="Item Ledger"
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    meta={[{ label: "Item", value: itemCode }]}
                >
                    <ReportTable className="min-w-[860px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Date</th>
                                <th className="py-2 px-2 text-left">Type</th>
                                <th className="py-2 px-2 text-left">Ref / Doc</th>
                                <th className="py-2 px-2 text-left">Party</th>
                                <th className="py-2 px-2 text-right">Qty In</th>
                                <th className="py-2 px-2 text-right">Qty Out</th>
                                <th className="py-2 px-2 text-right">Units In</th>
                                <th className="py-2 px-2 text-right">Units Out</th>
                                <th className="py-2 px-2 text-right">Bal kg</th>
                                <th className="py-2 px-2 text-right">Bal units</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const refNo = r.source_doc_no && r.source_doc_no !== "" ? r.source_doc_no : null;
                                const extraRef = r.reference_no && r.reference_no !== "" && r.reference_no !== refNo ? r.reference_no : null;
                                return (
                                    <tr
                                        key={`${r.posting_date}-${i}`}
                                        className={cn(
                                            "border-b border-slate-100",
                                            r.movement_type === "opening" && "bg-amber-50 font-semibold",
                                        )}
                                    >
                                        <td className="py-1.5 px-2 font-mono">{r.posting_date}</td>
                                        <td className="py-1.5 px-2">{movementLabel(r.movement_type)}</td>
                                        <td className="py-1.5 px-2 font-mono text-xs">
                                            {refNo ? (
                                                <span className="text-slate-700">{refNo}</span>
                                            ) : (
                                                <span className="text-slate-400">—</span>
                                            )}
                                            {extraRef ? <span className="text-slate-400"> · {extraRef}</span> : null}
                                        </td>
                                        <td className="py-1.5 px-2">
                                            {r.party_code ? (
                                                <>
                                                    <span className="font-mono text-xs text-slate-500">{r.party_code}</span> {r.party_name}
                                                </>
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-mono">{Number(r.qty_in).toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{Number(r.qty_out).toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{Number(r.units_in).toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{Number(r.units_out).toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{Number(r.running_qty).toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{Number(r.running_units).toLocaleString()}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-slate-800 bg-slate-50 font-semibold">
                                <td className="py-2 px-2" colSpan={4}>
                                    Period totals ({rows.length} rows)
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{totals.qtyIn.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right font-mono">{totals.qtyOut.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right font-mono">{totals.unitsIn.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right font-mono">{totals.unitsOut.toLocaleString()}</td>
                                <td className="py-2 px-2" colSpan={2} />
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
