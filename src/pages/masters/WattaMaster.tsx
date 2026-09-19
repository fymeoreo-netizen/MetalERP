import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    fetchWattaMatrix,
    upsertWattaMatrix,
    deleteWattaMatrix,
    applyWattaMatrixRecalc,
} from "@/lib/repositories/wattaRepo";
import { WattaRecalcProgressDialog, type WattaRecalcProgress } from "@/components/watta/WattaRecalcProgressDialog";
import type { WattaMatrixRow } from "@/lib/scrapObligationTypes";
import { getCustomers, getSuppliers, initPartyCatalog } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";
import { WattaMatrixTabs } from "@/components/watta/WattaMatrixTabs";
import { WattaMatrixTable } from "@/components/watta/WattaMatrixTable";
import { WattaMatrixFormDialog } from "@/components/watta/WattaMatrixFormDialog";
import { WattaPreviewCard } from "@/components/watta/WattaPreviewCard";
import {
    findWattaOverlapWarning,
    hasStandardEnamelDefaults,
    STANDARD_ENAMEL_PRESETS,
    type WattaFormValues,
} from "@/lib/wattaMatrixValidation";
import { cn } from "@/lib/utils";

const CARD = "shadow-soft border-slate-100 bg-white";

const DEMO: WattaMatrixRow[] = [
    {
        id: "demo-1",
        party_id: null,
        direction: "sales",
        product_kind: "enamel",
        wire8_grade: null,
        swg_min: 1,
        swg_max: 24,
        base_watta: 503,
        increment_per_swg: 0,
        effective_from: "2026-01-01",
        is_active: true,
        remarks: "Default enamel 1-24 SWG",
    },
    {
        id: "demo-2",
        party_id: null,
        direction: "sales",
        product_kind: "enamel",
        wire8_grade: null,
        swg_min: 25,
        swg_max: 30,
        base_watta: 503,
        increment_per_swg: 20,
        effective_from: "2026-01-01",
        is_active: true,
        remarks: "+20 per SWG above 24",
    },
    {
        id: "demo-3",
        party_id: null,
        direction: "purchase",
        product_kind: "wire8",
        wire8_grade: "Pass",
        swg_min: null,
        swg_max: null,
        base_watta: 45,
        increment_per_swg: 0,
        effective_from: "2026-01-01",
        is_active: true,
        remarks: "Demo wire8 pass",
    },
];

