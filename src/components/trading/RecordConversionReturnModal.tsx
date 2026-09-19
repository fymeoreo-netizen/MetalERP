import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useState, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import type { FactoryScrapDispatchRow } from "@/lib/api/scrap";

export type ConversionReturnFormPayload = {
    returnNo: string;
    obligationId: string;
    returnDate: string;
    itemCode: string;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    unitRate: number;
    amount: number;
    biltyNo?: string;
    vehicleNo?: string;
    remarks?: string;
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    dispatch: FactoryScrapDispatchRow | null;
    suggestedNo?: string;
    onSubmit?: (data: ConversionReturnFormPayload) => void | Promise<void>;
}

export function RecordConversionReturnModal({ open, onOpenChange, dispatch, suggestedNo, onSubmit }: Props) {
    const [submitting, setSubmitting] = useState(false);
    const [returnNo, setReturnNo] = useState("");
    const [returnDate, setReturnDate] = useState(new Date().toISOString().split("T")[0]);
    const [grossWeight, setGrossWeight] = useState("");
    const [tareWeight, setTareWeight] = useState("0");
    const [rate, setRate] = useState("");
    const [biltyNo, setBiltyNo] = useState("");
    const [vehicleNo, setVehicleNo] = useState("");

    const obl = dispatch?.obligation;
    const itemCode = dispatch?.expected_return_item_code ?? obl?.expected_item_code ?? "RM-W8-001";
    const openKg = obl ? Math.max(0, obl.expected_kg - obl.returned_kg) : 0;

    useEffect(() => {
        if (!open) return;
        setReturnNo(suggestedNo ?? `SCR-RET-${Date.now()}`);
        setReturnDate(new Date().toISOString().split("T")[0]);
        setGrossWeight(openKg > 0 ? String(openKg) : "");
        setTareWeight("0");
        setRate("");
        setBiltyNo("");
        setVehicleNo("");
    }, [open, suggestedNo, openKg]);

    const netWeight = useMemo(() => {
        const g = parseFloat(grossWeight) || 0;
        const t = parseFloat(tareWeight) || 0;
        return Math.max(0, g - t);
    }, [grossWeight, tareWeight]);

    const amount = useMemo(() => (parseFloat(rate) || 0) * netWeight, [netWeight, rate]);

    const handleSubmit = async () => {
        if (!obl || netWeight <= 0) return;
        setSubmitting(true);
        try {
            await onSubmit?.({
                returnNo,
                obligationId: obl.id,
                returnDate,
                itemCode,
                grossWeight: parseFloat(grossWeight) || netWeight,
                tareWeight: parseFloat(tareWeight) || 0,
                netWeight,
                unitRate: parseFloat(rate) || 0,
                amount,
                biltyNo: biltyNo || undefined,
                vehicleNo: vehicleNo || undefined,
            });
            onOpenChange(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogTitle>Record conversion return</DialogTitle>
                <DialogDescription>
                    {dispatch?.dispatch_no} · Open {openKg.toLocaleString()} kg of {itemCode} expected from vendor
                </DialogDescription>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Return No.</Label>
                        <Input className={invoiceInputClass} value={returnNo} onChange={(e) => setReturnNo(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Date</Label>
                        <Input type="date" className={invoiceInputClass} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Gross (kg)</Label>
                            <Input className={invoiceInputClass} value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Tare (kg)</Label>
                            <Input className={invoiceInputClass} value={tareWeight} onChange={(e) => setTareWeight(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Net (kg)</Label>
                        <Input className={invoiceInputClass} readOnly value={netWeight.toFixed(3)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Rate (optional)</Label>
                        <Input className={invoiceInputClass} value={rate} onChange={(e) => setRate(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={() => void handleSubmit()} disabled={submitting || !obl}>
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post return"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
