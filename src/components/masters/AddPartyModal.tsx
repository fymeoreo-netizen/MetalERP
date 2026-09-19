import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Anchor, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { addParty, updateParty, type PartyRecord, type PartyType } from "@/lib/partyCatalog";
import { fetchOpeningScrapLinesForParty } from "@/lib/api/posting";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";

interface AddPartyModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode?: "add" | "edit";
    initialParty?: PartyRecord | null;
    onDone?: () => void;
}

type DraftOpeningScrapLine = {
    key: string;
    obligationId?: string;
    expectedKg: string;
    refRate: string;
    asOfDate: string;
    label: string;
    receivedKg?: number;
};

function emptyScrapLine(): DraftOpeningScrapLine {
    return {
        key: crypto.randomUUID(),
        expectedKg: "",
        refRate: "",
        asOfDate: new Date().toISOString().slice(0, 10),
        label: "",
    };
}

function mapDraftLines(lines: DraftOpeningScrapLine[]) {
    return lines
        .filter((line) => Number(line.expectedKg || 0) > 0 || Number(line.refRate || 0) > 0)
        .map((line) => ({
            obligationId: line.obligationId,
            expectedKg: Number(line.expectedKg || 0),
            refRate: Number(line.refRate || 0),
            asOfDate: line.asOfDate || new Date().toISOString().slice(0, 10),
            label: line.label.trim() || undefined,
        }));
}

function validateDraftScrapLines(lines: DraftOpeningScrapLine[]): string | null {
    for (const line of lines) {
        const kg = Number(line.expectedKg || 0);
        const rate = Number(line.refRate || 0);
        if ((kg > 0) !== (rate > 0)) {
            return "Each opening scrap line needs both expected kg and ref scrap rate, or leave the row blank.";
        }
    }
    return null;
}

