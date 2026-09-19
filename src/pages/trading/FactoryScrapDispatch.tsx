import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Send, PackageCheck, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { notifyProductionUpdated } from "@/lib/queryClient";
import {
    CreateFactoryScrapDispatchModal,
    type FactoryScrapDispatchFormPayload,
} from "@/components/trading/CreateFactoryScrapDispatchModal";
import { RecordConversionReturnModal, type ConversionReturnFormPayload } from "@/components/trading/RecordConversionReturnModal";
import {
    createFactoryScrapDispatch,
    updateFactoryScrapDispatch,
    unpostFactoryScrapDispatch,
    deleteFactoryScrapDispatch,
    postFactoryScrapDispatch,
    evaluateProductionAlerts,
    fetchFactoryScrapDispatches,
    fetchNextFactoryScrapDispatchNo,
    fetchNextScrapConversionReturnNo,
    createScrapConversionReturn,
    postScrapConversionReturn,
    type FactoryScrapDispatchRow,
} from "@/lib/repositories/scrapRepo";

const STATUS_COLORS: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-300",
    posted: "bg-emerald-50 text-emerald-700 border-emerald-300",
};

export default function FactoryScrapDispatchPage() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const [dispatches, setDispatches] = useState<FactoryScrapDispatchRow[]>([]);
    const [createOpen, setCreateOpen] = useState(false);
    const [returnOpen, setReturnOpen] = useState(false);
    const [selected, setSelected] = useState<FactoryScrapDispatchRow | null>(null);
    const [suggestedNo, setSuggestedNo] = useState<string>();
    const [suggestedReturnNo, setSuggestedReturnNo] = useState<string>();
    const [search, setSearch] = useState("");

    const load = useCallback(async () => {
        if (!liveMode) {
            setDispatches([]);
            return;
        }
        const rows = await fetchFactoryScrapDispatches();
        setDispatches(rows);
    }, [liveMode]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = async () => {
        setSelected(null);
        if (liveMode) {
            const no = await fetchNextFactoryScrapDispatchNo();
            setSuggestedNo(no ?? undefined);
        }
        setCreateOpen(true);
    };

    const refreshAfterPost = async () => {
        const alertRes = await evaluateProductionAlerts();
        notifyProductionUpdated();
        await load();
        return alertRes.ok ? alertRes.data : 0;
    };

    const handleSubmit = async (
        data: FactoryScrapDispatchFormPayload,
        action: "draft" | "post",
    ): Promise<boolean> => {
        if (!liveMode) {
            toast({ title: "Live mode required", variant: "destructive" });
            return false;
        }
        const res = selected
            ? await updateFactoryScrapDispatch(selected.id, data, action === "post")
            : await createFactoryScrapDispatch(data);
        if (!res.ok) {
            toast({ title: "Save failed", description: res.error, variant: "destructive" });
            return false;
        }

        const docId = selected?.id ?? res.data.id;

        if (action === "draft") {
            toast({
                title: selected ? "Draft updated" : "Draft saved",
                description: "Post the dispatch to update scrap reports and production alerts.",
            });
            await load();
            return true;
        }

        if (selected) {
            const alertCount = await refreshAfterPost();
            toast({
                title: "Dispatch updated",
                description:
                    alertCount > 0
                        ? `Posted changes saved. ${alertCount} production alert(s) updated.`
                        : "Posted changes saved and inventory/ledger entries refreshed.",
            });
            return true;
        }

        const postRes = await postFactoryScrapDispatch(docId);
        if (!postRes.ok) {
            toast({ title: "Post failed", description: postRes.error, variant: "destructive" });
            await load();
            return false;
        }

        const alertCount = await refreshAfterPost();
        toast({
            title: "Dispatch posted",
            description:
                alertCount > 0
                    ? `Wire No 8 / rod deducted from warehouse. ${alertCount} production alert(s) created or updated.`
                    : "Wire No 8 / rod deducted from warehouse. Post production batches for the same machine this month to calculate scrap % and alerts.",
        });
        return true;
    };

    const handlePost = async (row: FactoryScrapDispatchRow) => {
        const res = await postFactoryScrapDispatch(row.id);
        if (!res.ok) {
            toast({ title: "Post failed", description: res.error, variant: "destructive" });
            return;
        }
        const alertCount = await refreshAfterPost();
        toast({
            title: "Dispatch posted",
            description:
                alertCount > 0
                    ? `Wire No 8 / rod deducted from warehouse. ${alertCount} production alert(s) created or updated.`
                    : "Wire No 8 / rod deducted from warehouse. Post production batches for the same machine this month to calculate scrap % and alerts.",
        });
    };

    const handleUnpost = async (row: FactoryScrapDispatchRow) => {
        if (
            !window.confirm(
                `Unpost ${row.dispatch_no}? This reverses inventory and GL entries so you can edit and post again.`,
            )
        ) {
            return;
        }
        const res = await unpostFactoryScrapDispatch(row.id);
        if (!res.ok) {
            toast({ title: "Unpost failed", description: res.error, variant: "destructive" });
            return;
        }
        toast({
            title: "Dispatch unposted",
            description: "You can now edit the dispatch and post again.",
        });
        await load();
    };

    const handleDelete = async (row: FactoryScrapDispatchRow) => {
        const message =
            row.status === "posted"
                ? `Delete ${row.dispatch_no}? This permanently removes the dispatch and reverses all ledger entries.`
                : `Delete draft ${row.dispatch_no}? This cannot be undone.`;
        if (!window.confirm(message)) return;

        const res = await deleteFactoryScrapDispatch(row.id);
        if (!res.ok) {
            toast({ title: "Delete failed", description: res.error, variant: "destructive" });
            return;
        }
        toast({ title: "Dispatch deleted" });
        if (selected?.id === row.id) setSelected(null);
        await load();
    };

    const handleReturn = async (data: ConversionReturnFormPayload) => {
        const createRes = await createScrapConversionReturn(data);
        if (!createRes.ok) {
            toast({ title: "Return failed", description: createRes.error, variant: "destructive" });
            return;
        }
        const postRes = await postScrapConversionReturn(createRes.data.id);
        if (!postRes.ok) {
            toast({ title: "Post return failed", description: postRes.error, variant: "destructive" });
            return;
        }
        toast({ title: "Conversion return posted" });
        await load();
    };

    const filtered = dispatches.filter((d) => {
        const q = search.toLowerCase();
        if (!q) return true;
        return (
            d.dispatch_no.toLowerCase().includes(q) ||
            (d.dest_party_name ?? "").toLowerCase().includes(q) ||
            (d.lines?.map((l) => l.machine_code ?? "").join(" ") ?? "").toLowerCase().includes(q)
        );
    });

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Factory Scrap</h1>
                        <p className="text-slate-500 mt-1">
                            Record machine scrap and send to vendors for toll conversion or sale. Post dispatches to
                            update reports and alerts.
                        </p>
                    </div>
                    <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => void openCreate()}>
                        <Plus className="h-4 w-4 mr-2" /> Record scrap
                    </Button>
                </div>

                <Card className="shadow-soft border-slate-100">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <CardTitle>Dispatches</CardTitle>
                                <CardDescription>Toll and sale dispatches by machine</CardDescription>
                            </div>
                            <Input
                                placeholder="Search..."
                                className="max-w-xs h-9"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </CardHeader>
                    <CardContent>
                        {!liveMode && (
                            <p className="text-sm text-slate-500 py-8 text-center">Connect live ERP to manage dispatches.</p>
                        )}
                        {liveMode && filtered.length === 0 && (
                            <p className="text-sm text-slate-500 py-8 text-center">No dispatches yet.</p>
                        )}
                        <div className="space-y-3">
                            {filtered.map((d) => (
                                <div
                                    key={d.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-slate-100 bg-slate-50/40"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono font-semibold text-slate-900">{d.dispatch_no}</span>
                                            <Badge variant="outline" className={STATUS_COLORS[d.status] ?? ""}>
                                                {d.status}
                                            </Badge>
                                            <Badge variant="outline" className="capitalize">
                                                {d.mode}
                                            </Badge>
                                        </div>
                                        <p className="text-sm text-slate-600 mt-1">
                                            {format(new Date(d.dispatch_date), "dd MMM yyyy")} · {d.dest_party_name} ·{" "}
                                            {d.net_weight.toLocaleString()} kg
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Machines: {(d.lines ?? []).map((l) => l.machine_code).join(", ") || "—"}
                                            {d.status === "draft" && (
                                                <span className="text-amber-700"> · Post required for reports/alerts</span>
                                            )}
                                            {d.obligation && (
                                                <> · Return: {d.obligation.returned_kg}/{d.obligation.expected_kg} kg ({d.obligation.status})</>
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                                        {(d.status === "draft" || d.status === "posted") && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setSelected(d);
                                                    setSuggestedNo(undefined);
                                                    setCreateOpen(true);
                                                }}
                                            >
                                                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                                            </Button>
                                        )}
                                        {d.status === "posted" && (
                                            <Button size="sm" variant="outline" onClick={() => void handleUnpost(d)}>
                                                <Undo2 className="h-3.5 w-3.5 mr-1" /> Unpost
                                            </Button>
                                        )}
                                        {d.status === "draft" && (
                                            <Button size="sm" onClick={() => void handlePost(d)}>
                                                <Send className="h-3.5 w-3.5 mr-1" /> Post
                                            </Button>
                                        )}
                                        {d.status === "posted" &&
                                            d.mode === "toll" &&
                                            d.obligation &&
                                            d.obligation.status !== "fulfilled" && (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => {
                                                        setSelected(d);
                                                        void fetchNextScrapConversionReturnNo().then((no) =>
                                                            setSuggestedReturnNo(no ?? undefined),
                                                        );
                                                        setReturnOpen(true);
                                                    }}
                                                >
                                                    <PackageCheck className="h-3.5 w-3.5 mr-1" /> Record return
                                                </Button>
                                            )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                            onClick={() => void handleDelete(d)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <CreateFactoryScrapDispatchModal
                open={createOpen}
                onOpenChange={setCreateOpen}
                initialData={selected}
                suggestedNo={suggestedNo}
                onSubmit={handleSubmit}
            />
            <RecordConversionReturnModal
                open={returnOpen}
                onOpenChange={setReturnOpen}
                dispatch={selected}
                suggestedNo={suggestedReturnNo}
                onSubmit={handleReturn}
            />
        </DashboardLayout>
    );
}
