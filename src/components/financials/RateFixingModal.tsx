import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { PendingRateItemRow } from "@/lib/ratePending";
import { fixPendingRateItems } from "@/lib/api/ratePending";
import { useToast } from "@/components/ui/use-toast";

interface RateFixingModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    items: PendingRateItemRow[];
    onFixed?: () => void;
}

export function RateFixingModal({ open, onOpenChange, items, onFixed }: RateFixingModalProps) {
    const { toast } = useToast();
    const [bulkRate, setBulkRate] = useState<number | string>("");
    const [lineRates, setLineRates] = useState<Record<string, string>>({});
    const [remarks, setRemarks] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [usePerLine, setUsePerLine] = useState(false);

    const totalWeight = items.reduce((s, i) => s + i.qty, 0);
    const partyName = items[0]?.partyName ?? "";

    useEffect(() => {
        if (!open) return;
        setBulkRate("");
        setRemarks("");
        setUsePerLine(items.length > 1);
        const init: Record<string, string> = {};
        for (const item of items) init[item.id] = "";
        setLineRates(init);
    }, [open, items]);

    const estimatedLiability = usePerLine
        ? items.reduce((s, item) => {
              const r = Number(lineRates[item.id]);
              return s + (Number.isFinite(r) && r > 0 ? item.qty * r : 0);
          }, 0)
        : Number(bulkRate) > 0
          ? totalWeight * Number(bulkRate)
          : 0;

    const handleSubmit = async () => {
        const payload = items.map((item) => {
            const rate = usePerLine ? Number(lineRates[item.id]) : Number(bulkRate);
            return { pendingItemId: item.id, unitRate: rate };
        });
        if (payload.some((p) => !p.unitRate || p.unitRate <= 0)) {
            toast({ title: "Enter a positive rate for each line", variant: "destructive" });
            return;
        }
        setSubmitting(true);
        try {
            const result = await fixPendingRateItems(payload, remarks || undefined);
            if (!result.ok) {
                toast({ title: "Rate fix failed", description: result.error, variant: "destructive" });
                return;
            }
            toast({
                title: "Rates fixed",
                description: `${result.data.fixedCount} line(s) posted to ledger on original dates.`,
            });
            onOpenChange(false);
            onFixed?.();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Fix rate (Suda)</DialogTitle>
                    <DialogDescription>
                        Finalize rates for {partyName} — financial entries use each document&apos;s original date.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <div>
                            <p className="text-sm font-medium text-slate-500">Selected quantity</p>
                            <p className="text-xl font-bold text-slate-900">{totalWeight.toLocaleString()} kg</p>
                        </div>
                        <Badge variant="outline" className="bg-white">
                            {items.length} line{items.length !== 1 ? "s" : ""}
                        </Badge>
                    </div>

                    {items.length > 1 && (
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={!usePerLine ? "default" : "outline"}
                                onClick={() => setUsePerLine(false)}
                            >
                                One rate for all
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={usePerLine ? "default" : "outline"}
                                onClick={() => setUsePerLine(true)}
                            >
                                Per line
                            </Button>
                        </div>
                    )}

                    {!usePerLine ? (
                        <div className="space-y-2">
                            <Label>Final agreed rate (PKR/kg)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-2 text-slate-500">₨</span>
                                <Input
                                    type="number"
                                    className="pl-8 text-lg font-semibold"
                                    placeholder="0.00"
                                    value={bulkRate}
                                    onChange={(e) => setBulkRate(e.target.value)}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto">
                            <Label>Rate per line (PKR/kg)</Label>
                            {items.map((item) => (
                                <div key={item.id} className="flex items-center gap-2 text-xs">
                                    <span className="flex-1 truncate font-mono text-slate-600">
                                        {item.sourceDocNo} · {item.qty.toLocaleString()} kg
                                    </span>
                                    <Input
                                        type="number"
                                        className="w-28 h-8"
                                        placeholder="Rate"
                                        value={lineRates[item.id] ?? ""}
                                        onChange={(e) =>
                                            setLineRates((prev) => ({ ...prev, [item.id]: e.target.value }))
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>Total liability impact</Label>
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-900 font-mono text-xl font-bold text-right">
                            ₨ {estimatedLiability.toLocaleString()}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Remarks (optional)</Label>
                        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Rate agreement note" />
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-amber-800 text-xs">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <p>
                            Inventory valuation will be rebuilt. This posts AP/AR on the original transaction dates.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={() => void handleSubmit()} disabled={submitting || items.length === 0}>
                        {submitting ? "Posting…" : "Authorize & Post"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
