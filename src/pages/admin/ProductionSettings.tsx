import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Factory, Pencil, Plus, Save, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useBackendLiveMode } from "@/lib/backendFlags";
import {
    fetchProductionMachines,
    fetchProductionStandards,
    fetchMachineProductionReport,
    saveProductionStandard,
    upsertProductionMachine,
    type MachineProductionSummaryRow,
    type ProductionMachineRow,
    type ProductionStandardRow,
} from "@/lib/api/production";
import { getItemIdsByCode } from "@/lib/api/core";
import {
    DEFAULT_WIRE8_ITEM_CODE,
    WIRE8_ITEM_CODE_KEY,
} from "@/lib/productionWire8Settings";
import { TabsScroller, TableScroller } from "@/components/ui/responsive-primitives";

const NUMERIC_KEYS = [
    {
        key: "enamel_scrap_pct",
        label: "Enamel scrap limit % (Factory Scrap dispatch vs production input)",
        default: 2,
    },
    {
        key: "enamel_varnish_pct",
        label: "Enamel varnish deduction % (production batch auto-issue, not scrap)",
        default: 2.7,
    },
    { key: "workshop_wastage_pct", label: "Workshop wastage limit % (scrap dispatch vs rod input)", default: 3.5 },
    { key: "goat_packing_threshold_low_kg", label: "Goat net < (kg) → 5kg pack", default: 7.5 },
    { key: "goat_packing_threshold_mid_lo_kg", label: "Goat net mid range low (kg)", default: 8 },
    { key: "goat_packing_threshold_mid_hi_kg", label: "Goat net mid range high (kg)", default: 13 },
] as const;

function machineWastageKey(code: string) {
    return `machine_wastage_pct:${code}`;
}

const TEXT_KEYS = [
    { key: "varnish_golden_item_code", label: "Golden varnish item", default: "CHM-VAR-001" },
    { key: "varnish_black_item_code", label: "Black varnish item", default: "CHM-VAR-002" },
    { key: "goat_packing_5kg_item_code", label: "5 kg goat packing item", default: "CON-GOT-001" },
    { key: "goat_packing_10kg_item_code", label: "10 kg goat packing item", default: "CON-GOT-002" },
    { key: "rod_input_item_code", label: "Rod input item (workshop)", default: "RM-CR-001" },
] as const;

const WIRE8_ITEM_CODE_FIELD = {
    key: WIRE8_ITEM_CODE_KEY,
    label: "Wire No 8 item code (single RM pool for purchase + enamel)",
    default: DEFAULT_WIRE8_ITEM_CODE,
} as const;

type MachineDraft = {
    code: string;
    name: string;
    department: ProductionMachineRow["department"];
    scrapItemCode: string;
    sortOrder: string;
};

