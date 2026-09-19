import DashboardLayout from "@/components/layout/DashboardLayout";
import { AccountCombobox } from "@/components/financials/AccountCombobox";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { useToast } from "@/components/ui/use-toast";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useBackendLiveMode } from "@/lib/backendFlags";
import {
    formValuesToPayload,
    isPartyControlAccount,
    journalVoucherFormSchema,
    type JournalVoucherFormValues,
} from "@/lib/domain/financials/journalVoucherPayload";
import {
    deleteJournalVoucher,
    fetchJournalVouchers,
    postJournalVoucher,
    type JournalVoucherRow,
} from "@/lib/repositories/financialsRepo";
import { useCoaAccounts, usePartiesCatalog } from "@/hooks/useErpQueries";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Add01Icon, BookOpen01Icon, Delete01Icon, Loading03Icon, RotateLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

const CARD = "shadow-soft border-slate-100 bg-white";

type FormLine = JournalVoucherFormValues["lines"][number];

function emptyLine(): FormLine {
    return { accountCode: "", partyCode: "", debit: "", credit: "", remarks: "" };
}

function formatAmt(n: number): string {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

/** Explicit, resolver-independent validity check used to gate the Post button. */
function isLineValid(line: FormLine): boolean {
    if (!line.accountCode.trim()) return false;
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (debit < 0 || credit < 0) return false;
    if (debit > 0 && credit > 0) return false;
    if (debit === 0 && credit === 0) return false;
    const party = (line.partyCode ?? "").trim();
    if (isPartyControlAccount(line.accountCode)) {
        if (!party) return false;
    } else if (party) {
        return false;
    }
    return true;
}

function isFormValid(values: JournalVoucherFormValues): boolean {
    if (values.lines.length < 2) return false;
    if (!values.lines.every(isLineValid)) return false;
    const totalDebit = round3(values.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round3(values.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    return totalDebit > 0 && totalCredit > 0 && totalDebit === totalCredit;
}

function matchesVoucherSearch(row: JournalVoucherRow, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.voucherNo, row.postingDate, row.narration, String(row.totalDebit), String(row.totalCredit)]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
}

export default function JournalVoucher() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const { data: coaRows = [] } = useCoaAccounts();
    const { data: parties = [] } = usePartiesCatalog();

    const [history, setHistory] = useState<JournalVoucherRow[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [posting, setPosting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [linesAnimate] = useAutoAnimate();

    const accountOptions = useMemo(
        () =>
            coaRows
                .filter((a) => a.is_posting && !a.is_group && a.is_active !== false)
                .map((a) => ({ code: a.code, name: a.name, accountType: a.account_type })),
        [coaRows],
    );

    const partyOptions = useMemo(() => toPartyComboboxOptions(parties), [parties]);

    const form = useForm<JournalVoucherFormValues>({
        resolver: zodResolver(journalVoucherFormSchema),
        defaultValues: {
            postingDate: format(new Date(), "yyyy-MM-dd"),
            referenceNo: "",
            narration: "",
            lines: [emptyLine(), emptyLine()],
        },
        mode: "onChange",
    });

    const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

    const watchedLines = form.watch("lines") as FormLine[];
    const watchedValues = form.watch() as JournalVoucherFormValues;

    const totals = useMemo(() => {
        const totalDebit = round3(watchedLines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
        const totalCredit = round3(watchedLines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
        return { totalDebit, totalCredit, difference: round3(totalDebit - totalCredit) };
    }, [watchedLines]);

    const formValid = useMemo(() => isFormValid(watchedValues), [watchedValues]);
    const canPost = liveMode && !posting && formValid;

    const filteredHistory = useMemo(
        () => history.filter((r) => matchesVoucherSearch(r, searchQuery)),
        [history, searchQuery],
    );

    const loadHistory = useCallback(async () => {
        if (!liveMode) {
            setHistory([]);
            return;
        }
        setHistoryLoading(true);
        try {
            setHistory(await fetchJournalVouchers(100));
        } catch (e) {
            toast({
                title: "Could not load vouchers",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setHistoryLoading(false);
        }
    }, [liveMode, toast]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    const handleAccountSelect = (index: number, code: string) => {
        form.setValue(`lines.${index}.accountCode`, code, { shouldValidate: true, shouldDirty: true });
        if (!isPartyControlAccount(code)) {
            form.setValue(`lines.${index}.partyCode`, "", { shouldValidate: true });
        }
    };

    const resetForm = (keepDate: string) => {
        form.reset({
            postingDate: keepDate,
            referenceNo: "",
            narration: "",
            lines: [emptyLine(), emptyLine()],
        });
    };

    const onSubmit = form.handleSubmit(async (values) => {
        if (!liveMode) {
            toast({
                title: "Live ERP required",
                description: "Journal vouchers post to the general ledger in live mode only.",
                variant: "destructive",
            });
            return;
        }
        if (!isFormValid(values)) {
            toast({ title: "Fix the highlighted lines before posting", variant: "destructive" });
            return;
        }
        setPosting(true);
        try {
            const result = await postJournalVoucher(formValuesToPayload(values));
            if (!result.ok) {
                toast({ title: "Post failed", description: result.error, variant: "destructive" });
                return;
            }
            toast({
                title: "Journal voucher posted",
                description: `${result.data.voucherNo} · Dr/Cr ${formatAmt(result.data.totalDebit)}`,
            });
            resetForm(values.postingDate);
            await loadHistory();
        } finally {
            setPosting(false);
        }
    });

    const handleDelete = async (row: JournalVoucherRow) => {
        if (!liveMode) return;
        if (!window.confirm(`Delete journal voucher ${row.voucherNo}? GL entries will be removed.`)) return;
        setDeletingId(row.id);
        try {
            const result = await deleteJournalVoucher(row.id);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Voucher deleted", description: row.voucherNo });
            await loadHistory();
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Journal Vouchers</h1>
                        <p className="text-slate-500">
                            Manual double-entry journals. Debits must equal credits; AR/AP lines require a party.
                        </p>
                    </div>
                </div>

                {!liveMode ? (
                    <Card className={cn(CARD, "border-amber-200 bg-amber-50/50")}>
                        <CardContent className="py-4 text-sm text-amber-900">
                            Connect to live ERP to post journal vouchers. Demo mode cannot write general ledger entries.
                        </CardContent>
                    </Card>
                ) : null}

                {/* ── NEW JV FORM ── */}
                <Card className={CARD}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Icon icon={BookOpen01Icon} size={20} className="text-black" />
                            New journal voucher
                        </CardTitle>
                        <CardDescription>
                            Leave reference blank to auto-allocate JV-0001 style numbers.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Form {...form}>
                            <form onSubmit={onSubmit} className="space-y-4">
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="grid gap-2">
                                        <Label htmlFor="postingDate">Date</Label>
                                        <Input id="postingDate" type="date" {...form.register("postingDate")} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="referenceNo">Reference no.</Label>
                                        <Input id="referenceNo" placeholder="Auto JV-####" {...form.register("referenceNo")} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="narration">Narration</Label>
                                        <Input id="narration" placeholder="Master narration" {...form.register("narration")} />
                                    </div>
                                </div>

                                <div className="overflow-hidden rounded-lg border border-slate-200">
                                    <TableScroller>
                                        <Table noWrapper className="min-w-[900px]">
                                            <TableHeader>
                                                <TableRow className="bg-slate-50">
                                                    <TableHead className="w-[28%]">Account</TableHead>
                                                    <TableHead className="w-[22%]">Party</TableHead>
                                                    <TableHead className="w-[12%]">Debit</TableHead>
                                                    <TableHead className="w-[12%]">Credit</TableHead>
                                                    <TableHead>Remarks</TableHead>
                                                    <TableHead className="w-[48px]" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody ref={linesAnimate}>
                                                {fields.map((field, index) => {
                                                    const accountCode = watchedLines[index]?.accountCode ?? "";
                                                    const partyEnabled = isPartyControlAccount(accountCode);
                                                    return (
                                                        <TableRow key={field.id}>
                                                            <TableCell className="align-top">
                                                                <FormField
                                                                    control={form.control}
                                                                    name={`lines.${index}.accountCode`}
                                                                    render={() => (
                                                                        <FormItem>
                                                                            <FormControl>
                                                                                <AccountCombobox
                                                                                    value={accountCode}
                                                                                    onSelect={(code) => handleAccountSelect(index, code)}
                                                                                    options={accountOptions}
                                                                                    placeholder="Select account…"
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="align-top">
                                                                <FormField
                                                                    control={form.control}
                                                                    name={`lines.${index}.partyCode`}
                                                                    render={({ field: partyField }) => (
                                                                        <FormItem>
                                                                            <FormControl>
                                                                                <PartyCombobox
                                                                                    value={partyField.value ?? ""}
                                                                                    onValueChange={partyField.onChange}
                                                                                    options={partyOptions}
                                                                                    placeholder={partyEnabled ? "Select party…" : "N/A"}
                                                                                    disabled={!partyEnabled}
                                                                                    highlightWhenEmpty={partyEnabled}
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="align-top">
                                                                <FormField
                                                                    control={form.control}
                                                                    name={`lines.${index}.debit`}
                                                                    render={({ field: debitField }) => (
                                                                        <FormItem>
                                                                            <FormControl>
                                                                                <Input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    step="0.001"
                                                                                    placeholder="0"
                                                                                    className="font-mono"
                                                                                    {...debitField}
                                                                                    onChange={(e) => {
                                                                                        debitField.onChange(e);
                                                                                        if (Number(e.target.value) > 0) {
                                                                                            form.setValue(`lines.${index}.credit`, "", { shouldValidate: true });
                                                                                        }
                                                                                    }}
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="align-top">
                                                                <FormField
                                                                    control={form.control}
                                                                    name={`lines.${index}.credit`}
                                                                    render={({ field: creditField }) => (
                                                                        <FormItem>
                                                                            <FormControl>
                                                                                <Input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    step="0.001"
                                                                                    placeholder="0"
                                                                                    className="font-mono"
                                                                                    {...creditField}
                                                                                    onChange={(e) => {
                                                                                        creditField.onChange(e);
                                                                                        if (Number(e.target.value) > 0) {
                                                                                            form.setValue(`lines.${index}.debit`, "", { shouldValidate: true });
                                                                                        }
                                                                                    }}
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="align-top">
                                                                <Input placeholder="Optional" {...form.register(`lines.${index}.remarks`)} />
                                                            </TableCell>
                                                            <TableCell className="align-top">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                                                                    disabled={fields.length <= 2}
                                                                    onClick={() => remove(index)}
                                                                >
                                                                    <Icon icon={Delete01Icon} size={16} />
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </TableScroller>
                                </div>

                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <Button type="button" variant="outline" onClick={() => append(emptyLine())} className="gap-1.5">
                                        <Icon icon={Add01Icon} size={16} />
                                        Add line
                                    </Button>
                                    <div className="flex flex-wrap items-center gap-4 text-sm">
                                        <span>
                                            Total Debit:{" "}
                                            <span className="font-mono font-semibold">{formatAmt(totals.totalDebit)}</span>
                                        </span>
                                        <span>
                                            Total Credit:{" "}
                                            <span className="font-mono font-semibold">{formatAmt(totals.totalCredit)}</span>
                                        </span>
                                        <span className={cn("font-medium", totals.difference !== 0 ? "text-rose-600" : "text-emerald-700")}>
                                            Difference: <span className="font-mono">{formatAmt(totals.difference)}</span>
                                        </span>
                                    </div>
                                </div>

                                {form.formState.errors.lines?.root?.message || form.formState.errors.lines?.message ? (
                                    <p className="text-sm text-destructive">
                                        {form.formState.errors.lines?.root?.message ?? form.formState.errors.lines?.message}
                                    </p>
                                ) : null}

                                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                    <Button type="button" variant="ghost" onClick={() => resetForm(format(new Date(), "yyyy-MM-dd"))} className="gap-1.5">
                                        <Icon icon={RotateLeft01Icon} size={16} />
                                        Reset
                                    </Button>
                                    <Button type="submit" className="bg-blue-600 hover:bg-blue-700 shadow-soft min-w-[160px]" disabled={!canPost}>
                                        {posting ? (
                                            <>
                                                <Icon icon={Loading03Icon} size={16} className="mr-2 animate-spin" />
                                                Posting…
                                            </>
                                        ) : (
                                            "Post JV"
                                        )}
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                </Card>

                {/* ── HISTORY ── */}
                <Card className={CARD}>
                    <CardHeader>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="text-lg">Recent vouchers</CardTitle>
                                <CardDescription>
                                    {history.length
                                        ? `${filteredHistory.length} of ${history.length} voucher${history.length !== 1 ? "s" : ""}${searchQuery ? " (filtered)" : ""}`
                                        : "Delete removes the header and related journal entries."}
                                </CardDescription>
                            </div>
                            <div className="relative w-full sm:w-[260px]">
                                <Icon icon={Search01Icon} size={16} className="absolute left-2.5 top-2.5 text-slate-500" />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search voucher #, date, narration…"
                                    className="pl-9"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <TableScroller>
                            <Table noWrapper className="min-w-[640px]">
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead>Voucher #</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Narration</TableHead>
                                        <TableHead className="text-right">Debit</TableHead>
                                        <TableHead className="text-right">Credit</TableHead>
                                        <TableHead className="w-[52px]" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {historyLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">Loading…</TableCell>
                                        </TableRow>
                                    ) : filteredHistory.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                                                {searchQuery
                                                    ? "No vouchers match your search."
                                                    : liveMode
                                                      ? "No journal vouchers yet."
                                                      : "History appears in live ERP mode."}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredHistory.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="font-mono text-xs text-blue-700">{row.voucherNo}</TableCell>
                                                <TableCell className="text-sm">{row.postingDate}</TableCell>
                                                <TableCell className="max-w-[280px] truncate text-sm text-slate-600">
                                                    {row.narration || "—"}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-sm">{formatAmt(row.totalDebit)}</TableCell>
                                                <TableCell className="text-right font-mono text-sm">{formatAmt(row.totalCredit)}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                                                        disabled={deletingId === row.id || !liveMode}
                                                        onClick={() => void handleDelete(row)}
                                                    >
                                                        <Icon icon={Delete01Icon} size={16} />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableScroller>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

