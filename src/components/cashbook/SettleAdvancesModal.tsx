import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { formatPkr } from "@/lib/cashbookTypes";
import {
    consumePartyAdvance,
    fetchOpenApDocsForParty,
    fetchOpenArDocsForParty,
    fetchOpenPartyAdvances,
    type OpenPartyAdvance,
    type OpenSubledgerDoc,
} from "@/lib/api/posting";
import { supabase } from "@/lib/supabase";
import {
    CUSTOMER_ADVANCE_ACCOUNT,
    VENDOR_ADVANCE_ACCOUNT,
} from "@/lib/advanceAccounts";

type PartyOption = { id: string; code: string; name: string };

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parties: PartyOption[];
};

export function SettleAdvancesModal({ open, onOpenChange, parties }: Props) {
    const [partyCode, setPartyCode] = useState("");
    const [advances, setAdvances] = useState<OpenPartyAdvance[]>([]);
    const [docs, setDocs] = useState<OpenSubledgerDoc[]>([]);
    const [selectedAdvanceId, setSelectedAdvanceId] = useState("");
    const [selectedDocId, setSelectedDocId] = useState("");
    const [amount, setAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);

    const selectedAdvance = useMemo(
        () => advances.find((a) => a.paymentId === selectedAdvanceId) ?? null,
        [advances, selectedAdvanceId],
    );
    const selectedDoc = useMemo(
        () => docs.find((d) => d.id === selectedDocId) ?? null,
        [docs, selectedDocId],
    );

    const maxApply = useMemo(() => {
        if (!selectedAdvance || !selectedDoc) return 0;
        return Math.min(selectedAdvance.openAdvance, selectedDoc.openAmount);
    }, [selectedAdvance, selectedDoc]);

    const reload = useCallback(async (code: string) => {
        if (!code) {
            setAdvances([]);
            setDocs([]);
            return;
        }
        setLoading(true);
        try {
            const adv = await fetchOpenPartyAdvances(code);
            setAdvances(adv);
            let resolvedPartyId: string | null = adv[0]?.partyId ?? null;
            if (!resolvedPartyId) {
                const { data: partyRow } = await supabase
                    .schema("erp")
                    .from("parties")
                    .select("id")
                    .eq("code", code)
                    .maybeSingle();
                resolvedPartyId = partyRow?.id != null ? String(partyRow.id) : null;
            }
            if (!resolvedPartyId) {
                setDocs([]);
                return;
            }
            const side = adv[0]?.advanceSide ?? "customer";
            const openDocs =
                side === "vendor"
                    ? await fetchOpenApDocsForParty(resolvedPartyId)
                    : await fetchOpenArDocsForParty(resolvedPartyId);
            setDocs(openDocs);
        } catch (e) {
            toast({
                title: "Failed to load advances",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        void reload(partyCode);
    }, [open, partyCode, reload]);

    useEffect(() => {
        if (!selectedAdvance) {
            setSelectedDocId("");
            return;
        }
        const partyId = selectedAdvance.partyId;
        void (async () => {
            try {
                const openDocs =
                    selectedAdvance.advanceSide === "vendor"
                        ? await fetchOpenApDocsForParty(partyId)
                        : await fetchOpenArDocsForParty(partyId);
                setDocs(openDocs);
                setSelectedDocId("");
                setAmount("");
            } catch (e) {
                toast({
                    title: "Failed to load documents",
                    description: e instanceof Error ? e.message : "Unknown error",
                    variant: "destructive",
                });
            }
        })();
    }, [selectedAdvance?.paymentId, selectedAdvance?.advanceSide, selectedAdvance?.partyId]);

    useEffect(() => {
        if (maxApply > 0) {
            setAmount(String(Math.round(maxApply * 1000) / 1000));
        } else {
            setAmount("");
        }
    }, [maxApply]);

    const handleApply = async () => {
        if (!selectedAdvance || !selectedDoc) return;
        const amt = Number(amount);
        if (!(amt > 0) || amt > maxApply + 0.001) {
            toast({
                title: "Invalid amount",
                description: `Enter an amount between 0 and ${formatPkr(maxApply)}.`,
                variant: "destructive",
            });
            return;
        }
        setApplying(true);
        try {
            const result = await consumePartyAdvance(selectedAdvance.paymentId, selectedDoc.id, amt);
            if (!result.ok) {
                toast({ title: "Apply failed", description: result.error, variant: "destructive" });
                return;
            }
            toast({
                title: "Advance applied",
                description: result.data.voucherNo
                    ? `${result.data.voucherNo} · ${formatPkr(amt)}`
                    : formatPkr(amt),
            });
            setSelectedAdvanceId("");
            setSelectedDocId("");
            await reload(partyCode);
        } finally {
            setApplying(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Settle advances</DialogTitle>
                    <DialogDescription>
                        Apply open Special G/L advances ({CUSTOMER_ADVANCE_ACCOUNT} / {VENDOR_ADVANCE_ACCOUNT})
                        against open AR or AP documents for the same party.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label>Party</Label>
                        <Select
                            value={partyCode || undefined}
                            onValueChange={(v) => {
                                setPartyCode(v);
                                setSelectedAdvanceId("");
                                setSelectedDocId("");
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select party…" />
                            </SelectTrigger>
                            <SelectContent>
                                {parties.map((p) => (
                                    <SelectItem key={p.code} value={p.code}>
                                        {p.code} — {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {loading ? (
                        <p className="text-sm text-slate-500">Loading…</p>
                    ) : partyCode ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs uppercase tracking-wide text-slate-500">
                                    Open advances
                                </Label>
                                {advances.length === 0 ? (
                                    <p className="text-sm text-slate-500 border rounded-md p-3">
                                        No open advances for this party.
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5 max-h-56 overflow-auto border rounded-md p-2">
                                        {advances.map((a) => (
                                            <li key={a.paymentId}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedAdvanceId(a.paymentId)}
                                                    className={`w-full text-left rounded-md px-2.5 py-2 text-sm border ${
                                                        selectedAdvanceId === a.paymentId
                                                            ? "border-emerald-600 bg-emerald-50"
                                                            : "border-transparent hover:bg-slate-50"
                                                    }`}
                                                >
                                                    <div className="font-medium">
                                                        {a.paymentNo}{" "}
                                                        <span className="text-slate-400 font-normal">
                                                            ({a.advanceSide})
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {a.paymentDate} · open {formatPkr(a.openAdvance)}
                                                    </div>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs uppercase tracking-wide text-slate-500">
                                    {selectedAdvance?.advanceSide === "vendor"
                                        ? "Open AP documents"
                                        : "Open AR documents"}
                                </Label>
                                {docs.length === 0 ? (
                                    <p className="text-sm text-slate-500 border rounded-md p-3">
                                        {selectedAdvance
                                            ? "No open documents on this side."
                                            : "Select an advance first."}
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5 max-h-56 overflow-auto border rounded-md p-2">
                                        {docs.map((d) => (
                                            <li key={d.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedDocId(d.id)}
                                                    className={`w-full text-left rounded-md px-2.5 py-2 text-sm border ${
                                                        selectedDocId === d.id
                                                            ? "border-emerald-600 bg-emerald-50"
                                                            : "border-transparent hover:bg-slate-50"
                                                    }`}
                                                >
                                                    <div className="font-medium">
                                                        {d.sourceDocNo ?? d.sourceDocType}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {d.docDate} · {d.sourceDocType} · open{" "}
                                                        {formatPkr(d.openAmount)}
                                                    </div>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : null}

                    {selectedAdvance && selectedDoc ? (
                        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="advance-apply-amt">Amount</Label>
                                <Input
                                    id="advance-apply-amt"
                                    type="number"
                                    step="0.001"
                                    min={0}
                                    max={maxApply}
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="w-40"
                                />
                                <p className="text-[11px] text-slate-400">Max {formatPkr(maxApply)}</p>
                            </div>
                            <Button
                                type="button"
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={applying || !(Number(amount) > 0)}
                                onClick={() => void handleApply()}
                            >
                                {applying ? "Applying…" : "Apply advance"}
                            </Button>
                        </div>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
