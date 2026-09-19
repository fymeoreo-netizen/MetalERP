import DashboardLayout from "@/components/layout/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
    Calendar03Icon,
    CircleUnlock01Icon,
    LockIcon,
    PlayCircleIcon,
    Refresh01Icon,
    SparklesIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    fetchPacFeatureFlag,
    listAccountingPeriods,
    listPeriodCostRates,
    listPeriodCostingRuns,
    reopenAccountingPeriod,
    runPeriodicCosting,
    getPeriodCostingPreview,
    type AccountingPeriodRow,
    type PeriodCostRateRow,
    type PeriodCostingRunRow,
    type PeriodCostingPreview,
} from "@/lib/api/periodCosting";

const CARD = "shadow-soft border-slate-100 bg-white";

type RunMode = "draft" | "final";

function fmt(n: number | null | undefined, dp = 3): string {
    if (n == null || Number.isNaN(n)) return "—";
    return n.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: dp,
    });
}

function statusBadge(status: AccountingPeriodRow["status"]) {
    const map = {
        open: { variant: "secondary" as const, label: "Open", cls: "bg-slate-100 text-slate-600" },
        draft: { variant: "default" as const, label: "Draft", cls: "bg-amber-100 text-amber-700 border-amber-200" },
        locked: { variant: "default" as const, label: "Locked", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    };
    const s = map[status];
    return (
        <Badge variant={s.variant} className={s.cls}>
            {s.label}
        </Badge>
    );
}

function rateClassLabel(rc: string): string {
    switch (rc) {
        case "rm_copper":
            return "Copper (Wire 8)";
        case "rm_rod":
            return "Copper Rod";
        case "rm_varnish":
            return "Varnish";
        case "rm_packing":
            return "Packing (Goats)";
        case "fg_enamel":
            return "FG Enamel";
        default:
            return rc;
    }
}

export default function PeriodCostingDashboard() {
    const { toast } = useToast();

    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = new Date().toISOString().slice(0, 8) + "01";

    const [pacEnabled, setPacEnabled] = useState<boolean | null>(null);
    const [startDate, setStartDate] = useState<string>(firstOfMonth);
    const [endDate, setEndDate] = useState<string>(today);
    const [mode, setMode] = useState<RunMode>("draft");
    const [actualOverheadRate, setActualOverheadRate] = useState<string>("");
    const [actualOverheadAmount, setActualOverheadAmount] = useState<string>("");
    const [periodCode, setPeriodCode] = useState<string>("");

    const [periods, setPeriods] = useState<AccountingPeriodRow[]>([]);
    const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
    const [rates, setRates] = useState<PeriodCostRateRow[]>([]);
    const [runs, setRuns] = useState<PeriodCostingRunRow[]>([]);
    const [preview, setPreview] = useState<PeriodCostingPreview | null>(null);

    const [running, setRunning] = useState(false);
    const [loadingPeriods, setLoadingPeriods] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [previewing, setPreviewing] = useState(false);

    const loadPeriods = useCallback(async () => {
        setLoadingPeriods(true);
        try {
            const rows = await listAccountingPeriods();
            setPeriods(rows);
            if (!selectedPeriodId && rows.length) {
                setSelectedPeriodId(rows[0].id);
            }
        } catch (err) {
            toast({
                title: "Failed to load periods",
                description: err instanceof Error ? err.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setLoadingPeriods(false);
        }
    }, [selectedPeriodId, toast]);

    const loadDetail = useCallback(
        async (periodId: string) => {
            if (!periodId) {
                setRates([]);
                setRuns([]);
                return;
            }
            setLoadingDetail(true);
            try {
                const [r, rn] = await Promise.all([
                    listPeriodCostRates(periodId),
                    listPeriodCostingRuns(periodId),
                ]);
                setRates(r);
                setRuns(rn);
            } catch (err) {
                toast({
                    title: "Failed to load period detail",
                    description: err instanceof Error ? err.message : "Unknown error",
                    variant: "destructive",
                });
            } finally {
                setLoadingDetail(false);
            }
        },
        [toast],
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const flag = await fetchPacFeatureFlag();
            if (!cancelled) setPacEnabled(flag);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        void loadPeriods();
    }, [loadPeriods]);

    useEffect(() => {
        if (selectedPeriodId) void loadDetail(selectedPeriodId);
    }, [selectedPeriodId, loadDetail]);

    const selectedPeriod = useMemo(
        () => periods.find((p) => p.id === selectedPeriodId) ?? null,
        [periods, selectedPeriodId],
    );

    const runPreview = useCallback(async () => {
        setPreviewing(true);
        try {
            const res = await getPeriodCostingPreview(
                startDate,
                endDate,
                mode === "draft",
                actualOverheadRate ? Number(actualOverheadRate) : null,
                actualOverheadAmount ? Number(actualOverheadAmount) : null,
            );
            if (!res.ok) {
                toast({ title: "Preview failed", description: res.error, variant: "destructive" });
                return;
            }
            setPreview(res.data);
        } finally {
            setPreviewing(false);
        }
    }, [startDate, endDate, mode, actualOverheadRate, actualOverheadAmount, toast]);

    const handleRun = useCallback(async () => {
        if (!startDate || !endDate) {
            toast({ title: "Pick a date range", variant: "destructive" });
            return;
        }
        setRunning(true);
        try {
            const res = await runPeriodicCosting({
                startDate,
                endDate,
                isDraft: mode === "draft",
                actualOverheadRate: actualOverheadRate ? Number(actualOverheadRate) : null,
                actualOverheadAmount: actualOverheadAmount ? Number(actualOverheadAmount) : null,
                periodCode: periodCode || null,
            });
            if (!res.ok) {
                toast({ title: "PAC run failed", description: res.error, variant: "destructive" });
                return;
            }
            toast({
                title: mode === "draft" ? "Draft PAC run complete" : "Final PAC run complete",
                description: `Overhead @ ${fmt(res.data.overhead_rate_used, 6)}/kg applied.`,
            });
            await loadPeriods();
            if (res.data.period_id) {
                setSelectedPeriodId(res.data.period_id);
            }
        } finally {
            setRunning(false);
        }
    }, [
        startDate,
        endDate,
        mode,
        actualOverheadRate,
        actualOverheadAmount,
        periodCode,
        toast,
        loadPeriods,
    ]);

    const handleReopen = useCallback(
        async (periodId: string) => {
            const res = await reopenAccountingPeriod(periodId);
            if (!res.ok) {
                toast({ title: "Reopen failed", description: res.error, variant: "destructive" });
                return;
            }
            toast({ title: "Period reopened", description: "You may now post backdated entries." });
            await loadPeriods();
        },
        [toast, loadPeriods],
    );

    const rmRates = useMemo(() => rates.filter((r) => r.rate_class.startsWith("rm_")), [rates]);
    const fgRates = useMemo(() => rates.filter((r) => r.rate_class === "fg_enamel"), [rates]);

    return (
        <DashboardLayout>
            <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                            Period Close &amp; Costing
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">
                            Periodic Average Costing (PAC) — blended RM + overhead rates for a date
                            range, independent of posting order.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {pacEnabled === null ? (
                            <Badge variant="secondary" className="bg-slate-100 text-slate-500">
                                Checking flag…
                            </Badge>
                        ) : pacEnabled ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                                PAC enabled
                            </Badge>
                        ) : (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                                PAC flag off (legacy WAC)
                            </Badge>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void loadPeriods()}
                            disabled={loadingPeriods}
                        >
                            <Icon icon={Refresh01Icon} size={14} className="mr-1.5" />
                            Refresh
                        </Button>
                    </div>
                </div>

                {pacEnabled === false && (
                    <Alert>
                        <Icon icon={SparklesIcon} size={16} className="text-black" />
                        <AlertTitle>PAC feature flag is off</AlertTitle>
                        <AlertDescription>
                            The engine RPCs are deployed but <code>pac_costing_enabled</code> is
                            <code> false</code> in <code>erp.production_standards</code>. Draft runs
                            are still safe to preview; final runs will restamp movements regardless
                            of the flag.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    {/* Run panel */}
                    <Card className={`${CARD} lg:col-span-1`}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Icon icon={PlayCircleIcon} size={16} className="text-black" />
                                Run Periodic Costing
                            </CardTitle>
                            <CardDescription>
                                Draft = mid-month (proxy OH). Final = locks the period.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label htmlFor="pac-start" className="text-xs">
                                        Start date
                                    </Label>
                                    <Input
                                        id="pac-start"
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="pac-end" className="text-xs">
                                        End date
                                    </Label>
                                    <Input
                                        id="pac-end"
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <Label className="text-xs">Mode</Label>
                                <Select value={mode} onValueChange={(v) => setMode(v as RunMode)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="draft">Draft (proxy OH)</SelectItem>
                                        <SelectItem value="final">Final (lock period)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {mode === "final" && (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label htmlFor="pac-oh-rate" className="text-xs">
                                                Actual OH /kg (optional)
                                            </Label>
                                            <Input
                                                id="pac-oh-rate"
                                                type="number"
                                                inputMode="decimal"
                                                placeholder="auto from amount"
                                                value={actualOverheadRate}
                                                onChange={(e) => setActualOverheadRate(e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="pac-oh-amt" className="text-xs">
                                                Total OH amount (optional)
                                            </Label>
                                            <Input
                                                id="pac-oh-amt"
                                                type="number"
                                                inputMode="decimal"
                                                placeholder="auto from Cashbook GL"
                                                value={actualOverheadAmount}
                                                onChange={(e) => setActualOverheadAmount(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground leading-snug">
                                        Leave blank to automatically calculate from posted Cashbook
                                        factory expenses.
                                    </p>
                                </div>
                            )}

                            <div>
                                <Label htmlFor="pac-code" className="text-xs">
                                    Period code (optional)
                                </Label>
                                <Input
                                    id="pac-code"
                                    placeholder="e.g. 2026-07"
                                    value={periodCode}
                                    onChange={(e) => setPeriodCode(e.target.value)}
                                />
                            </div>

                            <div className="flex gap-2 pt-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void runPreview()}
                                    disabled={previewing || running}
                                >
                                    <Icon icon={Calendar03Icon} size={14} className="mr-1.5" />
                                    {previewing ? "Previewing…" : "Preview"}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => void handleRun()}
                                    disabled={running}
                                    className={
                                        mode === "final"
                                            ? "bg-rose-600 hover:bg-rose-700"
                                            : "bg-emerald-600 hover:bg-emerald-700"
                                    }
                                >
                                    <Icon
                                        icon={mode === "final" ? LockIcon : PlayCircleIcon}
                                        size={14}
                                        className="mr-1.5"
                                    />
                                    {running
                                        ? "Running…"
                                        : mode === "final"
                                          ? "Run & Lock"
                                          : "Run Draft"}
                                </Button>
                            </div>

                            {preview && (
                                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">FG output kg</span>
                                        <span className="font-mono font-semibold">
                                            {fmt(preview.fg_output_kg, 3)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex justify-between">
                                        <span className="text-slate-500">OH rate /kg</span>
                                        <span className="font-mono font-semibold text-emerald-700">
                                            {fmt(preview.overhead_rate_used, 6)}
                                        </span>
                                    </div>
                                    {preview.overhead_amount != null && (
                                        <div className="mt-1 flex justify-between">
                                            <span className="text-slate-500">
                                                OH amount
                                                {preview.overhead_amount_source === "auto_gl"
                                                    ? " (auto GL)"
                                                    : preview.overhead_amount_source
                                                      ? ` (${preview.overhead_amount_source})`
                                                      : ""}
                                            </span>
                                            <span className="font-mono">
                                                {fmt(preview.overhead_amount, 2)}
                                            </span>
                                        </div>
                                    )}
                                    {preview.proxy_source_period && (
                                        <div className="mt-1 flex justify-between">
                                            <span className="text-slate-500">Proxy source</span>
                                            <span className="font-mono">
                                                {preview.proxy_source_period}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Periods list */}
                    <Card className={`${CARD} lg:col-span-2`}>
                        <CardHeader>
                            <CardTitle className="text-base">Accounting Periods</CardTitle>
                            <CardDescription>
                                Select a period to inspect its PAC rates and run history.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loadingPeriods && periods.length === 0 ? (
                                <p className="text-sm text-slate-400">Loading…</p>
                            ) : periods.length === 0 ? (
                                <p className="text-sm text-slate-500">
                                    No periods yet. Run a draft or final to create one.
                                </p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-xs">Code</TableHead>
                                            <TableHead className="text-xs">Range</TableHead>
                                            <TableHead className="text-xs">Status</TableHead>
                                            <TableHead className="text-xs text-right">OH /kg</TableHead>
                                            <TableHead className="text-xs">Last run</TableHead>
                                            <TableHead className="text-xs text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {periods.map((p) => (
                                            <TableRow
                                                key={p.id}
                                                className={p.id === selectedPeriodId ? "bg-slate-50" : ""}
                                                onClick={() => setSelectedPeriodId(p.id)}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <TableCell className="font-mono text-xs">
                                                    {p.period_code ?? "—"}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600">
                                                    {p.start_date} → {p.end_date}
                                                </TableCell>
                                                <TableCell>{statusBadge(p.status)}</TableCell>
                                                <TableCell className="text-right font-mono text-xs">
                                                    {fmt(
                                                        p.actual_overhead_rate ?? p.proxy_overhead_rate_used,
                                                        6,
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500">
                                                    {p.last_run_at
                                                        ? new Date(p.last_run_at).toLocaleString()
                                                        : "—"}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {p.status === "locked" && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void handleReopen(p.id);
                                                            }}
                                                        >
                                                            <Icon icon={CircleUnlock01Icon} size={14} className="mr-1" />
                                                            Reopen
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    {/* Rates + runs for selected period */}
                    <Card className={`${CARD} lg:col-span-3`}>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {selectedPeriod
                                    ? `PAC Rates — ${selectedPeriod.period_code ?? selectedPeriod.start_date}`
                                    : "PAC Rates"}
                            </CardTitle>
                            <CardDescription>
                                RM blended rates and FG PAC for the selected period.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loadingDetail ? (
                                <p className="text-sm text-slate-400">Loading detail…</p>
                            ) : rates.length === 0 ? (
                                <p className="text-sm text-slate-500">No rates recorded for this period.</p>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Raw Materials
                                        </p>
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="text-xs">Class</TableHead>
                                                    <TableHead className="text-xs">Item</TableHead>
                                                    <TableHead className="text-xs text-right">Open qty</TableHead>
                                                    <TableHead className="text-xs text-right">Purch qty</TableHead>
                                                    <TableHead className="text-xs text-right">PAC /kg</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {rmRates.map((r) => (
                                                    <TableRow key={r.id}>
                                                        <TableCell className="text-xs">
                                                            {rateClassLabel(r.rate_class)}
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs">
                                                            {r.item_code ?? r.item_id.slice(0, 8)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-xs">
                                                            {fmt(r.opening_qty, 3)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-xs">
                                                            {fmt(r.purchase_qty, 3)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                                                            {fmt(r.pac_unit_cost, 6)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {fgRates.length > 0 && (
                                        <div>
                                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                Finished Goods
                                            </p>
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="text-xs">Item</TableHead>
                                                        <TableHead className="text-xs text-right">Copper/kg</TableHead>
                                                        <TableHead className="text-xs text-right">Varnish/kg</TableHead>
                                                        <TableHead className="text-xs text-right">Packing/kg</TableHead>
                                                        <TableHead className="text-xs text-right">OH/kg</TableHead>
                                                        <TableHead className="text-xs text-right">PAC /kg</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {fgRates.map((r) => (
                                                        <TableRow key={r.id}>
                                                            <TableCell className="font-mono text-xs">
                                                                {r.item_code ?? r.item_id.slice(0, 8)}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-xs">
                                                                {fmt(r.rm_copper_per_kg, 6)}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-xs">
                                                                {fmt(r.rm_varnish_per_kg, 6)}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-xs">
                                                                {fmt(r.rm_packing_per_kg, 6)}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-xs">
                                                                {fmt(r.oh_per_kg, 6)}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                                                                {fmt(r.pac_unit_cost, 6)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Run history */}
                    <Card className={`${CARD} lg:col-span-3`}>
                        <CardHeader>
                            <CardTitle className="text-base">Run History</CardTitle>
                            <CardDescription>Most recent PAC runs for this period.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {runs.length === 0 ? (
                                <p className="text-sm text-slate-500">No runs yet.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-xs">Started</TableHead>
                                            <TableHead className="text-xs">Mode</TableHead>
                                            <TableHead className="text-xs">Status</TableHead>
                                            <TableHead className="text-xs text-right">OH /kg</TableHead>
                                            <TableHead className="text-xs">Error</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {runs.map((rn) => (
                                            <TableRow key={rn.id}>
                                                <TableCell className="text-xs text-slate-600">
                                                    {new Date(rn.started_at).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <Badge
                                                        variant="secondary"
                                                        className={
                                                            rn.mode === "final"
                                                                ? "bg-rose-100 text-rose-700"
                                                                : "bg-amber-100 text-amber-700"
                                                        }
                                                    >
                                                        {rn.mode}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {rn.ok ? (
                                                        <span className="text-emerald-600">ok</span>
                                                    ) : (
                                                        <span className="text-rose-600">failed</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-xs">
                                                    {fmt(rn.overhead_rate_used, 6)}
                                                </TableCell>
                                                <TableCell className="text-xs text-rose-600">
                                                    {rn.error_text ?? ""}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                            {runs[0]?.stats && Array.isArray(runs[0].stats.warnings) && (runs[0].stats.warnings as unknown[]).length > 0 && (
                                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                    <p className="font-semibold mb-1">
                                        Latest run warnings
                                        {typeof runs[0].stats.overhead_amount_source === "string"
                                            ? ` · OH source: ${String(runs[0].stats.overhead_amount_source)}`
                                            : ""}
                                    </p>
                                    <ul className="list-disc pl-4 space-y-0.5">
                                        {(runs[0].stats.warnings as Array<Record<string, unknown>>).map((w, i) => (
                                            <li key={i}>
                                                <span className="font-mono">{String(w.code ?? "WARN")}</span>
                                                {w.message != null ? `: ${String(w.message)}` : ""}
                                                {w.amount != null ? ` (${Number(w.amount).toLocaleString()})` : ""}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
