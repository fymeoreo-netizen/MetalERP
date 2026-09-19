import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Replace, Search, Pencil, Trash2, AlertCircle } from "lucide-react";
import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { financialStatusLabel } from "@/lib/ratePending";
import { InsufficientStockError, applyScrapTradeDemo } from "@/lib/inventoryStore";
import { format } from "date-fns";
import { toDocDateISO } from "@/lib/partyCatalog";
import { useQueryClient } from "@tanstack/react-query";
import { useScrapTrades } from "@/hooks/useErpQueries";
import { queryKeys } from "@/lib/queryClient";
import { RouteFallback } from "@/components/shared/RouteFallback";
import {
    createScrapTradeDocument,
    updateScrapTradeDocument,
    createScrapReceiptDocument,
    postDocument,
    postScrapTrade,
    postScrapTradeWithAllocations,
    deleteScrapTradeDocument,
    fetchNextScrapTradeNo,
    fetchNextScrapReceiptNo,
    fetchScrapPostingHealth,
    postPendingScrapReceipts,
    fetchDraftScrapReceipts,
    type ScrapTradeFormPayload,
    type ScrapTradeListItem,
    type ScrapPostingHealth,
    type DraftScrapReceiptRow,
} from "@/lib/repositories/scrapRepo";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useInventoryActions } from "@/contexts/InventoryContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StaggerGrid, MotionCard } from "@/components/motion/MotionPrimitives";
import { invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import { cn } from "@/lib/utils";

const CreateTriangleTradeModal = lazy(() =>
    import("@/components/sales/CreateTriangleTradeModal").then((m) => ({ default: m.CreateTriangleTradeModal })),
);

const DEMO_TRADES: ScrapTradeListItem[] = [
    {
        id: "SCRAP-2026-001",
        date: "2026-05-11",
        dateLabel: "May 11, 2026",
        sourceId: "CUST-001",
        destinationId: "VEND-101",
        source: "Gateway Motors",
        destination: "Gamma Scrap Traders",
        itemCode: "RM-SCP-001",
        biltyNo: "BL-1249",
        vehicleNo: "LEA-991",
        grossWeight: 1520,
        tareWeight: 20,
        netWeight: "1,500 kg",
        netWeightKg: 1500,
        rateValue: 2400,
        rate: "2400 PKR/kg",
        amount: "3,600,000 PKR",
        amountValue: 3600000,
        status: "Posted",
    },
    {
        id: "SCRAP-2026-002",
        date: "2026-05-10",
        dateLabel: "May 10, 2026",
        sourceId: "CUST-002",
        destinationId: "VEND-102",
        source: "Alpha Wire Supply",
        destination: "Delta Copper",
        itemCode: "RM-SCP-001",
        biltyNo: "BL-1250",
        vehicleNo: "KHI-221",
        grossWeight: 2050,
        tareWeight: 50,
        netWeight: "2,000 kg",
        netWeightKg: 2000,
        rateValue: 2350,
        rate: "2350 PKR/kg",
        amount: "4,700,000 PKR",
        amountValue: 4700000,
        status: "Posted",
    },
];

const STATUS_COLORS: Record<string, string> = {
    Recorded: "bg-blue-50 text-blue-700 border-blue-300",
    Posted: "bg-emerald-50 text-emerald-700 border-emerald-300",
};

export default function TriangleTrade() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const queryClient = useQueryClient();
    const { data: cachedTrades, isLoading: tradesLoading, refetch: refetchTrades } = useScrapTrades();
    const [demoTrades, setDemoTrades] = useState(DEMO_TRADES);
    const [createOpen, setCreateOpen] = useState(false);
    const [selectedTrade, setSelectedTrade] = useState<ScrapTradeListItem | null>(null);
    const [postingHealth, setPostingHealth] = useState<ScrapPostingHealth | null>(null);
    const [draftReceipts, setDraftReceipts] = useState<DraftScrapReceiptRow[]>([]);
    const [repairingReceipts, setRepairingReceipts] = useState(false);

    const trades = liveMode ? (cachedTrades ?? []) : demoTrades;

    const loadDraftReceipts = useCallback(async () => {
        if (!liveMode) {
            setDraftReceipts([]);
            return;
        }
        const res = await fetchDraftScrapReceipts();
        if (res.ok) setDraftReceipts(res.data);
    }, [liveMode]);

    const loadPostingHealth = useCallback(async () => {
        if (!liveMode) {
            setPostingHealth(null);
            return;
        }
        const res = await fetchScrapPostingHealth();
        if (res.ok) setPostingHealth(res.data);
        else setPostingHealth(null);
    }, [liveMode]);

    const { refresh: refreshInventory, refreshBalances } = useInventoryActions();

    const loadTrades = useCallback(async () => {
        if (liveMode) {
            await refetchTrades();
        }
    }, [liveMode, refetchTrades]);

    /** Flip a posted row to "Posted" in the cached list without a full refetch. */
    const patchTradePosted = useCallback(
        (dbId: string) => {
            queryClient.setQueryData<ScrapTradeListItem[]>(queryKeys.scrapTrades, (prev) =>
                prev ? prev.map((t) => (t.dbId === dbId ? { ...t, status: "Posted" } : t)) : prev,
            );
        },
        [queryClient],
    );

    useEffect(() => {
        if (!liveMode) return;
        void loadPostingHealth();
        void loadDraftReceipts();
    }, [liveMode, loadPostingHealth, loadDraftReceipts]);

    const [searchQuery, setSearchQuery] = useState("");

    const filteredTrades = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return trades;
        return trades.filter(
            (t) =>
                t.id.toLowerCase().includes(q) ||
                t.source.toLowerCase().includes(q) ||
                t.destination.toLowerCase().includes(q) ||
                t.biltyNo.toLowerCase().includes(q) ||
                t.vehicleNo.toLowerCase().includes(q),
        );
    }, [trades, searchQuery]);

    const hasSearch = searchQuery.trim() !== "";

    const handleEdit = (trade: ScrapTradeListItem) => {
        setSelectedTrade(trade);
        setCreateOpen(true);
    };

    const handlePostDraft = async (trade: ScrapTradeListItem) => {
        if (!trade.dbId || trade.status === "Posted") return;
        try {
            await postScrapTrade(trade.dbId);
            patchTradePosted(trade.dbId);
            void loadDraftReceipts();
            void loadPostingHealth();
            toast({
                title: "Scrap trade posted",
                description:
                    trade.settlementMode === "cash"
                        ? `${trade.id} — AP and cash settlement recorded (no Dest AR / metal khata).`
                        : `${trade.id} — AP/AR and metal movements recorded.`,
            });
        } catch (e) {
            toast({
                title: "Posting failed",
                description: e instanceof Error ? e.message : "Could not post scrap trade.",
                variant: "destructive",
            });
        }
    };

    const handleDeleteTrade = async (trade: ScrapTradeListItem) => {
        const isPosted = trade.status === "Posted";
        const verb = isPosted ? "void" : "delete";
        const detail =
            trade.settlementMode === "cash"
                ? "reverses scrap GL (AP + cash settlement), linked premium scrap receipts, and related documents."
                : "reverses scrap GL (AP/AR), metal movements, linked premium scrap receipts, and vendor payable lots.";
        if (
            !window.confirm(
                `${verb.charAt(0).toUpperCase()}${verb.slice(1)} scrap trade ${trade.id}? This ${detail}${isPosted ? " The trade is preserved as voided." : ""}`,
            )
        )
            return;
        if (liveMode && trade.dbId) {
            const result = await deleteScrapTradeDocument(trade.dbId);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return;
            }
            await loadTrades();
            await loadDraftReceipts();
            toast({
                title: isPosted ? "Scrap trade voided" : "Scrap trade deleted",
                description: `${trade.id} — ledger and premium scrap effects reversed. Refresh party ledger if open.`,
            });
            return;
        }
        setDemoTrades((prev) => prev.filter((t) => t.id !== trade.id));
        toast({ title: "Scrap trade removed", description: trade.id });
    };

    const handleSave = (updatedData: ScrapTradeFormPayload) => {
        setDemoTrades((prev) =>
            prev.map((t): ScrapTradeListItem =>
                t.id === updatedData.id
                    ? {
                          ...t,
                          source: updatedData.source,
                          destination: updatedData.destination,
                          sourceId: updatedData.sourceId,
                          destinationId: updatedData.destinationId,
                          itemCode: updatedData.itemCode,
                          biltyNo: updatedData.biltyNo,
                          vehicleNo: updatedData.vehicleNo,
                          grossWeight: updatedData.grossWeight,
                          tareWeight: updatedData.tareWeight,
                          netWeight: `${updatedData.netWeight} kg`,
                          netWeightKg: updatedData.netWeight,
                          rateValue: updatedData.rateValue,
                          rate: `${updatedData.rateValue} PKR/kg`,
                          amount: updatedData.amount,
                          amountValue: updatedData.netWeight * updatedData.rateValue,
                          status: t.status,
                      }
                    : t,
            ),
        );
    };

    const handleRepairPendingReceipts = async () => {
        setRepairingReceipts(true);
        try {
            const res = await postPendingScrapReceipts();
            if (!res.ok) {
                toast({ title: "Repair failed", description: res.error, variant: "destructive" });
                return;
            }
            const errCount = res.data.errors.length;
            toast({
                title: errCount ? "Partial repair" : "Premium receipts posted",
                description: errCount
                    ? `Posted ${res.data.posted}; ${errCount} failed. Check Supabase migration 81.`
                    : `Posted ${res.data.posted} draft receipt(s).`,
                variant: errCount ? "destructive" : "default",
            });
            await loadDraftReceipts();
            await loadTrades();
        } finally {
            setRepairingReceipts(false);
        }
    };

    const handleRetryReceipt = async (receipt: DraftScrapReceiptRow) => {
        setRepairingReceipts(true);
        try {
            await postDocument("post_scrap_receipt", receipt.id);
            toast({
                title: "Premium receipt posted",
                description: `${receipt.receipt_no}${receipt.sales_invoice_no ? ` → ${receipt.sales_invoice_no}` : ""}`,
            });
            await loadDraftReceipts();
            await loadTrades();
        } catch (e) {
            toast({
                title: "Receipt posting failed",
                description: e instanceof Error ? e.message : "Error",
                variant: "destructive",
            });
        } finally {
            setRepairingReceipts(false);
        }
    };

    const handleTradeSubmit = async (data: ScrapTradeFormPayload) => {
        const netWt = data.netWeight;
        const itemCode = data.itemCode;

        if (selectedTrade) {
            if (liveMode && selectedTrade.dbId) {
                const amount = data.rateValue ? netWt * data.rateValue : 0;
                const updated = await updateScrapTradeDocument(selectedTrade.dbId, {
                    tradeDate: toDocDateISO(data.date ?? new Date()),
                    sourcePartyCode: data.sourceId,
                    destPartyCode: data.destinationId,
                    itemCode,
                    biltyNo: data.biltyNo,
                    vehicleNo: data.vehicleNo,
                    grossWeight: data.grossWeight,
                    tareWeight: data.tareWeight,
                    netWeight: netWt,
                    unitRate: data.rateValue,
                    amount,
                    settlementMode: data.settlementMode,
                });
                if (!updated.ok) {
                    toast({ title: "Scrap trade update failed", description: updated.error, variant: "destructive" });
                    throw new Error(updated.error);
                }
                await loadTrades();
                if (selectedTrade.status === "Posted") {
                    await Promise.all([refreshBalances(), refreshInventory()]);
                }
                toast({
                    title: "Scrap trade updated",
                    description:
                        selectedTrade.status === "Posted"
                            ? `${selectedTrade.id} — stock and ledger reposted.`
                            : `${selectedTrade.id} — values saved.`,
                });
                return;
            }
            handleSave(data);
            return;
        }

        if (liveMode) {
            const tradeNo = data.id || (await fetchNextScrapTradeNo()) || `SCRAP-${Date.now()}`;
            const multiAlloc = data.obligationAllocations?.filter((a) => a.allocatedKg > 0) ?? [];
            const amount =
                multiAlloc.length > 0
                    ? multiAlloc.reduce((s, l) => s + l.allocatedKg * l.refScrapRate, 0)
                    : data.rateValue
                      ? netWt * data.rateValue
                      : 0;
            const unitRate = netWt > 0 ? amount / netWt : data.rateValue;
            const created = await createScrapTradeDocument({
                tradeNo,
                tradeDate: toDocDateISO(data.date ?? new Date()),
                sourcePartyCode: data.sourceId,
                destPartyCode: data.destinationId,
                itemCode,
                biltyNo: data.biltyNo,
                vehicleNo: data.vehicleNo,
                grossWeight: data.grossWeight,
                tareWeight: data.tareWeight,
                netWeight: netWt,
                unitRate,
                amount,
                rateStatus: data.rateStatus,
                pendingReason: data.pendingReason,
                settlementMode: data.settlementMode,
            });
            if (!created.ok) {
                toast({ title: "Scrap trade save failed", description: created.error, variant: "destructive" });
                throw new Error(created.error);
            }
            let linkedReceiptId: string | undefined;
            const creditAllocRows =
                data.creditAllocations?.map((c) => ({
                    scrapCreditId: c.scrapCreditId,
                    allocatedKg: c.allocatedKg,
                })) ?? [];
            if (multiAlloc.length > 1) {
                // Allocate one base number, derive unique sequential numbers locally,
                // then create all receipt drafts in parallel (independent inserts).
                const baseReceiptNo = await fetchNextScrapReceiptNo();
                const makeReceiptNo = (i: number): string => {
                    if (!baseReceiptNo) return `SCR-IN-${Date.now()}-${i + 1}`;
                    if (i === 0) return baseReceiptNo;
                    const m = baseReceiptNo.match(/^(.*?)(\d+)$/);
                    if (!m) return `${baseReceiptNo}-${i + 1}`;
                    const width = m[2].length;
                    return `${m[1]}${String(Number(m[2]) + i).padStart(width, "0")}`;
                };
                const receiptResults = await Promise.all(
                    multiAlloc.map((line, i) => {
                        const share = netWt > 0 ? line.allocatedKg / netWt : 0;
                        const lineTare = data.tareWeight * share;
                        const lineGross = lineTare + line.allocatedKg;
                        return createScrapReceiptDocument({
                            receiptNo: makeReceiptNo(i),
                            receiptDate: toDocDateISO(data.date ?? new Date()),
                            partyCode: data.sourceId,
                            obligationId: line.obligationId,
                            itemCode,
                            grossWeight: lineGross,
                            tareWeight: lineTare,
                            netWeight: line.allocatedKg,
                            unitRate: line.refScrapRate,
                            biltyNo: data.biltyNo,
                            vehicleNo: data.vehicleNo,
                            recordMetalMovement: false,
                            scrapTradeId: created.data.id,
                        }).then((res) => ({ res, line, index: i }));
                    }),
                );
                const receiptRows: { obligationId: string; allocatedKg: number; receiptId: string; lineSeq: number }[] = [];
                for (const { res, line, index } of receiptResults) {
                    if (!res.ok) {
                        toast({
                            title: "Premium receipt draft failed",
                            description: res.error,
                            variant: "destructive",
                            duration: 12000,
                        });
                        throw new Error(res.error);
                    }
                    receiptRows.push({
                        obligationId: line.obligationId,
                        allocatedKg: line.allocatedKg,
                        receiptId: res.data.id,
                        lineSeq: index + 1,
                    });
                }
                try {
                    await postScrapTradeWithAllocations(created.data.id, receiptRows, creditAllocRows);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Posting failed";
                    toast({
                        title: "Posting failed",
                        description: `${msg} Trade may be saved as draft — apply migration 137 in Supabase if allocation errors persist.`,
                        variant: "destructive",
                    });
                    await loadTrades();
                    throw e;
                }
            } else if (data.obligationId || multiAlloc.length === 1) {
                const single = multiAlloc[0];
                const obligationId = single?.obligationId ?? data.obligationId!;
                const allocKg = single?.allocatedKg ?? netWt;
                const unitRate = single?.refScrapRate ?? data.rateValue;
                const share = netWt > 0 ? allocKg / netWt : 1;
                const lineTare = data.tareWeight * share;
                const lineGross = lineTare + allocKg;
                const receiptNo = (await fetchNextScrapReceiptNo()) ?? `SCR-IN-${Date.now()}`;
                const receipt = await createScrapReceiptDocument({
                    receiptNo,
                    receiptDate: toDocDateISO(data.date ?? new Date()),
                    partyCode: data.sourceId,
                    obligationId,
                    itemCode,
                    grossWeight: lineGross,
                    tareWeight: lineTare,
                    netWeight: allocKg,
                    unitRate,
                    biltyNo: data.biltyNo,
                    vehicleNo: data.vehicleNo,
                    recordMetalMovement: false,
                    scrapTradeId: created.data.id,
                });
                if (!receipt.ok) {
                    toast({
                        title: "Premium receipt draft failed",
                        description: receipt.error,
                        variant: "destructive",
                        duration: 12000,
                    });
                    throw new Error(receipt.error);
                }
                linkedReceiptId = receipt.data.id;
                try {
                    if (single && multiAlloc.length === 1) {
                        try {
                            await postScrapTradeWithAllocations(
                                created.data.id,
                                [
                                    {
                                        obligationId: single.obligationId,
                                        allocatedKg: single.allocatedKg,
                                        receiptId: receipt.data.id,
                                        lineSeq: 1,
                                    },
                                ],
                                creditAllocRows,
                            );
                        } catch {
                            await postScrapTrade(created.data.id, single.obligationId, receipt.data.id);
                        }
                    } else {
                        await postScrapTrade(created.data.id, obligationId, linkedReceiptId);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Posting failed";
                    toast({
                        title: "Posting failed",
                        description: `${msg} Trade may be saved as draft — apply migrations 73–85 in Supabase if posting errors persist.`,
                        variant: "destructive",
                    });
                    await loadTrades();
                    throw e;
                }
            } else if (creditAllocRows.length > 0) {
                try {
                    await postScrapTradeWithAllocations(created.data.id, [], creditAllocRows);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Posting failed";
                    toast({
                        title: "Posting failed",
                        description: msg,
                        variant: "destructive",
                    });
                    await loadTrades();
                    throw e;
                }
            } else {
                try {
                    await postScrapTrade(created.data.id);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Posting failed";
                    toast({
                        title: "Posting failed",
                        description: `${msg} Trade may be saved as draft — apply migrations 73–85 in Supabase if posting errors persist.`,
                        variant: "destructive",
                    });
                    await loadTrades();
                    throw e;
                }
            }

            void Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.scrapTrades }),
                loadDraftReceipts(),
                loadPostingHealth(),
            ]);
            const invoiceLabel =
                multiAlloc.length > 1
                    ? `${multiAlloc.length} invoices (${multiAlloc.map((a) => a.salesInvoiceNo).join(", ")})`
                    : multiAlloc[0]?.salesInvoiceNo ?? data.salesInvoiceNo ?? "invoice";
            toast({
                title: "Scrap trade posted",
                description:
                    multiAlloc.length > 0 || data.obligationId
                        ? `${tradeNo}: scrap trade and premium scrap (${netWt.toLocaleString()} kg) applied to ${invoiceLabel}.`
                        : `${tradeNo}: scrap trade posted — premium invoices not linked.`,
            });
            return;
        }

        try {
            applyScrapTradeDemo({
                itemCode,
                qty: netWt,
                refDocId: data.id,
                sourcePartyId: data.sourceId,
                sourcePartyName: data.source,
                destPartyId: data.destinationId,
                destPartyName: data.destination,
                docDate: toDocDateISO(data.date ?? new Date()),
                amount: data.rateValue ? netWt * data.rateValue : undefined,
                rate: data.rateValue,
            });
        } catch (e) {
            toast({
                title: "Stock update failed",
                description: e instanceof InsufficientStockError ? e.message : "Could not post scrap trade.",
                variant: "destructive",
            });
            throw e;
        }

        const newTrade: ScrapTradeListItem = {
            id: data.id,
            date: format(new Date(), "yyyy-MM-dd"),
            dateLabel: format(new Date(), "MMM dd, yyyy"),
            sourceId: data.sourceId,
            destinationId: data.destinationId,
            source: data.source,
            destination: data.destination,
            itemCode: data.itemCode,
            biltyNo: data.biltyNo,
            vehicleNo: data.vehicleNo,
            grossWeight: data.grossWeight,
            tareWeight: data.tareWeight,
            netWeight: `${netWt.toLocaleString()} kg`,
            netWeightKg: netWt,
            rateValue: data.rateValue,
            rate: `${data.rateValue} PKR/kg`,
            amount: data.amount,
            amountValue: netWt * (data.rateValue || 0),
            status: "Posted",
        };
        setDemoTrades((prev) => [newTrade, ...prev]);
        toast({ title: "Scrap trade posted", description: `${data.id} — stock updated.` });
    };

    const handleCreateNew = () => {
        setSelectedTrade(null);
        setCreateOpen(true);
    };

    return (
        <DashboardLayout>
            <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Scrap</h1>
                        <p className="text-slate-500 mt-1">
                            Scrap broker trades. Select a customer to see premium scrap due and link receipt to their invoice.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {liveMode && draftReceipts.length > 0 && (
                            <Button
                                variant="outline"
                                onClick={() => void handleRepairPendingReceipts()}
                                disabled={repairingReceipts}
                                className="border-amber-300 text-amber-900"
                            >
                                Post pending premium receipts ({draftReceipts.length})
                            </Button>
                        )}
                    <Button onClick={handleCreateNew} className="bg-zinc-900 hover:bg-zinc-800 shadow-md">
                            <Plus className="h-4 w-4 mr-2" /> New scrap trade
                    </Button>
                    </div>
                </div>

                {liveMode && postingHealth && !postingHealth.ok && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Scrap posting not fully configured</AlertTitle>
                        <AlertDescription>
                            {postingHealth.hint ??
                                "Run Supabase migrations 76 and 81, then notify pgrst reload schema."}
                            {!postingHealth.post_scrap_receipt && (
                                <span className="block mt-1">Missing RPC: post_scrap_receipt (premium scrap will not clear).</span>
                            )}
                        </AlertDescription>
                    </Alert>
                )}

                {liveMode && draftReceipts.length > 0 && (
                    <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Draft premium scrap receipts</AlertTitle>
                        <AlertDescription className="space-y-2">
                            <p>Scrap trade may be posted but these receipts are not — premium invoice scrap due is unchanged.</p>
                            <ul className="text-xs space-y-1">
                                {draftReceipts.slice(0, 5).map((r) => (
                                    <li key={r.id} className="flex items-center justify-between gap-2">
                                        <span>
                                            {r.receipt_no}
                                            {r.sales_invoice_no ? ` · ${r.sales_invoice_no}` : ""} · {r.net_weight.toLocaleString()} kg
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs shrink-0"
                                            disabled={repairingReceipts}
                                            onClick={() => void handleRetryReceipt(r)}
                                        >
                                            Post
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </AlertDescription>
                    </Alert>
                )}

                <div className="space-y-4">
                <div className="relative w-full sm:max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search ID, party, bilty, vehicle…"
                        className={cn(invoiceInputClass, "pl-9")}
                    />
                </div>

                <p className="text-[11px] text-zinc-500 tabular-nums">
                    Showing{" "}
                    <span className="font-medium text-zinc-700">{filteredTrades.length}</span> of{" "}
                    {trades.length} trade{trades.length !== 1 ? "s" : ""}
                    {hasSearch ? " (filtered)" : ""}
                </p>

                {liveMode && tradesLoading && trades.length === 0 ? (
                    <div className="py-16 text-center text-slate-500">Loading scrap trades…</div>
                ) : filteredTrades.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 rounded-xl border border-dashed border-slate-200/80 bg-white/60">
                        <p className="text-sm">
                            {hasSearch
                                ? "No trades match your search."
                                : "No scrap trades yet. Create one with New scrap trade."}
                        </p>
                        {hasSearch ? (
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                onClick={() => setSearchQuery("")}
                                className="mt-2 text-blue-600"
                            >
                                Clear search
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredTrades.map((trade, index) => (
                            <MotionCard key={trade.id} index={index}>
                            <Card className="shadow-soft border-slate-100 flex flex-col h-full transition-colors duration-200">
                                <CardHeader className="pb-3 border-b border-slate-50 bg-slate-50/50">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="font-mono text-base text-blue-700">{trade.id}</CardTitle>
                                            <CardDescription className="font-mono mt-1 text-xs">{trade.dateLabel}</CardDescription>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                        <Badge variant="outline" className={`shadow-sm ${STATUS_COLORS[trade.status] || "bg-slate-50 text-slate-600"}`}>
                                            {trade.status}
                                        </Badge>
                                            {trade.settlementMode === "cash" && (
                                                <Badge variant="outline" className="shadow-sm bg-emerald-50 text-emerald-800 border-emerald-200">
                                                    Cash
                                                </Badge>
                                            )}
                                            {trade.financialStatus && trade.financialStatus !== "complete" && (
                                                <Badge variant="outline" className="shadow-sm bg-amber-50 text-amber-800 border-amber-200">
                                                    {financialStatusLabel(trade.financialStatus)}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent className="pt-4 flex-1 flex flex-col space-y-4">
                                    <div className="flex justify-between text-[11px] font-mono text-slate-500 bg-slate-50 p-2 rounded-md border border-slate-100">
                                        <div>
                                            <span className="font-semibold text-slate-400">BILTY:</span> {trade.biltyNo}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-slate-400">VEH:</span> {trade.vehicleNo}
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div>
                                            <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 mb-0.5">
                                                Source (Customer)
                                            </div>
                                            <div className="text-sm font-semibold text-slate-900">{trade.source}</div>
                                        </div>
                                        
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1 h-px bg-slate-100" />
                                            <Replace className="h-4 w-4 text-slate-300" />
                                            <div className="flex-1 h-px bg-slate-100" />
                                        </div>

                                        <div>
                                            <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 mb-0.5">
                                                Destination (Vendor)
                                            </div>
                                            <div className="text-sm font-semibold text-slate-900">{trade.destination}</div>
                                        </div>
                                    </div>

                                    <div className="mt-auto pt-4 border-t border-slate-100">
                                        <div className="flex items-start justify-between mb-3 gap-2">
                                            <div className="text-xs font-semibold text-slate-500">
                                                Net: <span className="font-mono text-blue-600 font-bold">{trade.netWeight}</span>
                                            </div>
                                            <div className="text-xs font-semibold text-slate-500 text-right min-w-0">
                                                {trade.premiumLines && trade.premiumLines.length > 0 ? (
                                                    <ul className="space-y-0.5 font-mono text-slate-700">
                                                        {trade.premiumLines.map((line) => (
                                                            <li key={`${line.salesInvoiceNo}-${line.lineSeq}`}>
                                                                {line.allocatedKg.toLocaleString()} kg @{" "}
                                                                {line.refScrapRate.toLocaleString()}{" "}
                                                                <span className="text-slate-500">({line.salesInvoiceNo})</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <>
                                                @ <span className="font-mono text-slate-700">{trade.rate}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex gap-1 flex-wrap">
                                                {liveMode && trade.status === "Recorded" && trade.dbId && (
                                                    <Button
                                                        size="sm"
                                                        className="h-8 px-3 text-xs bg-zinc-900 hover:bg-zinc-800"
                                                        onClick={() => void handlePostDraft(trade)}
                                                    >
                                                        Post
                                                    </Button>
                                                )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                    className="h-8 px-3 text-xs"
                                                onClick={() => handleEdit(trade)}
                                            >
                                                <Pencil className="h-3 w-3 mr-1.5" /> Edit
                                            </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 px-3 text-xs border-rose-200 text-rose-600 hover:bg-rose-50"
                                                    onClick={() => void handleDeleteTrade(trade)}
                                                >
                                                    <Trash2 className="h-3 w-3 mr-1.5" /> Delete
                                                </Button>
                                            </div>
                                            {trade.amount && (
                                                <div className="text-right">
                                                    <span className="font-mono font-bold text-emerald-700">{trade.amount}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            </MotionCard>
                        ))}
                    </StaggerGrid>
                )}
                </div>
            </div>

            <Suspense fallback={null}>
            <CreateTriangleTradeModal
                open={createOpen}
                onOpenChange={(val) => {
                    setCreateOpen(val);
                    if (!val) setSelectedTrade(null);
                }}
                initialData={selectedTrade}
                onSubmit={handleTradeSubmit}
            />
            </Suspense>
        </DashboardLayout>
    );
}
