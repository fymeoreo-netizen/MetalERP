import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Plus, Trash2, AlertCircle } from "lucide-react";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import {
    deleteDrawingPremiumRate,
    fetchDrawingLaborSettings,
    fetchDrawingPremiumRates,
    saveDrawingLaborSettings,
    upsertDrawingPremiumRate,
} from "@/lib/repositories/drawingLaborRepo";
import type { DrawingPremiumRate } from "@/lib/drawingLaborTypes";

export default function LaborRateMatrix() {
    const { toast } = useToast();
    const [baseRate, setBaseRate] = useState("12");
    const [premiumRates, setPremiumRates] = useState<DrawingPremiumRate[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingBase, setSavingBase] = useState(false);
    const [newGauge, setNewGauge] = useState("");
    const [newIncrement, setNewIncrement] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const [settings, premiums] = await Promise.all([
                fetchDrawingLaborSettings(),
                fetchDrawingPremiumRates(),
            ]);
            setBaseRate(String(settings.baseRatePkr));
            setPremiumRates(premiums);
        } catch (e) {
            toast({
                title: "Could not load rates",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const handleSaveBase = async () => {
        const rate = Number(baseRate);
        if (!Number.isFinite(rate) || rate <= 0) {
            toast({ title: "Invalid base rate", description: "Enter a positive PKR/kg value.", variant: "destructive" });
            return;
        }
        setSavingBase(true);
        try {
            await saveDrawingLaborSettings(rate);
            await load();
            toast({ title: "Base rate saved", description: `Drawing base rate is now ₨ ${rate}/kg.` });
        } catch (e) {
            toast({
                title: "Save failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSavingBase(false);
        }
    };

    const handleSavePremiumRow = async (row: DrawingPremiumRate, increment: string) => {
        const inc = Number(increment);
        if (!Number.isFinite(inc) || inc < 0) {
            toast({ title: "Invalid increment", variant: "destructive" });
            return;
        }
        try {
            await upsertDrawingPremiumRate({ gaugeSwg: row.gaugeSwg, incrementPkr: inc, ratePkrOverride: null });
            await load();
            toast({ title: "Premium rate updated", description: `SWG ${row.gaugeSwg} saved.` });
        } catch (e) {
            toast({
                title: "Update failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    const handleAddPremium = async () => {
        const gauge = Number(newGauge);
        const inc = Number(newIncrement);
        if (!Number.isInteger(gauge) || gauge < 33) {
            toast({ title: "Gauge must be SWG 33 or higher", variant: "destructive" });
            return;
        }
        if (!Number.isFinite(inc) || inc < 0) {
            toast({ title: "Increment must be zero or positive", variant: "destructive" });
            return;
        }
        if (premiumRates.some((r) => r.gaugeSwg === gauge)) {
            toast({ title: "Gauge already exists", variant: "destructive" });
            return;
        }
        try {
            await upsertDrawingPremiumRate({ gaugeSwg: gauge, incrementPkr: inc });
            setNewGauge("");
            setNewIncrement("");
            await load();
            toast({ title: "Premium gauge added" });
        } catch (e) {
            toast({
                title: "Add failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    const handleDeletePremium = async (id: string) => {
        try {
            await deleteDrawingPremiumRate(id);
            await load();
            toast({ title: "Premium rate removed" });
        } catch (e) {
            toast({
                title: "Delete failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    const baseNum = Number(baseRate) || 0;

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Drawing Labour Rates</h1>
                        <p className="text-slate-500">
                            Base mazdoori for Wire No 8 (SWG 1–32) and premium rates for thinner gauges (33+).
                        </p>
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                    <Card className="shadow-soft border-slate-100 lg:col-span-1">
                        <CardHeader>
                            <CardTitle>Base Rate (SWG 1–32)</CardTitle>
                            <CardDescription>
                                Weekly wage uses net Wire No 8 weight × this rate. Gauges 1–32 are covered by the base
                                calculation.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Base rate (PKR / kg)</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={baseRate}
                                    onChange={(e) => setBaseRate(e.target.value)}
                                    className="h-11"
                                />
                            </div>
                            <Button
                                onClick={() => void handleSaveBase()}
                                disabled={savingBase || loading}
                                className="w-full bg-blue-600 hover:bg-blue-700"
                            >
                                <Save className="h-4 w-4 mr-2" />
                                {savingBase ? "Saving..." : "Save Base Rate"}
                            </Button>
                            <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900 flex gap-2">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <p>
                                    Formula: <strong>base wage = (Wire 8 received − scrap) × base rate</strong>
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="shadow-soft border-slate-100 lg:col-span-2">
                        <CardHeader>
                            <CardTitle>Premium Rates (SWG 33+)</CardTitle>
                            <CardDescription>
                                Effective rate = base ({baseNum} PKR) + increment, unless overridden. Enter weights on
                                the weekly wage sheet.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <TableScroller>
                                <Table noWrapper className="min-w-[640px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Gauge (SWG)</TableHead>
                                            <TableHead>Increment (PKR/kg)</TableHead>
                                            <TableHead>Effective Rate</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loading && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                                                    Loading...
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {!loading &&
                                            premiumRates.map((row) => (
                                                <PremiumRowEditor
                                                    key={row.id}
                                                    row={row}
                                                    baseRate={baseNum}
                                                    onSave={(inc) => void handleSavePremiumRow(row, inc)}
                                                    onDelete={() => void handleDeletePremium(row.id)}
                                                />
                                            ))}
                                    </TableBody>
                                </Table>
                            </TableScroller>

                            <div className="flex flex-col sm:flex-row gap-2 items-end border-t border-slate-100 pt-4">
                                <div className="space-y-1 flex-1">
                                    <Label className="text-xs">New gauge (≥ 33)</Label>
                                    <Input
                                        type="number"
                                        placeholder="e.g. 39"
                                        value={newGauge}
                                        onChange={(e) => setNewGauge(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1 flex-1">
                                    <Label className="text-xs">Increment PKR/kg</Label>
                                    <Input
                                        type="number"
                                        placeholder="e.g. 7"
                                        value={newIncrement}
                                        onChange={(e) => setNewIncrement(e.target.value)}
                                    />
                                </div>
                                <Button variant="outline" onClick={() => void handleAddPremium()} className="shrink-0">
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}

function PremiumRowEditor({
    row,
    baseRate,
    onSave,
    onDelete,
}: {
    row: DrawingPremiumRate;
    baseRate: number;
    onSave: (increment: string) => void;
    onDelete: () => void;
}) {
    const [increment, setIncrement] = useState(String(row.incrementPkr));
    const effective = row.ratePkrOverride ?? baseRate + Number(increment || 0);

    return (
        <TableRow>
            <TableCell className="font-medium">SWG {row.gaugeSwg}</TableCell>
            <TableCell>
                <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={increment}
                    onChange={(e) => setIncrement(e.target.value)}
                    className="w-28 h-8"
                />
            </TableCell>
            <TableCell className="text-slate-700">₨ {effective.toFixed(2)} / kg</TableCell>
            <TableCell className="text-right space-x-1">
                <Button size="sm" variant="outline" onClick={() => onSave(increment)}>
                    Save
                </Button>
                <Button size="sm" variant="ghost" className="text-rose-600" onClick={onDelete}>
                    <Trash2 className="h-4 w-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
}
