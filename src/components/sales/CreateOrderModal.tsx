import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { OrderItemsScroll } from "@/components/orders/OrderModalScroll";
import { getCustomers, initPartyCatalog, subscribeParties } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { getFinishedGoodsItems } from "@/lib/itemCatalog";
import { formatItemLabel } from "@/lib/inventoryStore";
import { FormValidationPanel } from "@/components/invoices/InvoiceFormValidationAlerts";
import { collectOrderFormIssues } from "@/lib/formValidation";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";

export type SalesOrderEditData = {
    dbId: string;
    orderNo: string;
    customerId: string;
    deliveryDate?: string;
    items: Array<{ lineId?: string; itemCode: string; qty: number; rate: number; qtyFulfilled?: number }>;
};

interface CreateOrderModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: any) => void;
    editOrder?: SalesOrderEditData | null;
}

export function CreateOrderModal({ open, onOpenChange, onSubmit, editOrder = null }: CreateOrderModalProps) {
    const [customerId, setCustomerId] = useState("");
    const [date, setDate] = useState<Date>();
    const [items, setItems] = useState([{ lineId: "", itemCode: "", qty: "", rate: "", qtyFulfilled: 0 }]);
    const [, forceRefresh] = useState(0);
    const { markAttempted, resetValidation, showValidation } = useFormValidationGate();

    const customers = getCustomers();
    const customerOptions = useMemo(() => toPartyComboboxOptions(customers), [customers]);
    const catalogItems = getFinishedGoodsItems();
    const isEdit = Boolean(editOrder?.dbId);

    useEffect(() => {
        if (!open) return;
        void initPartyCatalog().then(() => forceRefresh((t) => t + 1));
        const unsub = subscribeParties(() => forceRefresh((t) => t + 1));
        if (editOrder) {
            setCustomerId(editOrder.customerId);
            setDate(editOrder.deliveryDate ? parseISO(editOrder.deliveryDate.slice(0, 10)) : undefined);
            setItems(
                editOrder.items.length
                    ? editOrder.items.map((i) => ({
                          lineId: i.lineId ?? "",
                          itemCode: i.itemCode,
                          qty: String(i.qty),
                          rate: String(i.rate),
                          qtyFulfilled: i.qtyFulfilled ?? 0,
                      }))
                    : [{ lineId: "", itemCode: "", qty: "", rate: "", qtyFulfilled: 0 }]
            );
        } else {
            setCustomerId("");
            setDate(undefined);
            setItems([{ lineId: "", itemCode: "", qty: "", rate: "", qtyFulfilled: 0 }]);
            resetValidation();
        }
        return () => unsub();
    }, [open, editOrder, resetValidation]);

    const handleAddItem = () => {
        setItems([...items, { lineId: "", itemCode: "", qty: "", rate: "", qtyFulfilled: 0 }]);
    };

    const handleItemChange = (index: number, field: string, value: string) => {
        const newItems = [...items];
        // @ts-ignore
        newItems[index][field] = value;
        if (field === "qty" && newItems[index].qtyFulfilled > 0) {
            const minQty = newItems[index].qtyFulfilled;
            if (Number(value) < minQty) {
                newItems[index].qty = String(minQty);
            }
        }
        setItems(newItems);
    };

    const validLineCount = items.filter((i) => i.itemCode && Number(i.qty) > 0).length;
    const validationIssues = useMemo(
        () =>
            collectOrderFormIssues({
                partyId: customerId,
                partyLabel: "customer",
                validLineCount,
            }),
        [customerId, validLineCount],
    );

    const handleSubmit = () => {
        markAttempted("submit");
        if (validationIssues.errors.length > 0) return;

        onSubmit({
            dbId: editOrder?.dbId,
            orderNo: editOrder?.orderNo,
            customerId,
            customer: customerId,
            deliveryDate: date ? format(date, "yyyy-MM-dd") : "",
            items: items
                .filter((i) => i.itemCode && Number(i.qty) > 0)
                .map((i) => ({
                    lineId: i.lineId || undefined,
                    itemCode: i.itemCode,
                    item: i.itemCode,
                    qty: Number(i.qty),
                    rate: Number(i.rate) || 0,
                    qtyFulfilled: i.qtyFulfilled,
                })),
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Sales Order" : "Create Sales Order"}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? `Update order ${editOrder?.orderNo}` : "Create a new order for a customer."}
                    </DialogDescription>
                </DialogHeader>
                <FormValidationPanel
                    visible={showValidation}
                    issues={validationIssues}
                    title="Complete these fields before creating the order"
                />
                <div className="grid grid-cols-2 gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Customer</Label>
                        <PartyCombobox
                            value={customerId}
                            onValueChange={setCustomerId}
                            options={customerOptions}
                            placeholder="Search customer…"
                            disabled={isEdit}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Delivery Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant={"outline"} className={cn("justify-start text-left font-normal", !date && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                            </PopoverContent>
                        </Popover>
                    </div>

                    <OrderItemsScroll className="col-span-2">
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
                                {items.map((item, index) => (
                                    <TableRow key={index}>
                                        <TableCell>
                                            <Select
                                                value={item.itemCode}
                                                onValueChange={(val) => handleItemChange(index, "itemCode", val)}
                                                disabled={Boolean(item.lineId && item.qtyFulfilled > 0)}
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
                                                placeholder="Qty"
                                                min={item.qtyFulfilled || 0}
                                                value={item.qty}
                                                onChange={(e) => handleItemChange(index, "qty", e.target.value)}
                                            />
                                            {item.qtyFulfilled > 0 && (
                                                <p className="text-[10px] text-slate-500 mt-0.5">Fulfilled: {item.qtyFulfilled}</p>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Input type="number" className="h-8" placeholder="Rate" value={item.rate} onChange={(e) => handleItemChange(index, "rate", e.target.value)} />
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm font-medium">{(Number(item.qty || 0) * Number(item.rate || 0)).toLocaleString()}</span>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-rose-500"
                                                disabled={item.qtyFulfilled > 0}
                                                onClick={() => {
                                                    const newItems = [...items];
                                                    newItems.splice(index, 1);
                                                    setItems(newItems.length ? newItems : [{ lineId: "", itemCode: "", qty: "", rate: "", qtyFulfilled: 0 }]);
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </OrderItemsScroll>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="mt-2 col-span-2">
                        + Add Item
                    </Button>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700">
                        {isEdit ? "Save Changes" : "Create Order"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
