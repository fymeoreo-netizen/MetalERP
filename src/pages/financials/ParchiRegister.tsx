import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IssueParchiModal } from "@/components/parchi/IssueParchiModal";
import { ParchiSlip } from "@/components/parchi/ParchiSlip";
import { FileText, Plus, Search, Receipt, Clock, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allocateNextParchiNo } from "@/lib/documentNumbers";
import {
    createParchiDocument,
    postDocument,
    repairVoidedParchiOrphanGl,
    updateParchiDocument,
    voidParchiDocument,
} from "@/lib/api/posting";
import { fetchParchis } from "@/lib/api/reports";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";
import { getParties, initPartyCatalog, resolvePartyName } from "@/lib/partyCatalog";
import type { ParchiFormValues, ParchiRegisterRow, ParchiStatusLabel } from "@/lib/parchiTypes";
import { formatParchiAmount } from "@/lib/parchiTypes";
import { cn } from "@/lib/utils";

const CARD = "shadow-soft border-slate-100 bg-white";

const INITIAL_PARCHIS: ParchiRegisterRow[] = [
    { id: "PAR-26-105", parchi_type: "Company Parchi", date: "2026-05-01", due_date: "2026-05-15", party: "Alpha Cables (Customer)", total_amount: 500000, cleared_amount: 200000, available_balance: 300000, status: "Pending", direction: "Received" },
    { id: "PAR-26-106", parchi_type: "Bank Cheque", cheque_no: "992831", bank: "Meezan Bank", date: "2026-05-02", due_date: "2026-05-20", party: "Alpha Cables (Customer)", total_amount: 100000, cleared_amount: 0, available_balance: 100000, status: "Pending", direction: "Issued" },
    { id: "PAR-26-201", parchi_type: "Company Parchi", date: "2026-04-10", due_date: "2026-04-30", party: "Gamma Scrap (Vendor)", total_amount: 750000, cleared_amount: 500000, available_balance: 250000, status: "Partially Cleared", direction: "Received" },
    { id: "PAR-26-099", parchi_type: "Company Parchi", date: "2026-03-01", due_date: "2026-03-15", party: "Gateway Motors (Customer)", total_amount: 300000, cleared_amount: 300000, available_balance: 0, status: "Cleared", direction: "Issued" },
];

const EMPTY_FORM: ParchiFormValues = {
    party: "",
    amount: "",
    dueDate: "",
    date: new Date().toISOString().split("T")[0],
    direction: "Received",
    guarantor: "none",
    narration: "",
    bank: "",
    parchiType: "Company Parchi",
    chequeNo: "",
};

type StatusFilter = "all" | ParchiStatusLabel;