export default function ProductionSettings() {
    const liveMode = useBackendLiveMode();
    const { toast } = useToast();
    const [standards, setStandards] = useState<ProductionStandardRow[]>([]);
    const [machines, setMachines] = useState<ProductionMachineRow[]>([]);
    const [numDraft, setNumDraft] = useState<Record<string, string>>({});
    const [textDraft, setTextDraft] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [savingMachineLimits, setSavingMachineLimits] = useState(false);
    const [machineWastageDraft, setMachineWastageDraft] = useState<Record<string, string>>({});
    const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
    const [machineEditDraft, setMachineEditDraft] = useState<MachineDraft | null>(null);
    const [savingMachineId, setSavingMachineId] = useState<string | null>(null);
    const [limitsPreview, setLimitsPreview] = useState<MachineProductionSummaryRow[]>([]);
    const [machineDept, setMachineDept] = useState<"drawing" | "enamel" | "workshop">("enamel");
    const [newMachine, setNewMachine] = useState({
        code: "",
        name: "",
        scrapItemCode: "",
        sortOrder: "0",
    });

    const loadLimitsPreview = useCallback(async () => {
        if (!liveMode) {
            setLimitsPreview([]);
            return;
        }
        const from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
        const to = new Date().toISOString().split("T")[0];
        const rows = await fetchMachineProductionReport({ from, to });
        setLimitsPreview(rows.filter((r) => r.input_kg > 0 || r.scrap_kg > 0));
    }, [liveMode]);

    const load = useCallback(async () => {
        if (!liveMode) return;
        const [std, mach] = await Promise.all([fetchProductionStandards(), fetchProductionMachines()]);
        setStandards(std);
        setMachines(mach);
        const nums: Record<string, string> = {};
        for (const k of NUMERIC_KEYS) {
            const row = std.find((s) => s.standard_key === k.key);
            nums[k.key] = String(row?.numeric_value ?? k.default);
        }
        setNumDraft(nums);
        const texts: Record<string, string> = {};
        for (const k of TEXT_KEYS) {
            const row = std.find((s) => s.standard_key === k.key);
            texts[k.key] = row?.text_value ?? k.default;
        }
        const wire8Row = std.find((s) => s.standard_key === WIRE8_ITEM_CODE_FIELD.key);
        texts[WIRE8_ITEM_CODE_FIELD.key] = wire8Row?.text_value ?? WIRE8_ITEM_CODE_FIELD.default;
        setTextDraft(texts);
        const machineLimits: Record<string, string> = {};
        for (const m of mach) {
            const key = machineWastageKey(m.machine_code);
            const row = std.find((s) => s.standard_key === key);
            machineLimits[m.machine_code] = row?.numeric_value != null ? String(row.numeric_value) : "";
        }
        setMachineWastageDraft(machineLimits);
        await loadLimitsPreview();
    }, [liveMode, loadLimitsPreview]);

    useEffect(() => {
        void load();
    }, [load]);

    const saveStandards = async () => {
        if (!liveMode) {
            toast({ title: "Live mode required", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            const wire8Code = (textDraft[WIRE8_ITEM_CODE_FIELD.key] ?? WIRE8_ITEM_CODE_FIELD.default).trim();
            if (!wire8Code) throw new Error("Wire No 8 item code is required.");
            const itemMap = await getItemIdsByCode([wire8Code]);
            if (!itemMap[wire8Code]) {
                throw new Error(
                    `Wire No 8 item "${wire8Code}" not found in Item Master. Add the item or update the code.`,
                );
            }

            for (const k of NUMERIC_KEYS) {
                const v = parseFloat(numDraft[k.key] ?? "");
                if (!Number.isFinite(v)) continue;
                if (v < 0) throw new Error(`${k.label}: cannot be negative`);
                const res = await saveProductionStandard(k.key, v, null);
                if (!res.ok) throw new Error(res.error);
            }
            for (const k of TEXT_KEYS) {
                const res = await saveProductionStandard(k.key, null, textDraft[k.key] ?? k.default);
                if (!res.ok) throw new Error(res.error);
            }
            const wire8Res = await saveProductionStandard(WIRE8_ITEM_CODE_FIELD.key, null, wire8Code);
            if (!wire8Res.ok) throw new Error(wire8Res.error);
            toast({ title: "Production standards saved" });
            await load();
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

    const saveMachineWastageLimits = async () => {
        if (!liveMode) {
            toast({ title: "Live mode required", variant: "destructive" });
            return;
        }
        setSavingMachineLimits(true);
        try {
            for (const m of machines) {
                const raw = machineWastageDraft[m.machine_code]?.trim() ?? "";
                if (raw === "") continue;
                const v = parseFloat(raw);
                if (!Number.isFinite(v)) continue;
                if (v < 0) throw new Error(`Machine ${m.machine_code}: wastage % cannot be negative`);
                if (
                    v === 0 &&
                    !window.confirm(
                        `Set ${m.machine_code} wastage limit to 0%? Over-limit alerts will be disabled for this machine.`,
                    )
                ) {
                    continue;
                }
                const res = await saveProductionStandard(machineWastageKey(m.machine_code), v, null);
                if (!res.ok) throw new Error(res.error);
            }
            toast({ title: "Machine wastage limits saved" });
            await load();
        } catch (e) {
            toast({
                title: "Save failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSavingMachineLimits(false);
        }
    };

    const deptDefaultWastage = (dept: ProductionMachineRow["department"]) => {
        if (dept === "enamel") return numDraft.enamel_scrap_pct ?? "2";
        if (dept === "workshop") return numDraft.workshop_wastage_pct ?? "3.5";
        return "";
    };

    const validateMachine = async (draft: MachineDraft, currentId?: string) => {
        const code = draft.code.trim().toUpperCase();
        const name = draft.name.trim();
        const scrapItemCode = draft.scrapItemCode.trim().toUpperCase();
        const sortOrder = Number(draft.sortOrder);
        if (!code || !name) throw new Error("Machine code and name are required.");
        if (machines.some((m) => m.id !== currentId && m.machine_code.toUpperCase() === code)) {
            throw new Error(`Machine code ${code} already exists.`);
        }
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
            throw new Error("Sort order must be a whole number of zero or greater.");
        }
        if (scrapItemCode) {
            const itemMap = await getItemIdsByCode([scrapItemCode]);
            if (!itemMap[scrapItemCode]) {
                throw new Error(`Scrap item "${scrapItemCode}" was not found in Item Master.`);
            }
        }
        return { code, name, scrapItemCode, sortOrder };
    };

    const addMachine = async () => {
        if (!liveMode) {
            toast({ title: "Live mode required", variant: "destructive" });
            return;
        }
        setSavingMachineId("new");
        try {
            const valid = await validateMachine({ ...newMachine, department: machineDept });
            const res = await upsertProductionMachine({
                machineCode: valid.code,
                name: valid.name,
                department: machineDept,
                scrapItemCode: valid.scrapItemCode || undefined,
                sortOrder: valid.sortOrder,
            });
            if (!res.ok) throw new Error(res.error);
            toast({ title: "Machine saved" });
            setNewMachine({ code: "", name: "", scrapItemCode: "", sortOrder: "0" });
            await load();
        } catch (e) {
            toast({
                title: "Failed to add machine",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSavingMachineId(null);
        }
    };

    const startMachineEdit = (machine: ProductionMachineRow) => {
        setEditingMachineId(machine.id);
        setMachineEditDraft({
            code: machine.machine_code,
            name: machine.name,
            department: machine.department,
            scrapItemCode: machine.scrap_item_code ?? "",
            sortOrder: String(machine.sort_order),
        });
    };

    const cancelMachineEdit = () => {
        setEditingMachineId(null);
        setMachineEditDraft(null);
    };

    const saveMachineEdit = async (machine: ProductionMachineRow) => {
        if (!machineEditDraft) return;
        setSavingMachineId(machine.id);
        try {
            const valid = await validateMachine(machineEditDraft, machine.id);
            const res = await upsertProductionMachine({
                id: machine.id,
                machineCode: valid.code,
                name: valid.name,
                department: machineEditDraft.department,
                scrapItemCode: valid.scrapItemCode || undefined,
                isActive: machine.is_active,
                sortOrder: valid.sortOrder,
            });
            if (!res.ok) throw new Error(res.error);
            toast({ title: "Machine updated" });
            cancelMachineEdit();
            await load();
        } catch (e) {
            toast({
                title: "Update failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSavingMachineId(null);
        }
    };

    const toggleMachine = async (m: ProductionMachineRow) => {
        const res = await upsertProductionMachine({
            id: m.id,
            machineCode: m.machine_code,
            name: m.name,
            department: m.department,
            scrapItemCode: m.scrap_item_code ?? undefined,
            isActive: !m.is_active,
            sortOrder: m.sort_order,
        });
        if (!res.ok) {
            toast({ title: "Update failed", description: res.error, variant: "destructive" });
            return;
        }
        await load();
    };

    const deptMachines = machines.filter((m) => m.department === machineDept);

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-5xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                        <Factory className="h-6 w-6 text-amber-600" />
                        Production settings
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Wastage percentages, machines, and scrap item mapping for enamel and workshop.
                    </p>
                </div>

                {!liveMode && (
                    <Card className="border-amber-200 bg-amber-50">
                        <CardContent className="py-4 text-sm text-amber-900">
                            Connect to Supabase live mode to edit production standards and machines.
                        </CardContent>
                    </Card>
                )}

                <Tabs defaultValue="standards">
                    <TabsScroller className="sm:flex-1">
                    <TabsList>
                        <TabsTrigger value="standards">Wastage & rules</TabsTrigger>
                        <TabsTrigger value="machines">Machines</TabsTrigger>
                    </TabsList>
                    </TabsScroller>

                    <TabsContent value="standards" className="mt-4 space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Standard percentages</CardTitle>
                                <CardDescription>Used for auto-calc and MTD scrap alerts.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 sm:grid-cols-2">
                                {NUMERIC_KEYS.map((k) => (
                                    <div key={k.key} className="space-y-1.5">
                                        <Label className="text-xs">{k.label}</Label>
                                        <Input
                                            type="number"
                                            step="0.1"
                                            className="font-mono"
                                            value={numDraft[k.key] ?? ""}
                                            onChange={(e) => setNumDraft((d) => ({ ...d, [k.key]: e.target.value }))}
                                            disabled={!liveMode}
                                        />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Item codes</CardTitle>
                            </CardHeader>
                            <CardContent className="grid gap-4 sm:grid-cols-2">
                                {TEXT_KEYS.map((k) => (
                                    <div key={k.key} className="space-y-1.5">
                                        <Label className="text-xs">{k.label}</Label>
                                        <Input
                                            className="font-mono text-sm"
                                            value={textDraft[k.key] ?? k.default}
                                            onChange={(e) => setTextDraft((d) => ({ ...d, [k.key]: e.target.value }))}
                                            disabled={!liveMode}
                                        />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Wire No 8</CardTitle>
                                <CardDescription>
                                    Single raw-material SKU for inventory. Purchase invoices tag purity (Fail / Pass /
                                    Special) per line for watta; enamel production issues from this item.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1.5 max-w-sm">
                                    <Label className="text-xs">{WIRE8_ITEM_CODE_FIELD.label}</Label>
                                    <Input
                                        className="font-mono text-sm"
                                        value={textDraft[WIRE8_ITEM_CODE_FIELD.key] ?? WIRE8_ITEM_CODE_FIELD.default}
                                        onChange={(e) =>
                                            setTextDraft((d) => ({ ...d, [WIRE8_ITEM_CODE_FIELD.key]: e.target.value }))
                                        }
                                        disabled={!liveMode}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                        <Button onClick={() => void saveStandards()} disabled={!liveMode || saving}>
                            <Save className="h-4 w-4 mr-2" />
                            Save standards
                        </Button>
                        {limitsPreview.length > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">Effective limits preview (MTD)</CardTitle>
                                    <CardDescription>
                                        Per-machine scrap % vs effective limit after save. Blank machine override uses
                                        department default.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <TableScroller>
                                        <Table noWrapper>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Dept</TableHead>
                                                    <TableHead>Machine</TableHead>
                                                    <TableHead className="text-right">Input kg</TableHead>
                                                    <TableHead className="text-right">Scrap kg</TableHead>
                                                    <TableHead className="text-right">Scrap %</TableHead>
                                                    <TableHead className="text-right">Limit %</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {limitsPreview.map((r) => (
                                                    <TableRow key={r.machine_id}>
                                                        <TableCell className="capitalize text-xs">{r.department}</TableCell>
                                                        <TableCell className="font-mono text-xs">{r.machine_code}</TableCell>
                                                        <TableCell className="text-right font-mono text-xs">
                                                            {r.input_kg.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-xs">
                                                            {r.scrap_kg.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell
                                                            className={`text-right font-mono text-xs ${
                                                                r.standard_pct > 0 && r.scrap_pct > r.standard_pct
                                                                    ? "text-rose-700 font-semibold"
                                                                    : ""
                                                            }`}
                                                        >
                                                            {r.scrap_pct}%
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-xs text-slate-500">
                                                            {r.standard_pct}%
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableScroller>
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    <TabsContent value="machines" className="mt-4 space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Add machine</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    {(["drawing", "enamel", "workshop"] as const).map((d) => (
                                        <Button
                                            key={d}
                                            size="sm"
                                            variant={machineDept === d ? "default" : "outline"}
                                            onClick={() => setMachineDept(d)}
                                        >
                                            {d}
                                        </Button>
                                    ))}
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Code</Label>
                                        <Input
                                            placeholder="D5"
                                            value={newMachine.code}
                                            onChange={(e) => setNewMachine((m) => ({ ...m, code: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Name</Label>
                                        <Input
                                            value={newMachine.name}
                                            onChange={(e) => setNewMachine((m) => ({ ...m, name: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Scrap item code</Label>
                                        <Input
                                            className="font-mono"
                                            placeholder="RM-SCP-DRAW"
                                            value={newMachine.scrapItemCode}
                                            onChange={(e) => setNewMachine((m) => ({ ...m, scrapItemCode: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Sort order</Label>
                                        <Input
                                            type="number"
                                            value={newMachine.sortOrder}
                                            onChange={(e) => setNewMachine((m) => ({ ...m, sortOrder: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <Button
                                    onClick={() => void addMachine()}
                                    disabled={!liveMode || savingMachineId === "new"}
                                >
                                    <Plus className="h-4 w-4 mr-2" />
                                    {savingMachineId === "new" ? "Saving…" : "Add machine"}
                                </Button>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Machines & scrap types</CardTitle>
                                <CardDescription>
                                    Each machine posts scrap to its linked item. Per-machine wastage % overrides
                                    department defaults for alerts; leave blank to use dept default.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <TableScroller>
                                    <Table noWrapper>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Dept</TableHead>
                                                <TableHead>Code</TableHead>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Scrap item</TableHead>
                                                <TableHead className="w-28">Override %</TableHead>
                                                <TableHead>Active</TableHead>
                                                <TableHead className="w-24 text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {machines.map((m) => {
                                                const isEditing = editingMachineId === m.id && machineEditDraft;
                                                return (
                                                <TableRow key={m.id}>
                                                    <TableCell className="capitalize text-xs">
                                                        {isEditing ? (
                                                            <Select
                                                                value={machineEditDraft.department}
                                                                onValueChange={(department: ProductionMachineRow["department"]) =>
                                                                    setMachineEditDraft((draft) =>
                                                                        draft ? { ...draft, department } : draft,
                                                                    )
                                                                }
                                                            >
                                                                <SelectTrigger className="h-8 min-w-28">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="drawing">Drawing</SelectItem>
                                                                    <SelectItem value="enamel">Enamel</SelectItem>
                                                                    <SelectItem value="workshop">Workshop</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            m.department
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="font-mono">
                                                        {isEditing ? (
                                                            <Input
                                                                className="h-8 min-w-24 font-mono uppercase"
                                                                value={machineEditDraft.code}
                                                                onChange={(e) =>
                                                                    setMachineEditDraft((draft) =>
                                                                        draft ? { ...draft, code: e.target.value } : draft,
                                                                    )
                                                                }
                                                            />
                                                        ) : (
                                                            m.machine_code
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {isEditing ? (
                                                            <Input
                                                                className="h-8 min-w-36"
                                                                value={machineEditDraft.name}
                                                                onChange={(e) =>
                                                                    setMachineEditDraft((draft) =>
                                                                        draft ? { ...draft, name: e.target.value } : draft,
                                                                    )
                                                                }
                                                            />
                                                        ) : (
                                                            m.name
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        {isEditing ? (
                                                            <Input
                                                                className="h-8 min-w-36 font-mono uppercase"
                                                                value={machineEditDraft.scrapItemCode}
                                                                onChange={(e) =>
                                                                    setMachineEditDraft((draft) =>
                                                                        draft
                                                                            ? { ...draft, scrapItemCode: e.target.value }
                                                                            : draft,
                                                                    )
                                                                }
                                                            />
                                                        ) : (
                                                            m.scrap_item_code ?? "—"
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {isEditing ? (
                                                            <Input
                                                                type="number"
                                                                min="0"
                                                                step="1"
                                                                className="h-8 w-20 font-mono text-xs"
                                                                value={machineEditDraft.sortOrder}
                                                                aria-label="Sort order"
                                                                onChange={(e) =>
                                                                    setMachineEditDraft((draft) =>
                                                                        draft ? { ...draft, sortOrder: e.target.value } : draft,
                                                                    )
                                                                }
                                                            />
                                                        ) : (
                                                            <Input
                                                                type="number"
                                                                step="0.1"
                                                                className="h-8 font-mono text-xs"
                                                                placeholder={deptDefaultWastage(m.department)}
                                                                value={machineWastageDraft[m.machine_code] ?? ""}
                                                                onChange={(e) =>
                                                                    setMachineWastageDraft((d) => ({
                                                                        ...d,
                                                                        [m.machine_code]: e.target.value,
                                                                    }))
                                                                }
                                                                disabled={!liveMode}
                                                            />
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Switch
                                                            checked={m.is_active}
                                                            onCheckedChange={() => void toggleMachine(m)}
                                                            disabled={!liveMode || Boolean(isEditing) || savingMachineId === m.id}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-right whitespace-nowrap">
                                                        {isEditing ? (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    aria-label={`Save ${m.machine_code}`}
                                                                    disabled={savingMachineId === m.id}
                                                                    onClick={() => void saveMachineEdit(m)}
                                                                >
                                                                    <Check className="h-4 w-4 text-emerald-600" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    aria-label={`Cancel editing ${m.machine_code}`}
                                                                    disabled={savingMachineId === m.id}
                                                                    onClick={cancelMachineEdit}
                                                                >
                                                                    <X className="h-4 w-4 text-slate-500" />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                aria-label={`Edit ${m.machine_code}`}
                                                                disabled={!liveMode || savingMachineId !== null}
                                                                onClick={() => startMachineEdit(m)}
                                                            >
                                                                <Pencil className="h-4 w-4 text-blue-600" />
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                                );
                                            })}
                                            {machines.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={7} className="text-center text-slate-500 py-6">
                                                        No machines — run migration 124 or add above.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableScroller>
                                {machines.length > 0 && (
                                    <Button
                                        variant="outline"
                                        onClick={() => void saveMachineWastageLimits()}
                                        disabled={!liveMode || savingMachineLimits}
                                    >
                                        <Save className="h-4 w-4 mr-2" />
                                        Save machine wastage limits
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