function demoId() {
    return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function WattaMaster() {
    const { toast } = useToast();
    const [rows, setRows] = useState<WattaMatrixRow[]>([]);
    const [tab, setTab] = useState<"sales" | "purchase">("sales");
    const [partyFilter, setPartyFilter] = useState("");
    const [search, setSearch] = useState("");
    const [showInactive, setShowInactive] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<WattaMatrixRow | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<WattaMatrixRow | null>(null);
    const [recalcOffer, setRecalcOffer] = useState<{
        effectiveFrom: string;
        partyId: string | null;
        estimated: number;
    } | null>(null);
    const [recalcProgressOpen, setRecalcProgressOpen] = useState(false);
    const [recalcProgress, setRecalcProgress] = useState<WattaRecalcProgress>({
        running: false,
        estimatedTotal: 0,
        processed: 0,
        updatedDrafts: 0,
        updatedPosted: 0,
        skipped: 0,
        done: false,
    });
    const recalcCancelRef = useRef(false);
    const [recalcEffectiveFrom, setRecalcEffectiveFrom] = useState("");

    const customers = useMemo(() => getCustomers().map((p) => ({ id: p.id, name: p.name, code: p.id })), [rows]);
    const vendors = useMemo(() => {
        const seen = new Set<string>();
        return getSuppliers()
            .filter((p) => {
                if (seen.has(p.id)) return false;
                seen.add(p.id);
                return true;
            })
            .map((p) => ({ id: p.id, name: p.name, code: p.id }));
    }, [rows]);

    const load = useCallback(async () => {
        if (!isErpLiveMode()) {
            setRows(DEMO);
            return DEMO;
        }
        const data = await fetchWattaMatrix();
        setRows(data);
        return data;
    }, []);

    useEffect(() => {
        void initPartyCatalog().then(() => load().catch(() => setRows([])));
    }, [load]);

    const filterRows = useCallback(
        (dir: "sales" | "purchase") => {
        let list = rows.filter((r) => r.direction === dir);
        if (!showInactive) list = list.filter((r) => r.is_active);
        if (partyFilter) list = list.filter((r) => (r.party_code ?? r.party_id) === partyFilter);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (r) =>
                    (r.party_name ?? "default").toLowerCase().includes(q) ||
                    (r.remarks ?? "").toLowerCase().includes(q) ||
                    String(r.base_watta).includes(q),
            );
        }
        return list;
        },
        [rows, partyFilter, search, showInactive],
    );

    const partiesForTab = tab === "sales" ? customers : vendors;

    const handleSubmit = async (values: WattaFormValues) => {
        const overlap = findWattaOverlapWarning(values, rows);
        if (overlap) {
            toast({ title: "Overlap warning", description: overlap });
        }

        if (!isErpLiveMode()) {
            const party = partiesForTab.find((p) => p.id === values.party_id);
            const next: WattaMatrixRow = {
                id: values.id ?? demoId(),
                party_id: values.party_id,
                party_name: party?.name ?? null,
                direction: values.direction,
                product_kind: values.product_kind,
                wire8_grade: values.wire8_grade,
                swg_min: values.swg_min,
                swg_max: values.swg_max,
                base_watta: values.base_watta,
                increment_per_swg: values.increment_per_swg,
                effective_from: values.effective_from,
                is_active: values.is_active,
                remarks: values.remarks,
            };
            setRows((prev) => {
                const idx = prev.findIndex((r) => r.id === next.id);
                if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = next;
                    return copy;
                }
                return [...prev, next];
            });
            toast({ title: values.id ? "Row updated (demo)" : "Row created (demo)" });
            return;
        }

        const res = await upsertWattaMatrix({
            id: values.id,
            party_id: values.party_id,
            direction: values.direction,
            product_kind: values.product_kind,
            wire8_grade: values.wire8_grade,
            swg_min: values.swg_min,
            swg_max: values.swg_max,
            base_watta: values.base_watta,
            increment_per_swg: values.increment_per_swg,
            effective_from: values.effective_from,
            is_active: values.is_active,
            remarks: values.remarks,
        });
        if (!res.ok) throw new Error(res.error);
        toast({ title: values.id ? "Watta row updated" : "Watta row created" });
        setRows((prev) => {
            const saved = res.data.row;
            const idx = prev.findIndex((r) => r.id === saved.id);
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = saved;
                return copy;
            }
            return [saved, ...prev];
        });
        try {
            await load();
        } catch {
            toast({
                title: "Saved but list refresh failed",
                description: "The row was saved. Reload the page if it does not appear.",
                variant: "destructive",
            });
        }

        if (values.direction === "sales" && values.product_kind === "enamel") {
            const dry = await applyWattaMatrixRecalc({
                effectiveFrom: values.effective_from,
                partyId: res.data.row.party_id,
                productKind: "enamel",
                dryRun: true,
            });
            if (dry.ok && (dry.data.estimated_total ?? 0) > 0) {
                setRecalcOffer({
                    effectiveFrom: values.effective_from,
                    partyId: res.data.row.party_id,
                    estimated: dry.data.estimated_total ?? 0,
                });
            }
        }
    };

    const runRecalcBatches = async () => {
        if (!recalcOffer || !isErpLiveMode()) return;
        const offer = recalcOffer;
        recalcCancelRef.current = false;
        setRecalcEffectiveFrom(offer.effectiveFrom);
        setRecalcProgressOpen(true);
        setRecalcProgress({
            running: true,
            estimatedTotal: offer.estimated,
            processed: 0,
            updatedDrafts: 0,
            updatedPosted: 0,
            skipped: 0,
            done: false,
        });

        let cursor: string | null = null;
        let done = false;
        let processed = 0;
        let updatedDrafts = 0;
        let updatedPosted = 0;
        let skipped = 0;

        while (!done && !recalcCancelRef.current) {
            const batch = await applyWattaMatrixRecalc({
                effectiveFrom: offer.effectiveFrom,
                partyId: offer.partyId,
                productKind: "enamel",
                includePosted: true,
                batchSize: 25,
                afterInvoiceId: cursor,
                dryRun: false,
            });
            if (!batch.ok) {
                toast({ title: "Recalc failed", description: batch.error, variant: "destructive" });
                break;
            }
            processed += batch.data.processed ?? 0;
            updatedDrafts += batch.data.updated_drafts ?? 0;
            updatedPosted += batch.data.updated_posted ?? 0;
            skipped += batch.data.skipped ?? 0;
            done = Boolean(batch.data.done);
            cursor = batch.data.last_invoice_id ?? cursor;
            setRecalcProgress({
                running: !done,
                estimatedTotal: offer.estimated,
                processed,
                updatedDrafts,
                updatedPosted,
                skipped,
                done,
            });
        }

        setRecalcProgress((p) => ({ ...p, running: false, done: true }));
        toast({
            title: "Watta applied to invoices",
            description: `${updatedDrafts} draft(s), ${updatedPosted} posted, ${skipped} skipped.`,
        });
        setRecalcOffer(null);
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        if (!isErpLiveMode()) {
            setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
            toast({ title: "Row deleted (demo)" });
            setDeleteTarget(null);
            return;
        }
        const res = await deleteWattaMatrix(deleteTarget.id);
        if (!res.ok) {
            toast({ title: "Delete failed", description: res.error, variant: "destructive" });
            return;
        }
        toast({ title: "Watta row deleted" });
        setDeleteTarget(null);
        await load();
    };

    const seedStandardEnamel = async () => {
        if (hasStandardEnamelDefaults(rows)) {
            toast({ title: "Already present", description: "Default enamel bands (1–24 and 25–30) exist." });
            return;
        }
        for (const preset of STANDARD_ENAMEL_PRESETS) {
            await handleSubmit({ ...preset, party_id: null });
        }
    };

    const activeSales = rows.filter((r) => r.direction === "sales" && r.is_active).length;
    const activePurchase = rows.filter((r) => r.direction === "purchase" && r.is_active).length;

    const renderMatrixSection = (direction: "sales" | "purchase") => {
        const parties = direction === "sales" ? customers : vendors;
        const partyFilterOptions = toPartyComboboxOptions(parties);
        const filteredRows = filterRows(direction);
        return (
        <Card className={CARD}>
            <CardHeader>
                <CardTitle className="text-lg">{direction === "sales" ? "Premium sales watta" : "Premium purchase watta"}</CardTitle>
                <CardDescription>
                    {direction === "sales"
                        ? "Enamel SWG bands per customer (or default). Used on premium sales invoices: rate = scrap + watta."
                        : "Wire No 8 (Fail / Pass / Special) and copper rod per vendor. Used on premium purchase."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-3 items-end">
                <div className="grid gap-1 min-w-[160px]">
                    <Label className="text-xs text-zinc-500">Filter party</Label>
                    <PartyCombobox
                        value={partyFilter || "__all"}
                        onValueChange={(v) => setPartyFilter(v === "__all" ? "" : v)}
                        options={partyFilterOptions}
                        placeholder="All parties"
                        leadingOptions={[{ value: "__all", label: "All parties" }]}
                        className="h-9"
                    />
                </div>
                <div className="relative min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                    <Input
                        className="pl-9 h-9"
                        placeholder="Search party, remarks…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <label className="flex items-center gap-2 text-sm text-zinc-600 pb-1">
                    <Checkbox checked={showInactive} onCheckedChange={(c) => setShowInactive(c === true)} />
                    Show inactive
                </label>
            </div>
            <div className="flex flex-wrap gap-2">
                {direction === "sales" && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => void seedStandardEnamel()}>
                        <Sparkles className="h-4 w-4 mr-1" />
                        Standard enamel bands
                    </Button>
                )}
                <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                        setEditing(null);
                        setTab(direction);
                        setDialogOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4 mr-1" />
                    Add row
                </Button>
            </div>
        </div>
                <WattaMatrixTable
                    rows={filteredRows}
                    direction={direction}
                    onEdit={(row) => {
                        setEditing(row);
                        setTab(direction);
                        setDialogOpen(true);
                    }}
                    onDelete={setDeleteTarget}
                />
            </CardContent>
        </Card>
        );
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                    <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Watta matrix</h1>
                    <p className="text-slate-500 mt-1">
                        Set, edit, and delete watta for premium sales (enamel by gauge) and premium purchase (wire / rod).
                    </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                    <Card className={cn(CARD, "hover:-translate-y-0.5 transition-transform")}>
                        <CardContent className="p-4">
                            <p className="text-xs text-zinc-500">Active sales rows</p>
                            <p className="text-2xl font-bold tabular-nums">{activeSales}</p>
                        </CardContent>
                    </Card>
                    <Card className={cn(CARD, "hover:-translate-y-0.5 transition-transform")}>
                        <CardContent className="p-4">
                            <p className="text-xs text-zinc-500">Active purchase rows</p>
                            <p className="text-2xl font-bold tabular-nums">{activePurchase}</p>
                        </CardContent>
                    </Card>
                    <Card className={cn(CARD)}>
                        <CardContent className="p-4 text-sm text-zinc-600">
                            {!isErpLiveMode() ? (
                                <span>Demo mode — changes stay in browser until Supabase is connected.</span>
                            ) : rows.length === 0 ? (
                                <span>
                                    No matrix rows. Apply migration <strong>77</strong> on Supabase if the table is missing.
                                </span>
                            ) : (
                                <span>Party-specific rows override company defaults when resolving watta.</span>
                            )}
                    </CardContent>
                </Card>
                </div>

                <WattaMatrixTabs
                    tab={tab}
                    onTabChange={setTab}
                    salesContent={
                        <>
                            <WattaPreviewCard direction="sales" parties={customers} />
                            <div className="mt-4">{renderMatrixSection("sales")}</div>
                        </>
                    }
                    purchaseContent={
                        <>
                            <WattaPreviewCard direction="purchase" parties={vendors} />
                            <div className="mt-4">{renderMatrixSection("purchase")}</div>
                        </>
                    }
                />

                <WattaMatrixFormDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    direction={tab}
                    parties={partiesForTab}
                    initial={editing}
                    onSubmit={handleSubmit}
                />

                <AlertDialog open={Boolean(recalcOffer)} onOpenChange={(o) => !o && setRecalcOffer(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Apply watta to existing invoices?</AlertDialogTitle>
                            <AlertDialogDescription>
                                About {recalcOffer?.estimated ?? 0} premium sales invoice(s) from{" "}
                                {recalcOffer?.effectiveFrom} may be updated. Posted invoices with open AR receive ledger
                                adjustments; partial payments are skipped.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Not now</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void runRecalcBatches()}>Apply now</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <WattaRecalcProgressDialog
                    open={recalcProgressOpen}
                    onOpenChange={setRecalcProgressOpen}
                    progress={recalcProgress}
                    effectiveFrom={recalcEffectiveFrom}
                    onCancel={() => {
                        recalcCancelRef.current = true;
                    }}
                />

                <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete watta row?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This removes the matrix entry permanently. Prefer deactivating if you need history.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void confirmDelete()}>
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </DashboardLayout>
    );
}