export function AddPartyModal({ open, onOpenChange, mode = "add", initialParty = null, onDone }: AddPartyModalProps) {
    const { toast } = useToast();
    const isEdit = mode === "edit";
    const [name, setName] = useState("");
    const [type, setType] = useState<PartyType>("Customer");
    const [city, setCity] = useState("");
    const [phone, setPhone] = useState("");
    const [taxRegNo, setTaxRegNo] = useState("");
    const [creditLimit, setCreditLimit] = useState("");
    const [openingFinBalance, setOpeningFinBalance] = useState("");
    const [openingMetalBalance, setOpeningMetalBalance] = useState("");
    const [openingScrapLines, setOpeningScrapLines] = useState<DraftOpeningScrapLine[]>([]);
    const [loadingScrapLines, setLoadingScrapLines] = useState(false);

    useEffect(() => {
        if (!open) return;

        let cancelled = false;

        async function hydrate() {
            if (isEdit && initialParty) {
                setName(initialParty.name);
                setType(initialParty.type);
                setCity(initialParty.city ?? "");
                setPhone(initialParty.phone ?? "");
                setTaxRegNo(initialParty.taxRegNo ?? "");
                setCreditLimit(String(initialParty.creditLimit ?? ""));
                setOpeningFinBalance(String(initialParty.openingFinBalance ?? ""));
                setOpeningMetalBalance(String(initialParty.openingMetalBalance ?? ""));

                if (isErpLiveMode() && (initialParty.type === "Customer" || initialParty.type === "Both")) {
                    setLoadingScrapLines(true);
                    try {
                        const rows = await fetchOpeningScrapLinesForParty(initialParty.id);
                        if (cancelled) return;
                        setOpeningScrapLines(
                            rows.length
                                ? rows.map((row) => ({
                                      key: row.obligationId,
                                      obligationId: row.obligationId,
                                      expectedKg: String(row.expectedKg),
                                      refRate: String(row.refRate),
                                      asOfDate: row.asOfDate || new Date().toISOString().slice(0, 10),
                                      label: row.label === row.displayLabel ? row.label : row.displayLabel,
                                      receivedKg: row.receivedKg,
                                  }))
                                : [],
                        );
                    } catch {
                        if (!cancelled) setOpeningScrapLines([]);
                    } finally {
                        if (!cancelled) setLoadingScrapLines(false);
                    }
                } else {
                    setOpeningScrapLines([]);
                }
                return;
            }

            setName("");
            setType("Customer");
            setCity("");
            setPhone("");
            setTaxRegNo("");
            setCreditLimit("");
            setOpeningFinBalance("");
            setOpeningMetalBalance("");
            setOpeningScrapLines([]);
        }

        void hydrate();
        return () => {
            cancelled = true;
        };
    }, [open, isEdit, initialParty]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast({ title: "Missing fields", description: "Party name is required.", variant: "destructive" });
            return;
        }
        const scrapError = validateDraftScrapLines(openingScrapLines);
        if (scrapError) {
            toast({ title: "Opening scrap incomplete", description: scrapError, variant: "destructive" });
            return;
        }
        const scrapPayload = mapDraftLines(openingScrapLines);
        try {
            if (isEdit && initialParty) {
                const updated = await updateParty(initialParty.id, {
                    name,
                    type,
                    city,
                    phone,
                    taxRegNo,
                    creditLimit: Number(creditLimit || 0),
                    openingFinBalance: Number(openingFinBalance || 0),
                    openingMetalBalance: Number(openingMetalBalance || 0),
                    openingScrapLines: scrapPayload,
                });
                onOpenChange(false);
                onDone?.();
                toast({ title: "Party updated", description: `${updated.id} · ${updated.name}` });
                return;
            }
            const created = await addParty({
                name,
                type,
                city,
                phone,
                taxRegNo,
                creditLimit: Number(creditLimit || 0),
                openingFinBalance: Number(openingFinBalance || 0),
                openingMetalBalance: Number(openingMetalBalance || 0),
                openingScrapLines: scrapPayload,
            });
            onOpenChange(false);
            onDone?.();
            toast({ title: "Party created", description: `${created.id} · ${created.name}` });
        } catch (e) {
            toast({
                title: isEdit ? "Could not update party" : "Could not create party",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    const updateScrapLine = (key: string, patch: Partial<DraftOpeningScrapLine>) => {
        setOpeningScrapLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    };

    const removeScrapLine = (key: string) => {
        setOpeningScrapLines((rows) => rows.filter((row) => row.key !== key));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Party" : "Add New Party"}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? "Update customer or vendor details." : "Register a new Customer or Vendor."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {isEdit && initialParty ? (
                        <div className="grid gap-2">
                            <Label>Party Code</Label>
                            <Input value={initialParty.id} disabled className="bg-slate-50 font-mono" />
                        </div>
                    ) : null}
                    <div className="grid gap-2">
                        <Label htmlFor="name">Party Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Business Name"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="type">Type</Label>
                        <Select value={type} onValueChange={(v) => setType(v as PartyType)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Customer">Customer</SelectItem>
                                <SelectItem value="Vendor">Vendor</SelectItem>
                                <SelectItem value="Both">Both</SelectItem>
                            </SelectContent>
                        </Select>
                        <div className="mt-1 flex items-center text-xs font-semibold px-2 py-1.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                            <Anchor className="h-3 w-3 mr-1.5" />
                            Auto-Anchored to:
                            <span className="ml-1 font-bold">
                                {type === "Customer"
                                    ? "11201 (Accounts Receivable)"
                                    : type === "Vendor"
                                      ? "21101 (Accounts Payable)"
                                      : "11201 + 21101 (Receivable + Payable)"}
                            </span>
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="city">City</Label>
                        <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lahore" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 ..." />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="taxRegNo">Tax Reg No</Label>
                        <Input id="taxRegNo" value={taxRegNo} onChange={(e) => setTaxRegNo(e.target.value)} placeholder="NTN / STRN" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="openingFinBalance">Opening Financial Balance</Label>
                        <Input
                            id="openingFinBalance"
                            type="number"
                            value={openingFinBalance}
                            onChange={(e) => setOpeningFinBalance(e.target.value)}
                            placeholder="0"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="openingMetalBalance">Opening Metal Balance (KG)</Label>
                        <p className="text-xs text-slate-500">
                            Party metal khata only — does not change warehouse inventory.
                        </p>
                        <Input
                            id="openingMetalBalance"
                            type="number"
                            value={openingMetalBalance}
                            onChange={(e) => setOpeningMetalBalance(e.target.value)}
                            placeholder="0"
                        />
                    </div>
                    {type !== "Vendor" ? (
                        <div className="grid gap-3 rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <Label>Opening Scrap to Receive</Label>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Add one row per pre-go-live scrap balance. Each row can have its own kg and ref rate.
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    onClick={() => setOpeningScrapLines((rows) => [...rows, emptyScrapLine()])}
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add line
                                </Button>
                            </div>
                            {loadingScrapLines ? (
                                <p className="text-xs text-slate-500">Loading opening scrap lines…</p>
                            ) : openingScrapLines.length === 0 ? (
                                <p className="text-xs text-slate-500">No opening scrap lines yet.</p>
                            ) : (
                                <div className="space-y-3">
                                    {openingScrapLines.map((line, index) => {
                                        const locked = Number(line.receivedKg ?? 0) > 0;
                                        return (
                                            <div key={line.key} className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                                        Line {index + 1}
                                                        {locked ? ` · ${line.receivedKg} kg received` : ""}
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-slate-500 hover:text-red-600"
                                                        disabled={locked}
                                                        onClick={() => removeScrapLine(line.key)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="grid gap-1.5">
                                                        <Label className="text-xs">Expected kg</Label>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            value={line.expectedKg}
                                                            onChange={(e) => updateScrapLine(line.key, { expectedKg: e.target.value })}
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                    <div className="grid gap-1.5">
                                                        <Label className="text-xs">Ref rate (₨/kg)</Label>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            value={line.refRate}
                                                            onChange={(e) => updateScrapLine(line.key, { refRate: e.target.value })}
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                    <div className="grid gap-1.5">
                                                        <Label className="text-xs">As-of date</Label>
                                                        <Input
                                                            type="date"
                                                            value={line.asOfDate}
                                                            onChange={(e) => updateScrapLine(line.key, { asOfDate: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="grid gap-1.5">
                                                        <Label className="text-xs">Label (ledger ref)</Label>
                                                        <Input
                                                            value={line.label}
                                                            onChange={(e) => updateScrapLine(line.key, { label: e.target.value })}
                                                            placeholder={`Opening Balance #${index + 1}`}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : null}
                    {type !== "Vendor" ? (
                        <div className="grid gap-2">
                            <Label htmlFor="creditLimit">Credit Limit</Label>
                            <Input
                                id="creditLimit"
                                type="number"
                                value={creditLimit}
                                onChange={(e) => setCreditLimit(e.target.value)}
                                placeholder="0"
                            />
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => void handleSubmit()} className="bg-blue-600 hover:bg-blue-700">
                        {isEdit ? "Save Changes" : "Add Party"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
