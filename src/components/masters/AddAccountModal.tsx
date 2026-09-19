import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { CoaNode, CoaNodeType } from "@/lib/coaStore";
import { useToast } from "@/components/ui/use-toast";

type Mode = "add" | "edit";

interface AddAccountModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode?: Mode;
    parentOptions: { id: string; name: string }[];
    getPreviewCode: (parentId: string) => string;
    initialAccount?: CoaNode | null;
    onCreate?: (input: {
        parentId: string;
        name: string;
        levelType: CoaNodeType;
        accountType: string;
        accountNature: string;
        reportGroup: string;
    }) => void;
    onUpdate?: (input: {
        code: string;
        name: string;
        accountType: string;
        accountNature: string;
        reportGroup: string;
    }) => Promise<void> | void;
}

const ACCOUNT_TYPE_OPTIONS = [
    { value: "asset", label: "Asset" },
    { value: "liability", label: "Liability" },
    { value: "equity", label: "Equity" },
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
];

const ACCOUNT_NATURE_OPTIONS = [
    { value: "debit", label: "Debit" },
    { value: "credit", label: "Credit" },
];

const REPORT_GROUP_OPTIONS = [
    { value: "current_assets", label: "Current Assets" },
    { value: "inventory_assets", label: "Inventory Assets" },
    { value: "fixed_assets", label: "Fixed Assets" },
    { value: "current_liabilities", label: "Current Liabilities" },
    { value: "long_term_liabilities", label: "Long-Term Liabilities" },
    { value: "equity", label: "Equity" },
    { value: "operating_revenue", label: "Operating Revenue" },
    { value: "other_income", label: "Other Income" },
    { value: "cogs", label: "COGS" },
    { value: "selling_expense", label: "Selling Expense" },
    { value: "admin_expense", label: "Admin Expense" },
    { value: "factory_overhead", label: "Factory Overhead" },
    { value: "other_expense", label: "Other Expense" },
];

function inferFromCode(code: string): { type: string; nature: string; group: string } {
    const first = code.slice(0, 1);
    if (first === "1") return { type: "asset", nature: "debit", group: "current_assets" };
    if (first === "2") return { type: "liability", nature: "credit", group: "current_liabilities" };
    if (first === "3") return { type: "equity", nature: "credit", group: "equity" };
    if (first === "4") return { type: "income", nature: "credit", group: "operating_revenue" };
    if (first === "5") return { type: "expense", nature: "debit", group: "cogs" };
    if (first === "6") return { type: "expense", nature: "debit", group: "admin_expense" };
    return { type: "expense", nature: "debit", group: "other_expense" };
}

