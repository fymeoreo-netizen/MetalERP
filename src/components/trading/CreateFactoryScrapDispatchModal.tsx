import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { ChevronDown, ChevronUp, Loader2, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import { getSuppliers, initPartyCatalog } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { useToast } from "@/components/ui/use-toast";
import { thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import { fetchProductionMachines, type ProductionMachineRow } from "@/lib/api/production";
import { resolveCanonicalWire8ItemCode } from "@/lib/api/purchaseInvoices";
import type { FactoryScrapDispatchLinePayload, FactoryScrapDispatchRow } from "@/lib/api/scrap";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { cn } from "@/lib/utils";

export type FactoryScrapDispatchFormPayload = {
    dispatchNo: string;
    dispatchDate: string;
    destPartyCode: string;
    mode: "toll" | "sale";
    expectedReturnItemCode?: string;
    expectedReturnKg?: number;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    unitRate: number;
    amount: number;
    biltyNo?: string;
    vehicleNo?: string;
    remarks?: string;
    lines: FactoryScrapDispatchLinePayload[];
};

type LineDraft = {
    machineId: string;
    department: "drawing" | "enamel" | "workshop";
    itemCode: string;
    grossWeight: string;
    tareWeight: string;
    netWeight: string;
    expanded: boolean;
};

/** Parent RM deducted at dispatch (backflush) — derived from department. */
function parentRmLabelForDepartment(
    department: LineDraft["department"],
    wire8Code: string,
): string {
    if (department === "workshop") return "Copper Rod (RM-CR-001)";
    return `Wire No 8 (${wire8Code})`;
}

function lineNetFromWeighment(gross: string, tare: string, fallbackNet: string): number {
    const g = parseFloat(gross);
    const t = parseFloat(tare) || 0;
    if (Number.isFinite(g) && g > 0) return Math.max(0, g - t);
    return Math.max(0, parseFloat(fallbackNet) || 0);
}

const DEFAULT_RETURN_ITEMS = [
    { code: "RM-W8-001", label: "Wire No 8" },
    { code: "RM-CR-001", label: "Copper Rod 8 mm" },
];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialData?: FactoryScrapDispatchRow | null;
    suggestedNo?: string;
    onSubmit?: (data: FactoryScrapDispatchFormPayload, action: "draft" | "post") => boolean | Promise<boolean>;
}

export function CreateFactoryScrapDispatchModal({
    open,
    onOpenChange,
    initialData,
    suggestedNo,
    onSubmit,
}: Props) {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const [submitting, setSubmitting] = useState(false);
    const [formExpanded, setFormExpanded] = useState(true);
    const [vendors, setVendors] = useState(() => getSuppliers());
    const [machines, setMachines] = useState<ProductionMachineRow[]>([]);
    const [lineDept, setLineDept] = useState<"drawing" | "enamel" | "workshop">("drawing");

    const [dispatchNo, setDispatchNo] = useState("");
    const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split("T")[0]);
    const [vendorCode, setVendorCode] = useState("");
    const [mode, setMode] = useState<"toll" | "sale">("toll");
    const [expectedReturnItemCode, setExpectedReturnItemCode] = useState("RM-W8-001");
    const [biltyNo, setBiltyNo] = useState("");
    const [vehicleNo, setVehicleNo] = useState("");
    const [grossWeight, setGrossWeight] = useState("");
    const [tareWeight, setTareWeight] = useState("");
    const [rate, setRate] = useState("");
    const [remarks, setRemarks] = useState("");
    const [lines, setLines] = useState<LineDraft[]>([]);
    const [linesRef] = useAutoAnimate<HTMLDivElement>();
    const [returnItems, setReturnItems] = useState(DEFAULT_RETURN_ITEMS);

    useEffect(() => {
        if (!open) return;
        void initPartyCatalog().then(() => setVendors(getSuppliers()));
        if (liveMode) {
            void fetchProductionMachines().then(setMachines);
            void resolveCanonicalWire8ItemCode().then((wire8Code) => {
                setReturnItems([
                    { code: wire8Code, label: "Wire No 8" },
                    { code: "RM-CR-001", label: "Copper Rod 8 mm" },
                ]);
                setExpectedReturnItemCode((prev) =>
                    prev === "RM-W8-001" || prev.startsWith("RM-W8-") ? wire8Code : prev,
                );
            });
        }
    }, [open, liveMode]);

    useEffect(() => {
        if (!open) return;
        setFormExpanded(true);
        if (initialData) {
            setDispatchNo(initialData.dispatch_no);
            setDispatchDate(initialData.dispatch_date);
            setVendorCode(initialData.dest_party_code ?? "");
            setMode(initialData.mode);
            setExpectedReturnItemCode(initialData.expected_return_item_code ?? "RM-W8-001");
            setBiltyNo(initialData.bilty_no ?? "");
            setVehicleNo(initialData.vehicle_no ?? "");
            setGrossWeight(String(initialData.gross_weight));
            setTareWeight(String(initialData.tare_weight));
            setRate(String(initialData.unit_rate));
            setRemarks(initialData.remarks ?? "");
            setLines(
                (initialData.lines ?? []).map((l) => {
                    const tare = Number(l.tare_weight) || 0;
                    const net = Number(l.net_weight) || 0;
                    const gross = Number(l.gross_weight) || (net > 0 ? net + tare : 0);
                    return {
                        machineId: l.machine_id,
                        department: l.department as LineDraft["department"],
                        itemCode: l.item_code ?? "",
                        grossWeight: gross > 0 ? String(gross) : "",
                        tareWeight: String(tare || 0),
                        netWeight: String(net),
                        expanded: true,
                    };
                }),
            );
        } else {
            setDispatchNo(suggestedNo ?? `FSD-${Date.now()}`);
            setDispatchDate(new Date().toISOString().split("T")[0]);
            setVendorCode("");
            setMode("toll");
            setExpectedReturnItemCode("RM-W8-001");
            setBiltyNo("");
            setVehicleNo("");
            setGrossWeight("");
            setTareWeight("0");
            setRate("");
            setRemarks("");
            setLines([]);
        }
    }, [open, initialData, suggestedNo]);

    const vendorOptions = useMemo(() => toPartyComboboxOptions(vendors), [vendors]);

    const resolvedLines = useMemo(
        () =>
            lines.map((l) => ({
                ...l,
                resolvedNet: lineNetFromWeighment(l.grossWeight, l.tareWeight, l.netWeight),
            })),
        [lines],
    );

    const lineTotal = useMemo(
        () => resolvedLines.reduce((s, l) => s + l.resolvedNet, 0),
        [resolvedLines],
    );

    const netWeight = useMemo(() => {
        if (lineTotal > 0) return lineTotal;
        const g = parseFloat(grossWeight) || 0;
        const t = parseFloat(tareWeight) || 0;
        return Math.max(0, g - t);
    }, [lineTotal, grossWeight, tareWeight]);

    const amount = useMemo(() => (parseFloat(rate) || 0) * netWeight, [netWeight, rate]);

    const deptMachines = useMemo(
        () => machines.filter((m) => m.department === lineDept && m.is_active),
        [machines, lineDept],
    );

    const wire8Code = returnItems.find((r) => r.label === "Wire No 8")?.code ?? "RM-W8-001";

    const addLine = () => {
        const m = deptMachines[0];
        if (!m) {
            toast({ title: "No machines for this department", variant: "destructive" });
            return;
        }
        setLines((prev) => [
            ...prev,
            {
                machineId: m.id,
                department: m.department,
                itemCode: m.scrap_item_code ?? "RM-SCP-DRAW",
                grossWeight: "",
                tareWeight: "0",
                netWeight: "",
                expanded: true,
            },
        ]);
    };

    const updateLineMachine = (idx: number, machineId: string) => {
        const m = machines.find((x) => x.id === machineId);
        if (!m) return;
        setLines((prev) =>
            prev.map((l, i) =>
                i === idx
                    ? {
                          ...l,
                          machineId,
                          department: m.department,
                          itemCode: m.scrap_item_code ?? "RM-SCP-DRAW",
                      }
                    : l,
            ),
        );
    };

    const patchLine = (idx: number, patch: Partial<LineDraft>) => {
        setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    };

    const setLineWeighment = (idx: number, field: "grossWeight" | "tareWeight" | "netWeight", value: string) => {
        setLines((prev) =>
            prev.map((l, i) => {
                if (i !== idx) return l;
                const next = { ...l, [field]: value };
                if (field === "grossWeight" || field === "tareWeight") {
                    const g = parseFloat(field === "grossWeight" ? value : next.grossWeight);
                    const t = parseFloat(field === "tareWeight" ? value : next.tareWeight) || 0;
                    if (Number.isFinite(g) && g > 0) {
                        next.netWeight = Math.max(0, g - t).toFixed(3);
                    }
                }
                return next;
            }),
        );
    };

    const buildPayload = (): FactoryScrapDispatchFormPayload | null => {
        if (!vendorCode || lines.length === 0 || netWeight <= 0) {
            toast({ title: "Select vendor and add machine scrap lines", variant: "destructive" });
            return null;
        }
        if (resolvedLines.some((l) => l.resolvedNet <= 0)) {
            toast({ title: "Each machine line needs a positive net kg", variant: "destructive" });
            return null;
        }
        if (mode === "toll" && !expectedReturnItemCode) {
            toast({ title: "Select expected return item", variant: "destructive" });
            return null;
        }

        const headerTare = parseFloat(tareWeight) || 0;
        const mappedLines: FactoryScrapDispatchLinePayload[] = resolvedLines.map((l) => {
            const tare = parseFloat(l.tareWeight) || 0;
            const net = l.resolvedNet;
            const gross = parseFloat(l.grossWeight) || net + tare;
            return {
                machineId: l.machineId,
                department: l.department,
                itemCode: l.itemCode,
                grossWeight: gross,
                tareWeight: tare,
                netWeight: net,
            };
        });
        const linesGross = mappedLines.reduce((s, l) => s + (l.grossWeight ?? 0), 0);
        const linesTare = mappedLines.reduce((s, l) => s + (l.tareWeight ?? 0), 0);

        return {
            dispatchNo,
            dispatchDate,
            destPartyCode: vendorCode,
            mode,
            expectedReturnItemCode: mode === "toll" ? expectedReturnItemCode : undefined,
            expectedReturnKg: mode === "toll" ? netWeight : undefined,
            grossWeight: parseFloat(grossWeight) || linesGross || netWeight + headerTare,
            tareWeight: headerTare || linesTare,
            netWeight,
            unitRate: parseFloat(rate) || 0,
            amount,
            biltyNo: biltyNo || undefined,
            vehicleNo: vehicleNo || undefined,
            remarks: remarks || undefined,
            lines: mappedLines,
        };
    };

    const handleSubmit = async (action: "draft" | "post") => {
        const payload = buildPayload();
        if (!payload) return;

        setSubmitting(true);
        try {
            const ok = (await onSubmit?.(payload, action)) !== false;
            if (ok) onOpenChange(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    "overflow-y-auto",
                    thinScrollbarClass,
                    formExpanded
                        ? "max-w-5xl w-[min(96vw,64rem)] max-h-[94vh]"
                        : "max-w-2xl max-h-[90vh]",
                )}
            >
                <div className="flex items-start justify-between gap-3 pr-6">
                    <div>
                        <DialogTitle>{initialData ? "Edit Factory Scrap" : "Record Factory Scrap"}</DialogTitle>
                        <DialogDescription className="mt-1.5">
                            Machine scrap sent to a vendor (toll or sale). On <strong>post</strong>, drawing/enamel lines
                            deduct Wire No 8 and workshop lines deduct copper rod from warehouse. Cash scrap trades on
                            the Scrap page do not deduct Wire/Rod.
                        </DialogDescription>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 h-8"
                        onClick={() => setFormExpanded((v) => !v)}
                        title={formExpanded ? "Compact form" : "Expand form"}
                    >
                        {formExpanded ? (
                            <>
                                <Minimize2 className="h-3.5 w-3.5 mr-1.5" /> Compact
                            </>
                        ) : (
                            <>
                                <Maximize2 className="h-3.5 w-3.5 mr-1.5" /> Expand
                            </>
                        )}
                    </Button>
                </div>

                <div className={cn("grid gap-3", formExpanded ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2")}>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Dispatch No.</Label>
                        <Input className={invoiceInputClass} value={dispatchNo} onChange={(e) => setDispatchNo(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Date</Label>
                        <Input type="date" className={invoiceInputClass} value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
                    </div>
                    <div className={cn("space-y-1.5", formExpanded ? "lg:col-span-2" : "col-span-2")}>
                        <Label className="text-xs">Vendor (processor)</Label>
                        <PartyCombobox
                            options={vendorOptions}
                            value={vendorCode}
                            onValueChange={setVendorCode}
                            placeholder="Select vendor..."
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Mode</Label>
                        <Select value={mode} onValueChange={(v: "toll" | "sale") => setMode(v)}>
                            <SelectTrigger className={invoiceInputClass}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="toll">Toll (expect Wire/Rod back)</SelectItem>
                                <SelectItem value="sale">Sale (AR / revenue)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {mode === "toll" && (
                        <div className="space-y-1.5">
                            <Label className="text-xs">Expected return item</Label>
                            <Select value={expectedReturnItemCode} onValueChange={setExpectedReturnItemCode}>
                                <SelectTrigger className={invoiceInputClass}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {returnItems.map((i) => (
                                        <SelectItem key={i.code} value={i.code}>
                                            {i.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <Label className="text-xs">Header gross (optional)</Label>
                        <Input className={invoiceInputClass} value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} placeholder="Total weighment" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Header tare (optional)</Label>
                        <Input className={invoiceInputClass} value={tareWeight} onChange={(e) => setTareWeight(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Net (kg)</Label>
                        <Input className={invoiceInputClass} readOnly value={netWeight.toFixed(3)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Rate (PKR/kg)</Label>
                        <Input className={invoiceInputClass} value={rate} onChange={(e) => setRate(e.target.value)} />
                    </div>
                    <div className={cn("space-y-1.5", formExpanded ? "lg:col-span-2" : "col-span-2")}>
                        <Label className="text-xs">Amount</Label>
                        <Input className={invoiceInputClass} readOnly value={amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                    </div>
                    {formExpanded ? (
                        <>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Bilty No.</Label>
                                <Input className={invoiceInputClass} value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Vehicle No.</Label>
                                <Input className={invoiceInputClass} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
                            </div>
                            <div className="space-y-1.5 lg:col-span-4">
                                <Label className="text-xs">Remarks</Label>
                                <Input className={invoiceInputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                            </div>
                        </>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-xs font-semibold uppercase tracking-wide">Machine scrap lines</Label>
                        <div className="flex items-center gap-2">
                            <Select value={lineDept} onValueChange={(v: "drawing" | "enamel" | "workshop") => setLineDept(v)}>
                                <SelectTrigger className="h-8 w-28 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="drawing">Drawing</SelectItem>
                                    <SelectItem value="enamel">Enamel</SelectItem>
                                    <SelectItem value="workshop">Workshop</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button type="button" size="sm" variant="outline" onClick={addLine} disabled={!deptMachines.length}>
                                <Plus className="h-3.5 w-3.5 mr-1" /> Add machine
                            </Button>
                        </div>
                    </div>
                    <div ref={linesRef} className="space-y-2">
                        {resolvedLines.map((line, idx) => (
                            <div key={idx} className="rounded-lg border bg-slate-50/60 p-3 space-y-2">
                                <div className="flex flex-wrap items-end gap-2">
                                    <div className={cn("space-y-1", formExpanded ? "min-w-[12rem] flex-1" : "w-40")}>
                                        <Label className="text-[10px]">Machine</Label>
                                        <Select value={line.machineId} onValueChange={(v) => updateLineMachine(idx, v)}>
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {machines
                                                    .filter((m) => m.department === line.department)
                                                    .map((m) => (
                                                        <SelectItem key={m.id} value={m.id}>
                                                            {m.machine_code} — {m.name}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="w-24 space-y-1">
                                        <Label className="text-[10px]">Dept</Label>
                                        <Input className="h-8 text-xs capitalize" readOnly value={line.department} />
                                    </div>
                                    <div className="w-28 space-y-1">
                                        <Label className="text-[10px]">Scrap SKU</Label>
                                        <Input className="h-8 text-xs font-mono" readOnly value={line.itemCode} />
                                    </div>
                                    <div className={cn("space-y-1", formExpanded ? "min-w-[10rem] flex-1" : "w-36")}>
                                        <Label className="text-[10px]">Deducts (RM)</Label>
                                        <Input
                                            className="h-8 text-[10px] text-amber-800"
                                            readOnly
                                            value={parentRmLabelForDepartment(line.department, wire8Code)}
                                            title="Backflush: this parent RM is deducted from warehouse at post"
                                        />
                                    </div>
                                    <div className="w-24 space-y-1">
                                        <Label className="text-[10px]">Net kg</Label>
                                        <Input
                                            className="h-8 text-xs font-mono font-semibold"
                                            value={line.netWeight}
                                            onChange={(e) => setLineWeighment(idx, "netWeight", e.target.value)}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        onClick={() => patchLine(idx, { expanded: !line.expanded })}
                                        title={line.expanded ? "Collapse weighment" : "Expand weighment (gross/tare)"}
                                    >
                                        {line.expanded ? (
                                            <ChevronUp className="h-4 w-4" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4" />
                                        )}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-rose-600"
                                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                                {line.expanded ? (
                                    <div className="grid grid-cols-3 gap-2 rounded-md border border-dashed border-slate-200 bg-white/70 p-2">
                                        <div className="space-y-1">
                                            <Label className="text-[10px]">Gross (kg)</Label>
                                            <Input
                                                className="h-8 text-xs font-mono"
                                                value={line.grossWeight}
                                                onChange={(e) => setLineWeighment(idx, "grossWeight", e.target.value)}
                                                placeholder="Scale gross"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px]">Tare (kg)</Label>
                                            <Input
                                                className="h-8 text-xs font-mono"
                                                value={line.tareWeight}
                                                onChange={(e) => setLineWeighment(idx, "tareWeight", e.target.value)}
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px]">Net (gross − tare)</Label>
                                            <Input
                                                className="h-8 text-xs font-mono font-semibold text-emerald-700"
                                                readOnly
                                                value={line.resolvedNet.toFixed(3)}
                                            />
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                    {lines.length > 0 && (
                        <p className="text-xs text-slate-500">
                            Total scrap: {lineTotal.toFixed(3)} kg — posting will deduct Wire No 8 / rod by department.
                        </p>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button variant="outline" onClick={() => void handleSubmit("draft")} disabled={submitting}>
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : initialData?.status === "posted" ? (
                            "Unpost & save draft"
                        ) : (
                            "Save draft"
                        )}
                    </Button>
                    <Button onClick={() => void handleSubmit("post")} disabled={submitting}>
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : initialData?.status === "posted" ? (
                            "Save & repost"
                        ) : (
                            "Save & post"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
