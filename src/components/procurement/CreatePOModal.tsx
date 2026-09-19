import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OrderItemsScroll } from "@/components/orders/OrderModalScroll";
import { getSuppliers, initPartyCatalog, subscribeParties } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { getPurchaseableItems } from "@/lib/itemCatalog";
import { formatItemLabel } from "@/lib/inventoryStore";
import { FormValidationPanel } from "@/components/invoices/InvoiceFormValidationAlerts";
import { collectOrderFormIssues } from "@/lib/formValidation";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";

export type PurchaseOrderEditData = {
    dbId: string;
    orderNo: string;
    vendorId: string;
    date?: string;
    items: Array<{ lineId?: string; itemCode: string; qty: number; rate: number; qtyReceived?: number }>;
};

interface CreatePOModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit?: (data: any) => void;
    editOrder?: PurchaseOrderEditData | null;
}

export function CreatePOModal({ open, onOpenChange, onSubmit, editOrder = null }: CreatePOModalProps) {
    const [lines, setLines] = useState([{ id: 1, lineId: "", itemCode: "", qty: 0, rate: 0, amount: 0, qtyReceived: 0 }]);
    const [vendorId, setVendorId] = useState("");
    const [date, setDate] = useState("");
    const [, forceRefresh] = useState(0);
    const { markAttempted, resetValidation, showValidation } = useFormValidationGate();

    const suppliers = getSuppliers();
    const supplierOptions = useMemo(() => toPartyComboboxOptions(suppliers), [suppliers]);
    const catalogItems = getPurchaseableItems();
    const isEdit = Boolean(editOrder?.dbId);

    useEffect(() => {
        if (!open) return;
        void initPartyCatalog().then(() => forceRefresh((t) => t + 1));
        const unsub = subscribeParties(() => forceRefresh((t) => t + 1));
        if (editOrder) {
            setVendorId(editOrder.vendorId);
            setDate(editOrder.date?.slice(0, 10) ?? "");
            setLines(
                editOrder.items.length
                    ? editOrder.items.map((l, idx) => ({
                          id: idx + 1,
                          lineId: l.lineId ?? "",
                          itemCode: l.itemCode,
                          qty: l.qty,
                          rate: l.rate,
                          amount: l.qty * l.rate,
                          qtyReceived: l.qtyReceived ?? 0,
                      }))
                    : [{ id: 1, lineId: "", itemCode: "", qty: 0, rate: 0, amount: 0, qtyReceived: 0 }]
            );
        } else {
            setLines([{ id: 1, lineId: "", itemCode: "", qty: 0, rate: 0, amount: 0, qtyReceived: 0 }]);
            setVendorId("");
            setDate("");
            resetValidation();
        }
        return () => unsub();
    }, [open, editOrder, resetValidation]);

    const validLineCount = lines.filter((l) => l.itemCode && l.qty > 0).length;
    const validationIssues = useMemo(
        () =>
            collectOrderFormIssues({
                partyId: vendorId,
                partyLabel: "vendor",
                validLineCount,
            }),
        [vendorId, validLineCount],
    );

    const handleSubmit = () => {
        markAttempted("submit");
        if (validationIssues.errors.length > 0) return;

        if (onSubmit) {
            onSubmit({
                dbId: editOrder?.dbId,
                orderNo: editOrder?.orderNo,
                vendorId,
                vendor: vendorId,
                date,
                lines: lines
                    .filter((l) => l.itemCode && l.qty > 0)
                    .map((l) => ({
                        lineId: l.lineId || undefined,
                        itemCode: l.itemCode,
                        item: l.itemCode,
                        qty: l.qty,
                        rate: l.rate,
                        amount: l.amount,
                        qtyReceived: l.qtyReceived,
                    })),
            });
        }
        onOpenChange(false);
    };

    const addLine = () => {
        setLines([...lines, { id: lines.length + 1, lineId: "", itemCode: "", qty: 0, rate: 0, amount: 0, qtyReceived: 0 }]);
    };

    const updateLine = (id: number, field: string, value: any) => {
        setLines(
            lines.map((l) => {
                if (l.id !== id) return l;
                const updated = { ...l, [field]: value };
                if (field === "qty" || field === "rate") {
                    const qty = field === "qty" ? Number(value) : Number(updated.qty);
                    if (updated.qtyReceived > 0 && qty < updated.qtyReceived) {
                        updated.qty = updated.qtyReceived;
                    } else {
                        updated.qty = qty;
                    }
                    updated.amount = Number(updated.qty) * Number(updated.rate);
                }
                return updated;
            })
        );
    };

    const removeLine = (id: number) => {
        const line = lines.find((l) => l.id === id);
        if (line?.qtyReceived && line.qtyReceived > 0) return;
        if (lines.length > 1) {
            setLines(lines.filter((l) => l.id !== id));
        }
    };

    const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Purchase Order" : "Create Purchase Order"}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? `Update order ${editOrder?.orderNo}` : "Draft a new order for raw materials or supplies."}
                    </DialogDescription>
                </DialogHeader>

                <FormValidationPanel
                    visible={showValidation}
                    issues={validationIssues}
                    title="Complete these fields before creating the order"
                />

                <div className="grid grid-cols-2 gap-4 py-4">
                    <div className="space-y-2">
                        <Label>Vendor</Label>
                        <PartyCombobox
                            value={vendorId}
                            onValueChange={setVendorId}
                            options={supplierOptions}
                            placeholder="Search vendor…"
                            disabled={isEdit}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Expected Date</Label>
                        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                </div>

                <OrderItemsScroll>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40%]">Item</TableHead>
                                <TableHead>Qty</TableHead>
                                <TableHead>Rate</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {lines.map((line) => (
                                <TableRow key={line.id}>
                                    <TableCell>
                                        <Select
                                            value={line.itemCode}
                                            onValueChange={(v) => updateLine(line.id, "itemCode", v)}
                                            disabled={Boolean(line.lineId && line.qtyReceived > 0)}
                                        >
                                            <SelectTrigger className="h-8">
                                                <SelectValue placeholder="Select Item" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {catalogItems.map((ci) => (
                                                    <SelectItem key={ci.code} value={ci.code}>
                                                        {formatItemLabel(ci)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            type="number"
                                            className="h-8"
                                            placeholder="0"
                                            min={line.qtyReceived || 0}
                                            value={line.qty || ""}
                                            onChange={(e) => updateLine(line.id, "qty", e.target.value)}
                                        />
                                        {line.qtyReceived > 0 && (
                                            <p className="text-[10px] text-slate-500 mt-0.5">Received: {line.qtyReceived}</p>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Input type="number" className="h-8" placeholder="0.00" value={line.rate || ""} onChange={(e) => updateLine(line.id, "rate", e.target.value)} />
                                    </TableCell>
                                    <TableCell className="font-medium">{line.amount.toLocaleString()}</TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" disabled={line.qtyReceived > 0} onClick={() => removeLine(line.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </OrderItemsScroll>

                <div className="flex justify-between items-center pt-2">
                    <Button variant="outline" size="sm" onClick={addLine}>
                        <Plus className="h-4 w-4 mr-2" /> Add Item
                    </Button>
                    <div className="text-right">
                        <span className="text-sm text-slate-500 mr-2">Total:</span>
                        <span className="text-lg font-bold">₨ {totalAmount.toLocaleString()}</span>
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" className="gap-2">
                        <Printer className="h-4 w-4" /> Save & Print PDF
                    </Button>
                    <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSubmit}>
                        {isEdit ? "Save Changes" : "Submit Order"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