export function AddAccountModal({
    open,
    onOpenChange,
    mode = "add",
    parentOptions,
    getPreviewCode,
    initialAccount = null,
    onCreate,
    onUpdate,
}: AddAccountModalProps) {
    const { toast } = useToast();
    const isEdit = mode === "edit";
    const [parent, setParent] = useState("");
    const [levelType, setLevelType] = useState<CoaNodeType>("leaf");
    const [name, setName] = useState("");
    const [accountType, setAccountType] = useState("expense");
    const [accountNature, setAccountNature] = useState("debit");
    const [reportGroup, setReportGroup] = useState("cogs");

    useEffect(() => {
        if (!open) return;
        if (isEdit && initialAccount) {
            const inferred = inferFromCode(initialAccount.id);
            setName(initialAccount.name);
            setLevelType(initialAccount.type);
            setAccountType(initialAccount.accountType ?? inferred.type);
            setAccountNature(initialAccount.accountNature ?? inferred.nature);
            setReportGroup(initialAccount.reportGroup ?? inferred.group);
            return;
        }
        setName("");
        setLevelType("leaf");
        setParent((prev) => prev || parentOptions[0]?.id || "");
    }, [open, isEdit, initialAccount, parentOptions]);

    useEffect(() => {
        if (isEdit || !parent) return;
        const inferred = inferFromCode(parent);
        setAccountType(inferred.type);
        setAccountNature(inferred.nature);
        setReportGroup(inferred.group);
    }, [parent, isEdit]);

    const accountCode = useMemo(() => {
        if (isEdit && initialAccount) return initialAccount.id;
        if (!parent) return "";
        return getPreviewCode(parent);
    }, [parent, getPreviewCode, isEdit, initialAccount]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast({ title: "Missing fields", description: "Account name is required.", variant: "destructive" });
            return;
        }
        if (!isEdit && !parent) {
            toast({ title: "Missing parent", description: "Select a parent group.", variant: "destructive" });
            return;
        }
        try {
            if (isEdit && onUpdate && initialAccount) {
                await onUpdate({
                    code: initialAccount.id,
                    name: name.trim(),
                    accountType,
                    accountNature,
                    reportGroup,
                });
                onOpenChange(false);
                toast({ title: "Account updated", description: `${initialAccount.id} · ${name.trim()}` });
                return;
            }
            onCreate?.({
                parentId: parent,
                name: name.trim(),
                levelType,
                accountType,
                accountNature,
                reportGroup,
            });
            onOpenChange(false);
            toast({ title: "Account created", description: `${accountCode} · ${name.trim()}` });
            setName("");
        } catch (e) {
            toast({
                title: isEdit ? "Could not update account" : "Could not create account",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[450px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Account" : "Define New Structural Account"}</DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Rename or reclassify an account. Posting history is preserved."
                            : "Create COA structural heads only. Party ledgers should be created from Party Master."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-5 py-4">
                    {!isEdit && (
                        <div className="grid gap-2">
                            <Label className="text-slate-500 font-semibold">Parent Group</Label>
                            <Select value={parent} onValueChange={setParent}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select parent" />
                                </SelectTrigger>
                                <SelectContent>
                                    {parentOptions.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.id}: {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {!isEdit && (
                        <div className="grid gap-2">
                            <Label className="text-slate-500 font-semibold">Level Type</Label>
                            <div className="flex bg-slate-100 p-1 rounded-lg">
                                <button
                                    className={`flex-1 py-1.5 px-3 rounded-md text-sm font-semibold transition-colors ${levelType === "group" ? "bg-white shadow-sm text-blue-700 border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                                    onClick={() => setLevelType("group")}
                                >
                                    Group (Folder)
                                </button>
                                <button
                                    className={`flex-1 py-1.5 px-3 rounded-md text-sm font-semibold transition-colors ${levelType === "leaf" ? "bg-white shadow-sm text-slate-900 border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                                    onClick={() => setLevelType("leaf")}
                                >
                                    Leaf (Postable)
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="grid gap-2">
                        <Label className="text-slate-500 font-semibold">Account Name</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Software Server Costs"
                            className="border-slate-300"
                        />
                    </div>

                    <div className="grid gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <Label className="text-slate-600 font-semibold flex items-center">Account Code</Label>
                        <Input
                            value={accountCode}
                            disabled
                            className="bg-white font-mono text-lg font-bold text-blue-700 border-blue-200 disabled:opacity-100 cursor-not-allowed"
                        />
                        <p className="text-xs text-slate-500">
                            {isEdit ? "Account code cannot be changed." : "Code is deterministically generated from the selected parent group."}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                            <Label className="text-slate-500 font-semibold">Account Type</Label>
                            <Select value={accountType} onValueChange={setAccountType}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {ACCOUNT_TYPE_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-slate-500 font-semibold">Nature</Label>
                            <Select value={accountNature} onValueChange={setAccountNature}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {ACCOUNT_NATURE_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label className="text-slate-500 font-semibold">Report Group</Label>
                        <Select value={reportGroup} onValueChange={setReportGroup}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {REPORT_GROUP_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {!isEdit && levelType === "leaf" && (
                        <Alert className="bg-emerald-50 border-emerald-200 text-emerald-800 py-2">
                            <Info className="h-4 w-4 text-emerald-600" />
                            <AlertDescription className="text-xs ml-2">
                                This account will be postable in vouchers and cashbook entries.
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
                <DialogFooter className="pt-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => void handleSubmit()} className="bg-blue-600 hover:bg-blue-700" disabled={!name}>
                        {isEdit ? "Save Changes" : "Add Account"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
