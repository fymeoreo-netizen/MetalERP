import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Save, Lock, Calendar, Trash2, Printer, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { TabsScroller, TableScroller } from "@/components/ui/responsive-primitives";
import type { DrawingPremiumLineInput, DrawingPremiumRate, DrawingWeeklyWageSheet } from "@/lib/drawingLaborTypes";
import {
    createDrawingWeeklyWageSheet,
    deleteDrawingWeeklyWageSheet,
    fetchDrawingPremiumRates,
    fetchDrawingWeeklyWageSheet,
    fetchWeekWire8Weights,
    getSundayWeekBounds,
    listDrawingWeeklyWageSheets,
    postDrawingWeeklyWageSheet,
    refreshDrawingWeeklyWageSheetWeights,
    reopenDrawingWeeklyWageSheet,
    saveDrawingWeeklyWageSheet,
    addCalendarDays,
} from "@/lib/repositories/drawingLaborRepo";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";

type PremiumDraft = DrawingPremiumLineInput & { key: string };

export default function DrawingWeeklyWages() {
    const { toast } = useToast();
    const [weekStart, setWeekStart] = useState(() => getSundayWeekBounds().weekStart);
    const [sheets, setSheets] = useState<DrawingWeeklyWageSheet[]>([]);
    const [activeSheet, setActiveSheet] = useState<DrawingWeeklyWageSheet | null>(null);
    const [loading, setLoading] = useState(false);
    const [useReceivedOverride, setUseReceivedOverride] = useState(false);
    const [useScrapOverride, setUseScrapOverride] = useState(false);
    const [receivedOverride, setReceivedOverride] = useState("");
    const [scrapOverride, setScrapOverride] = useState("");
    const [notes, setNotes] = useState("");
    const [premiumLines, setPremiumLines] = useState<PremiumDraft[]>([]);
    const [premiumRates, setPremiumRates] = useState<DrawingPremiumRate[]>([]);
    const [saving, setSaving] = useState(false);
    const [issuedKg, setIssuedKg] = useState<number | null>(null);

    const weekEnd = useMemo(() => addCalendarDays(weekStart, 6), [weekStart]);

    const loadSheets = useCallback(async () => {
        setLoading(true);
        try {
            const [list, premiums] = await Promise.all([
                listDrawingWeeklyWageSheets(),
                fetchDrawingPremiumRates(),
            ]);
            setSheets(list);
            setPremiumRates(premiums);
            const existing = list.find((s) => s.weekStart === weekStart);
            if (existing) {
                await openSheet(existing.id);
            } else {
                setActiveSheet(null);
                resetDraft();
            }
        } catch (e) {
            toast({
                title: "Load failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, [weekStart, toast]);

    const resetDraft = () => {
        setUseReceivedOverride(false);
        setUseScrapOverride(false);
        setReceivedOverride("");
        setScrapOverride("");
        setNotes("");
        setPremiumLines([]);
    };

    const openSheet = async (sheetId: string) => {
        let sheet = await fetchDrawingWeeklyWageSheet(sheetId);
        if (!sheet) return;
        if (sheet.status === "draft" && sheet.wire8ReceivedKg === 0 && !sheet.wire8ReceivedOverride) {
            try {
                await refreshDrawingWeeklyWageSheetWeights(sheetId);
                sheet = (await fetchDrawingWeeklyWageSheet(sheetId)) ?? sheet;
            } catch {
                // Keep sheet as-is; user can refresh manually
            }
        }
        setActiveSheet(sheet);
        try {
            const w = await fetchWeekWire8Weights(sheet.weekStart, sheet.weekEnd);
            setIssuedKg(w.issuedKg ?? 0);
        } catch {
            setIssuedKg(null);
        }
        setUseReceivedOverride(sheet.wire8ReceivedOverride != null);
        setUseScrapOverride(sheet.wire8ScrapOverride != null);
        setReceivedOverride(
            sheet.wire8ReceivedOverride != null ? String(sheet.wire8ReceivedOverride) : String(sheet.wire8ReceivedKg)
        );
        setScrapOverride(
            sheet.wire8ScrapOverride != null ? String(sheet.wire8ScrapOverride) : String(sheet.wire8ScrapKg)
        );
        setNotes(sheet.notes ?? "");
        setPremiumLines(
            sheet.premiumLines.map((l) => ({
                key: l.id ?? `line-${l.lineNo}`,
                gaugeSwg: l.gaugeSwg,
                weightKg: l.weightKg,
            }))
        );
    };

    useEffect(() => {
        void loadSheets();
    }, [loadSheets]);

    const effectiveReceived = useMemo(() => {
        if (useReceivedOverride && receivedOverride !== "") return Number(receivedOverride) || 0;
        return activeSheet?.wire8ReceivedKg ?? 0;
    }, [useReceivedOverride, receivedOverride, activeSheet]);

    const effectiveScrap = useMemo(() => {
        if (useScrapOverride && scrapOverride !== "") return Number(scrapOverride) || 0;
        return activeSheet?.wire8ScrapKg ?? 0;
    }, [useScrapOverride, scrapOverride, activeSheet]);

    const preview = useMemo(() => {
        const baseRate = activeSheet?.baseRatePkr ?? 12;
        const net = Math.max(effectiveReceived - effectiveScrap, 0);
        const baseWage = Math.round(net * baseRate * 100) / 100;
        let premiumWage = 0;
        for (const line of premiumLines) {
            const saved = activeSheet?.premiumLines.find((p) => p.gaugeSwg === line.gaugeSwg);
            const configured = premiumRates.find((p) => p.gaugeSwg === line.gaugeSwg);
            const rate = saved?.ratePkrPerKg ?? configured?.effectiveRatePkr ?? baseRate;
            premiumWage += Math.round(line.weightKg * rate * 100) / 100;
        }
        premiumWage = Math.round(premiumWage * 100) / 100;
        return { net, baseWage, premiumWage, total: baseWage + premiumWage, baseRate };
    }, [effectiveReceived, effectiveScrap, activeSheet, premiumLines, premiumRates]);

    const premiumGauges = useMemo(() => premiumRates.map((g) => g.gaugeSwg), [premiumRates]);

    const handleCreateSheet = async () => {
        setSaving(true);
        try {
            const id = await createDrawingWeeklyWageSheet(weekStart);
            await openSheet(id);
            await loadSheets();
            toast({ title: "Weekly sheet created", description: `Week ${weekStart} → ${weekEnd}` });
        } catch (e) {
            toast({
                title: "Could not create sheet",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleRefreshWeights = async () => {
        if (!activeSheet || activeSheet.status === "posted") return;
        setSaving(true);
        try {
            const w = await refreshDrawingWeeklyWageSheetWeights(activeSheet.id);
            setIssuedKg(w.issuedKg ?? 0);
            await openSheet(activeSheet.id);
            if (!useReceivedOverride) setReceivedOverride(String(w.receivedKg));
            if (!useScrapOverride) setScrapOverride(String(w.scrapKg));
            toast({ title: "Refreshed from purchase invoices" });
        } catch (e) {
            toast({
                title: "Refresh failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteSheet = async () => {
        if (!activeSheet || activeSheet.status !== "draft") return;
        if (!window.confirm(`Delete draft sheet ${activeSheet.sheetNo}? This cannot be undone.`)) return;
        setSaving(true);
        try {
            await deleteDrawingWeeklyWageSheet(activeSheet.id);
            setActiveSheet(null);
            resetDraft();
            setIssuedKg(null);
            await loadSheets();
            toast({ title: "Sheet deleted" });
        } catch (e) {
            toast({
                title: "Delete failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleReopenSheet = async () => {
        if (!activeSheet || activeSheet.status !== "posted") return;
        if (
            !window.confirm(
                `Reopen ${activeSheet.sheetNo} for editing? It will return to draft until you post again.`
            )
        )
            return;
        setSaving(true);
        try {
            await reopenDrawingWeeklyWageSheet(activeSheet.id);
            await openSheet(activeSheet.id);
            await loadSheets();
            const w = await fetchWeekWire8Weights(activeSheet.weekStart, activeSheet.weekEnd);
            setIssuedKg(w.issuedKg ?? 0);
            toast({ title: "Sheet reopened", description: "You can edit and post again." });
        } catch (e) {
            toast({
                title: "Reopen failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteSheetById = async (sheet: DrawingWeeklyWageSheet) => {
        if (sheet.status !== "draft") return;
        if (!window.confirm(`Delete draft sheet ${sheet.sheetNo}? This cannot be undone.`)) return;
        setSaving(true);
        try {
            await deleteDrawingWeeklyWageSheet(sheet.id);
            if (activeSheet?.id === sheet.id) {
                setActiveSheet(null);
                resetDraft();
                setIssuedKg(null);
            }
            await loadSheets();
            toast({ title: "Sheet deleted" });
        } catch (e) {
            toast({
                title: "Delete failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleReopenSheetById = async (sheet: DrawingWeeklyWageSheet) => {
        if (sheet.status !== "posted") return;
        if (
            !window.confirm(
                `Reopen ${sheet.sheetNo} for editing? It will return to draft until you post again.`
            )
        )
            return;
        setSaving(true);
        try {
            await reopenDrawingWeeklyWageSheet(sheet.id);
            setWeekStart(sheet.weekStart);
            await loadSheets();
            await openSheet(sheet.id);
            const w = await fetchWeekWire8Weights(sheet.weekStart, sheet.weekEnd);
            setIssuedKg(w.issuedKg ?? 0);
            toast({ title: "Sheet reopened", description: "You can edit and post again." });
        } catch (e) {
            toast({
                title: "Reopen failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        if (!activeSheet) return;
        if (activeSheet.status === "posted") return;
        setSaving(true);
        try {
            await saveDrawingWeeklyWageSheet({
                sheetId: activeSheet.id,
                notes,
                wire8ReceivedOverride: useReceivedOverride ? Number(receivedOverride) : null,
                wire8ScrapOverride: useScrapOverride ? Number(scrapOverride) : null,
                premiumLines: premiumLines.map(({ gaugeSwg, weightKg }) => ({ gaugeSwg, weightKg })),
            });
            await openSheet(activeSheet.id);
            await loadSheets();
            toast({ title: "Draft saved" });
        } catch (e) {
            toast({
                title: "Save failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handlePost = async () => {
        if (!activeSheet) return;
        setSaving(true);
        try {
            await saveDrawingWeeklyWageSheet({
                sheetId: activeSheet.id,
                notes,
                wire8ReceivedOverride: useReceivedOverride ? Number(receivedOverride) : null,
                wire8ScrapOverride: useScrapOverride ? Number(scrapOverride) : null,
                premiumLines: premiumLines.map(({ gaugeSwg, weightKg }) => ({ gaugeSwg, weightKg })),
            });
            await postDrawingWeeklyWageSheet(activeSheet.id);
            await loadSheets();
            await openSheet(activeSheet.id);
            toast({ title: "Sheet posted", description: "This week is locked for editing." });
        } catch (e) {
            toast({
                title: "Post failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const addPremiumLine = () => {
        const gauge = premiumGauges[0] ?? 33;
        setPremiumLines((prev) => [
            ...prev,
            { key: `new-${Date.now()}`, gaugeSwg: gauge, weightKg: 0 },
        ]);
    };

    const isPosted = activeSheet?.status === "posted";
    const isReadonly = isPosted || !activeSheet;

    return (
        <DashboardLayout>
            <div className="space-y-6 print:hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Drawing Weekly Wages</h1>
                        <p className="text-slate-500">
                            Saturday settlement — Wire No 8 base wage (Sun–Sat) plus SWG 33+ premium lines.
                        </p>
                    </div>
                </div>

                <Tabs defaultValue="sheet" className="space-y-4">
                    <TabsScroller className="sm:flex-1">
                    <TabsList className="bg-slate-100 p-1">
                        <TabsTrigger value="sheet">Current Week</TabsTrigger>
                        <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>
                    </TabsScroller>

                    <TabsContent value="sheet" className="space-y-4">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Week Selection
                                </CardTitle>
                                <CardDescription>Sunday {weekStart} through Saturday {weekEnd}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col sm:flex-row gap-3 items-end">
                                <div className="space-y-1">
                                    <Label className="text-xs">Week starts (Sunday)</Label>
                                    <Input
                                        type="date"
                                        value={weekStart}
                                        onChange={(e) => setWeekStart(e.target.value)}
                                        className="w-full sm:w-[200px]"
                                    />
                                </div>
                                {!activeSheet && (
                                    <Button
                                        onClick={() => void handleCreateSheet()}
                                        disabled={saving || loading}
                                        className="bg-blue-600 hover:bg-blue-700"
                                    >
                                        Create Week Sheet
                                    </Button>
                                )}
                                {activeSheet && !isPosted && (
                                    <Button
                                        variant="outline"
                                        onClick={() => void handleRefreshWeights()}
                                        disabled={saving}
                                    >
                                        Refresh from Purchases
                                    </Button>
                                )}
                            </CardContent>
                        </Card>

                        {activeSheet && (
                            <>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline">{activeSheet.sheetNo}</Badge>
                                    <Badge
                                        className={
                                            isPosted
                                                ? "bg-emerald-100 text-emerald-800"
                                                : "bg-amber-100 text-amber-800"
                                        }
                                    >
                                        {activeSheet.status}
                                    </Badge>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    <Card className="shadow-soft border-slate-100">
                                        <CardHeader>
                                            <CardTitle className="text-base">Wire No 8 (Base)</CardTitle>
                                            <CardDescription>
                                                SWG 1–32: net purchased Wire 8 (Sun–Sat) × base rate
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            {issuedKg != null && issuedKg > 0 && (
                                                <p className="text-xs text-slate-500">
                                                    Wire No 8 issued to enamel (info only): {issuedKg.toLocaleString()} kg
                                                </p>
                                            )}
                                            {activeSheet.wire8ReceivedKg === 0 && !useReceivedOverride && (
                                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                                                    No posted Wire No 8 purchases found for {activeSheet.weekStart} →{" "}
                                                    {activeSheet.weekEnd}. Post purchase invoices in this week (item RM-W8
                                                    or Wire No 8), then click Refresh from Purchases.
                                                </p>
                                            )}
                                            <WeightField
                                                label="Wire 8 purchased (kg)"
                                                helper="Posted purchase invoices, Sun–Sat"
                                                autoValue={activeSheet.wire8ReceivedKg}
                                                useOverride={useReceivedOverride}
                                                onUseOverrideChange={setUseReceivedOverride}
                                                overrideValue={receivedOverride}
                                                onOverrideChange={setReceivedOverride}
                                                disabled={isReadonly}
                                            />
                                            <WeightField
                                                label="Wire 8 scrap deducted (kg)"
                                                helper="Posted factory scrap dispatch (drawing dept), Sun–Sat"
                                                autoValue={activeSheet.wire8ScrapKg}
                                                useOverride={useScrapOverride}
                                                onUseOverrideChange={setUseScrapOverride}
                                                overrideValue={scrapOverride}
                                                onOverrideChange={setScrapOverride}
                                                disabled={isReadonly}
                                            />
                                            <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3">
                                                <div>
                                                    <p className="text-slate-500">Net weight</p>
                                                    <p className="font-semibold">{preview.net.toLocaleString()} kg</p>
                                                </div>
                                                <div>
                                                    <p className="text-slate-500">Base rate</p>
                                                    <p className="font-semibold">₨ {preview.baseRate}/kg</p>
                                                </div>
                                                <div className="col-span-2">
                                                    <p className="text-slate-500">Base wage</p>
                                                    <p className="text-xl font-bold text-slate-900">
                                                        ₨ {preview.baseWage.toLocaleString()}
                                                    </p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card className="shadow-soft border-slate-100">
                                        <CardHeader>
                                            <CardTitle className="text-base">Premium (SWG 33+)</CardTitle>
                                            <CardDescription>Enter drawn weight for thinner gauges</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            <TableScroller>
                                                <Table noWrapper>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Gauge</TableHead>
                                                            <TableHead className="text-right">Weight (kg)</TableHead>
                                                            <TableHead />
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {premiumLines.length === 0 && (
                                                            <TableRow>
                                                                <TableCell colSpan={3} className="text-center text-slate-500 py-4">
                                                                    No premium lines yet
                                                                </TableCell>
                                                            </TableRow>
                                                        )}
                                                        {premiumLines.map((line) => (
                                                            <TableRow key={line.key}>
                                                                <TableCell>
                                                                    <Select
                                                                        value={String(line.gaugeSwg)}
                                                                        onValueChange={(v) =>
                                                                            setPremiumLines((prev) =>
                                                                                prev.map((p) =>
                                                                                    p.key === line.key
                                                                                        ? { ...p, gaugeSwg: Number(v) }
                                                                                        : p
                                                                                )
                                                                            )
                                                                        }
                                                                        disabled={isReadonly}
                                                                    >
                                                                        <SelectTrigger className="h-8 w-24">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {premiumGauges.map((g) => (
                                                                                <SelectItem key={g} value={String(g)}>
                                                                                    SWG {g}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        step="0.001"
                                                                        className="h-8 text-right"
                                                                        value={line.weightKg || ""}
                                                                        onChange={(e) =>
                                                                            setPremiumLines((prev) =>
                                                                                prev.map((p) =>
                                                                                    p.key === line.key
                                                                                        ? {
                                                                                              ...p,
                                                                                              weightKg: Number(e.target.value) || 0,
                                                                                          }
                                                                                        : p
                                                                                )
                                                                            )
                                                                        }
                                                                        disabled={isReadonly}
                                                                    />
                                                                </TableCell>
                                                                <TableCell>
                                                                    {!isReadonly && (
                                                                        <Button
                                                                            size="icon"
                                                                            variant="ghost"
                                                                            className="h-8 w-8 text-rose-600"
                                                                            onClick={() =>
                                                                                setPremiumLines((prev) =>
                                                                                    prev.filter((p) => p.key !== line.key)
                                                                                )
                                                                            }
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    )}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </TableScroller>
                                            {!isReadonly && (
                                                <Button variant="outline" size="sm" onClick={addPremiumLine}>
                                                    <Plus className="h-4 w-4 mr-1" />
                                                    Add gauge line
                                                </Button>
                                            )}
                                            <p className="text-sm text-slate-600 pt-2 border-t">
                                                Premium subtotal:{" "}
                                                <strong>₨ {preview.premiumWage.toLocaleString()}</strong>
                                            </p>
                                        </CardContent>
                                    </Card>
                                </div>

                                <Card className="shadow-soft border-slate-100">
                                    <CardContent className="pt-6 space-y-4">
                                        <div className="space-y-2">
                                            <Label>Notes (operators / remarks)</Label>
                                            <Textarea
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value)}
                                                placeholder="Optional operator names or remarks"
                                                disabled={isReadonly}
                                            />
                                        </div>
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t pt-4">
                                            <div>
                                                <p className="text-sm text-slate-500">Total weekly wage</p>
                                                <p className="text-2xl font-bold text-blue-700">
                                                    ₨ {preview.total.toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => window.print()}
                                                    disabled={!activeSheet}
                                                >
                                                    <Printer className="h-4 w-4 mr-1" />
                                                    Print
                                                </Button>
                                                {!isPosted && (
                                                    <>
                                                        <Button
                                                            variant="outline"
                                                            onClick={() => void handleSave()}
                                                            disabled={saving}
                                                        >
                                                            <Save className="h-4 w-4 mr-1" />
                                                            Save Draft
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            className="text-rose-600 hover:text-rose-700"
                                                            onClick={() => void handleDeleteSheet()}
                                                            disabled={saving}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-1" />
                                                            Delete
                                                        </Button>
                                                        <Button
                                                            onClick={() => void handlePost()}
                                                            disabled={saving}
                                                            className="bg-blue-600 hover:bg-blue-700"
                                                        >
                                                            <Lock className="h-4 w-4 mr-1" />
                                                            Post & Lock
                                                        </Button>
                                                    </>
                                                )}
                                                {isPosted && (
                                                    <Button
                                                        variant="outline"
                                                        onClick={() => void handleReopenSheet()}
                                                        disabled={saving}
                                                    >
                                                        <Undo2 className="h-4 w-4 mr-1" />
                                                        Reopen to Draft
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="history">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Posted & Draft Sheets</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <TableScroller>
                                    <Table noWrapper className="min-w-[720px]">
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Sheet</TableHead>
                                                <TableHead>Week</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Total (₨)</TableHead>
                                                <TableHead />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sheets.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                                                        No sheets yet
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                            {sheets.map((s) => (
                                                <TableRow key={s.id}>
                                                    <TableCell className="font-medium">{s.sheetNo}</TableCell>
                                                    <TableCell>
                                                        {s.weekStart} → {s.weekEnd}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">{s.status}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">
                                                        {s.totalWagePkr.toLocaleString()}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-1 flex-wrap">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    setWeekStart(s.weekStart);
                                                                    void openSheet(s.id);
                                                                }}
                                                            >
                                                                Open
                                                            </Button>
                                                            {s.status === "draft" && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="text-rose-600"
                                                                    disabled={saving}
                                                                    onClick={() => void handleDeleteSheetById(s)}
                                                                >
                                                                    Delete
                                                                </Button>
                                                            )}
                                                            {s.status === "posted" && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    disabled={saving}
                                                                    onClick={() => void handleReopenSheetById(s)}
                                                                >
                                                                    Reopen
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableScroller>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>

            {activeSheet && (
                <div className="hidden print:block p-8">
                    <ReportPrintHeader
                        reportTitle="Drawing Weekly Wage Sheet"
                        dateFrom={activeSheet.weekStart}
                        dateTo={activeSheet.weekEnd}
                    />
                    <div className="mt-6 space-y-4 text-sm">
                        <p>
                            <strong>Sheet:</strong> {activeSheet.sheetNo} ({activeSheet.status})
                        </p>
                        <p>
                            Wire 8 purchased: {effectiveReceived} kg | Scrap: {effectiveScrap} kg | Net: {preview.net}{" "}
                            kg
                        </p>
                        <p>
                            Base wage: ₨ {preview.baseWage.toLocaleString()} | Premium: ₨{" "}
                            {preview.premiumWage.toLocaleString()} | <strong>Total: ₨ {preview.total.toLocaleString()}</strong>
                        </p>
                        {notes && <p>Notes: {notes}</p>}
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}

function WeightField({
    label,
    helper,
    autoValue,
    useOverride,
    onUseOverrideChange,
    overrideValue,
    onOverrideChange,
    disabled,
}: {
    label: string;
    helper?: string;
    autoValue: number;
    useOverride: boolean;
    onUseOverrideChange: (v: boolean) => void;
    overrideValue: string;
    onOverrideChange: (v: string) => void;
    disabled?: boolean;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div>
                    <Label className="text-sm">{label}</Label>
                    {helper && <p className="text-xs text-slate-500">{helper}</p>}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                    <Checkbox
                        checked={useOverride}
                        onCheckedChange={(c) => onUseOverrideChange(c === true)}
                        disabled={disabled}
                    />
                    Override
                </label>
            </div>
            <p className="text-xs text-slate-500">Auto: {autoValue.toLocaleString()} kg</p>
            <Input
                type="number"
                min={0}
                step="0.001"
                value={useOverride ? overrideValue : String(autoValue)}
                onChange={(e) => onOverrideChange(e.target.value)}
                disabled={disabled || !useOverride}
                className={!useOverride ? "bg-slate-50" : ""}
            />
        </div>
    );
}