function KpiTile({
    label,
    value,
    icon: Icon,
    tone,
}: {
    label: string;
    value: string;
    icon: typeof FileText;
    tone: string;
}) {
    return (
        <Card className={cn(CARD, "hover:-translate-y-0.5 transition-transform")}>
            <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", tone)}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
                    <p className="text-lg font-semibold text-slate-900 tabular-nums truncate">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

export default function ParchiRegister() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const [parchis, setParchis] = useState<ParchiRegisterRow[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingParchi, setEditingParchi] = useState<ParchiRegisterRow | null>(null);
    const [form, setForm] = useState<ParchiFormValues>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [parties, setParties] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        void initPartyCatalog().then(() => {
            setParties(getParties().map((p) => ({ id: p.id, name: p.name })));
        });
    }, []);

    const refreshParchis = useCallback(async () => {
        if (!liveMode) {
            setParchis(INITIAL_PARCHIS);
            return;
        }
        const rows = await fetchParchis();
        setParchis(
            rows
                .filter((p: { status: string }) => p.status !== "void")
                .map((p: Record<string, unknown>) => ({
                    id: String(p.parchi_no),
                    dbId: String(p.id),
                    parchi_type: p.parchi_type === "bank_cheque" ? "Bank Cheque" : "Company Parchi",
                    date: String(p.issue_date),
                    due_date: String(p.due_date),
                    party: (p.parties as { name?: string })?.name ?? "",
                    partyCode: (p.parties as { code?: string })?.code ?? "",
                    total_amount: Number(p.total_amount),
                    cleared_amount: Number(p.cleared_amount),
                    available_balance: Number(p.open_amount),
                    status:
                        p.status === "cleared"
                            ? "Cleared"
                            : p.status === "partial"
                              ? "Partially Cleared"
                              : "Pending",
                    bank: p.bank_name ? String(p.bank_name) : undefined,
                    cheque_no: p.cheque_no ? String(p.cheque_no) : undefined,
                    guarantor: p.guarantor ? String(p.guarantor) : undefined,
                    narration: p.narration ? String(p.narration) : undefined,
                    direction: p.direction === "received" ? "Received" : "Issued",
                })),
        );
    }, [liveMode]);

    useEffect(() => {
        if (!liveMode) return;
        void repairVoidedParchiOrphanGl().finally(() => refreshParchis());
    }, [liveMode, refreshParchis]);

    const setField = <K extends keyof ParchiFormValues>(key: K, value: ParchiFormValues[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const filteredParchis = useMemo(() => {
        return parchis.filter((p) => {
            const q = searchQuery.toLowerCase();
            const matchesSearch =
                !q || p.party.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
            const matchesStatus = statusFilter === "all" || p.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [parchis, searchQuery, statusFilter]);

    const openBalance = parchis.reduce((acc, p) => acc + p.available_balance, 0);
    const pendingCount = parchis.filter((p) => p.status !== "Cleared").length;
    const clearedCount = parchis.filter((p) => p.status === "Cleared").length;

    const resetForm = () => {
        setForm({
            ...EMPTY_FORM,
            date: new Date().toISOString().split("T")[0],
        });
    };

    const handleOpenAdd = () => {
        setEditingParchi(null);
        resetForm();
        setIsModalOpen(true);
    };

    const handleOpenEdit = (p: ParchiRegisterRow) => {
        setEditingParchi(p);
        setForm({
            party: p.partyCode || p.party,
            amount: p.total_amount.toString(),
            dueDate: p.due_date,
            date: p.date,
            direction: p.direction || "Received",
            guarantor: p.guarantor || "none",
            narration: p.narration || "",
            bank: p.bank || "",
            parchiType: p.parchi_type,
            chequeNo: p.cheque_no || "",
        });
        setIsModalOpen(true);
    };

    const handleDelete = async (p: ParchiRegisterRow) => {
        if (!confirm("Void this parchi? It will be removed from the active register.")) return;

        if (liveMode) {
            if (!p.dbId) {
                toast({ title: "Void failed", description: "Missing record id.", variant: "destructive" });
                return;
            }
            const result = await voidParchiDocument(p.dbId);
            if (!result.ok) {
                toast({ title: "Void failed", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Parchi voided", description: `${p.id} removed.${result.data.glReversed ? ` ${result.data.glReversed} GL reversal(s) posted.` : ""}` });
            await refreshParchis();
            return;
        }
        setParchis((rows) => rows.filter((row) => row.id !== p.id));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
        if (editingParchi) {
                if (liveMode) {
                    if (!editingParchi.dbId) {
                        toast({ title: "Update failed", description: "Missing record id.", variant: "destructive" });
                        return;
                    }
                    const result = await updateParchiDocument(editingParchi.dbId, {
                        partyCode: form.party,
                        parchiType: form.parchiType === "Bank Cheque" ? "bank_cheque" : "company_parchi",
                        direction: form.direction === "Received" ? "received" : "issued",
                        issueDate: form.date,
                        dueDate: form.dueDate,
                        totalAmount: Number(form.amount),
                        bankName: form.bank,
                        chequeNo: form.chequeNo,
                        guarantor: form.guarantor,
                        narration: form.narration,
                    });
                    if (!result.ok) {
                        toast({ title: "Update failed", description: result.error, variant: "destructive" });
                        return;
                    }
                    toast({ title: "Parchi updated", description: editingParchi.id });
                    await refreshParchis();
                } else {
                    const numAmount = Number(form.amount);
                    setParchis((rows) =>
                        rows.map((p) => {
                            if (p.id !== editingParchi.id) return p;
                    const diff = numAmount - p.total_amount;
                    return {
                        ...p,
                                party: resolvePartyName(form.party, form.party),
                                date: form.date,
                                due_date: form.dueDate,
                                direction: form.direction,
                                guarantor: form.guarantor,
                                narration: form.narration,
                                bank: form.bank,
                                parchi_type: form.parchiType,
                                cheque_no: form.chequeNo,
                        total_amount: numAmount,
                        available_balance: p.available_balance + diff,
                    };
                        }),
                    );
                }
            } else if (liveMode) {
                const parchiNo = await allocateNextParchiNo();
                const result = await createParchiDocument({
                    parchiNo,
                    parchiType: form.parchiType === "Bank Cheque" ? "bank_cheque" : "company_parchi",
                    direction: form.direction === "Received" ? "received" : "issued",
                    partyCode: form.party,
                    issueDate: form.date,
                    dueDate: form.dueDate,
                    totalAmount: Number(form.amount),
                    bankName: form.bank,
                    chequeNo: form.chequeNo,
                    guarantor: form.guarantor,
                    narration: form.narration,
                });
                if (!result.ok) {
                    toast({ title: "Save failed", description: result.error, variant: "destructive" });
                    return;
                }
                try {
                    await postDocument("post_parchi_issue", result.data.id);
                } catch (e) {
                    toast({
                        title: "Registration failed",
                        description: e instanceof Error ? e.message : "Post error",
                        variant: "destructive",
                    });
                    return;
                }
                toast({
                    title: "Parchi issued",
                    description: "Registered — clears in cashbook when paid.",
                });
                await refreshParchis();
        } else {
                const numAmount = Number(form.amount);
                const parchiNo = await allocateNextParchiNo();
                const newParchi: ParchiRegisterRow = {
                    id: parchiNo,
                    date: form.date,
                    due_date: form.dueDate,
                    party: resolvePartyName(form.party, form.party),
                    direction: form.direction,
                    guarantor: form.guarantor,
                    narration: form.narration,
                    bank: form.bank,
                    parchi_type: form.parchiType,
                    cheque_no: form.chequeNo,
                total_amount: numAmount,
                cleared_amount: 0,
                available_balance: numAmount,
                    status: "Pending",
            };
            setParchis([newParchi, ...parchis]);
        }
        setIsModalOpen(false);
        } finally {
            setSaving(false);
        }
    };

    const FILTER_CHIPS: { id: StatusFilter; label: string }[] = [
        { id: "all", label: "All" },
        { id: "Pending", label: "Pending" },
        { id: "Partially Cleared", label: "Partial" },
        { id: "Cleared", label: "Cleared" },
    ];

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-[1400px] mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Parchi register</h1>
                        <p className="text-slate-500 mt-1 text-sm">
                            Informal commitments and hwala slips — track until cashbook clearance.
                        </p>
                    </div>
                    <Button
                        onClick={handleOpenAdd}
                        className="rounded-lg bg-zinc-900 hover:bg-zinc-800 shadow-soft h-10"
                    >
                            <Plus className="h-4 w-4 mr-2" />
                        Issue parchi
                        </Button>
                    </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <KpiTile
                        label="Open balance"
                        value={formatParchiAmount(openBalance)}
                        icon={Wallet}
                        tone="bg-violet-50 text-violet-600"
                    />
                    <KpiTile
                        label="Pending slips"
                        value={String(pendingCount)}
                        icon={Clock}
                        tone="bg-amber-50 text-amber-600"
                    />
                    <KpiTile
                        label="Cleared"
                        value={String(clearedCount)}
                        icon={FileText}
                        tone="bg-emerald-50 text-emerald-600"
                    />
                </div>

                <Card className={CARD}>
                    <CardHeader className="pb-3 border-b border-slate-100">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-base font-semibold">Issued parchis</CardTitle>
                                <CardDescription className="text-xs mt-0.5">
                                    {filteredParchis.length} slip{filteredParchis.length === 1 ? "" : "s"} shown
                                </CardDescription>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-slate-100/80">
                                    {FILTER_CHIPS.map((chip) => (
                                        <button
                                            key={chip.id}
                                            type="button"
                                            onClick={() => setStatusFilter(chip.id)}
                                            className={cn(
                                                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                                                statusFilter === chip.id
                                                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                                                    : "text-slate-500 hover:text-slate-700",
                                            )}
                                        >
                                            {chip.label}
                                        </button>
                                    ))}
                            </div>
                            <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                                <Input 
                                        placeholder="Search party or serial…"
                                        className="pl-9 w-full sm:w-[240px] h-9 bg-white border-slate-200"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 md:p-6 bg-slate-50/40">
                        {filteredParchis.length === 0 ? (
                            <div className="text-center py-16 text-slate-500">
                                <Receipt className="mx-auto h-12 w-12 text-slate-300 mb-3" />
                                <p className="font-medium text-slate-700">No parchis found</p>
                                <p className="text-xs mt-1 max-w-sm mx-auto">
                                    Issue a parchi to record a commitment before cashbook clearance.
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-4"
                                    onClick={handleOpenAdd}
                                >
                                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                                    Issue parchi
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                                {filteredParchis.map((p) => (
                                    <ParchiSlip
                                        key={p.id}
                                        parchi={p}
                                        liveMode={liveMode}
                                        onEdit={() => handleOpenEdit(p)}
                                        onVoid={() => void handleDelete(p)}
                                    />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <IssueParchiModal
                    open={isModalOpen}
                    onOpenChange={setIsModalOpen}
                    editing={editingParchi}
                    values={form}
                    onChange={setField}
                    parties={parties}
                    onSave={() => void handleSave()}
                    saving={saving}
                />
            </div>
        </DashboardLayout>
    );
}
