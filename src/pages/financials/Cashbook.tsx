import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CashbookEntryForm } from "@/components/cashbook/CashbookEntryForm";
import { CashbookLedger } from "@/components/cashbook/CashbookLedger";
import { SettleAdvancesModal } from "@/components/cashbook/SettleAdvancesModal";
import { Wallet, History, FileText, ArrowUpRight } from "lucide-react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { CashbookLedgerRow, CashbookLedgerViewMode, CashbookEntryMode, ParchiCommitmentRow } from "@/lib/cashbookTypes";
import { formatPkr } from "@/lib/cashbookTypes";
import {
    fetchPayments,
    fetchParchis,
    fetchParchiClearancesForPayment,
    fetchTrialBalance,
    deletePaymentDocument,
    saveAndPostPayment,
} from "@/lib/repositories/financialsRepo";
import { computeParchiClearancePlan, partyParchiOptions } from "@/lib/parchiClearance";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";
import { getParties, initPartyCatalog, resolvePartyName } from "@/lib/partyCatalog";
import {
    buildCashbookAccountOptions,
    buildCoaNameMap,
    isBankGlAccountCode,
    isCashDrawerAccountCode,
    isPartyAccountSelection,
    resolveCashbookEntryKind,
    type CashbookAccountOption,
} from "@/lib/coaSelectors";
import { allocateNextPaymentNo } from "@/lib/documentNumbers";
import { fetchCoaAccounts } from "@/lib/api/masters";

const CARD = "shadow-soft border-slate-100 bg-white";

function comparePageNo(a: string, b: string): number {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== "" && b !== "") {
        if (na !== nb) return na - nb;
    }
    return a.localeCompare(b, undefined, { numeric: true });
}

function balanceBeforeEntry(ledger: CashbookLedgerRow[], entryId: string): number {
    const idx = ledger.findIndex((r) => r.id === entryId);
    if (idx <= 0) return 0;
    return ledger[idx - 1].balance;
}

type PaymentRow = {
    id: string;
    payment_no: string;
    payment_type: string;
    payment_date: string;
    amount: number | string;
    voucher_subtype?: string | null;
    page_no?: string | null;
    remarks?: string | null;
    entry_kind?: string | null;
    counter_account_code?: string | null;
    bank_account_code?: string | null;
    parties?: { code?: string | null; name?: string | null } | null;
    party?: { code?: string | null; name?: string | null } | null;
    counter_party?: { code?: string | null; name?: string | null } | null;
};

function recalculateBalances(data: CashbookLedgerRow[], openingBalance = 0): CashbookLedgerRow[] {
    let currentBalance = openingBalance;
    return data.map((row) => {
        currentBalance += row.debit - row.credit;
        return { ...row, balance: currentBalance };
    });
}

/** Net of debit−credit across ledger legs (excludes baked-in GL opening). */
function registerMovementNet(rows: CashbookLedgerRow[]): number {
    return rows.reduce((sum, row) => sum + row.debit - row.credit, 0);
}

/** Opening balance implied by the first row's running balance. */
function openingFromLedger(ledger: CashbookLedgerRow[]): number {
    if (ledger.length === 0) return 0;
    const first = ledger[0];
    return first.balance - first.debit + first.credit;
}

function tbNet(
    rows: { account_code?: string; total_debit?: number; total_credit?: number }[],
    predicate: (code: string) => boolean,
): number {
    return rows
        .filter((r) => predicate(String(r.account_code ?? "")))
        .reduce(
            (sum, r) => sum + Number(r.total_debit ?? 0) - Number(r.total_credit ?? 0),
            0,
        );
}

function comparePaymentsCanonical(a: PaymentRow, b: PaymentRow): number {
    return (
        a.payment_date.localeCompare(b.payment_date) ||
        a.payment_no.localeCompare(b.payment_no, undefined, { numeric: true }) ||
        a.id.localeCompare(b.id)
    );
}

function paymentParty(row: PaymentRow): { code?: string | null; name?: string | null } | null {
    return row.party ?? row.parties ?? null;
}

function mapPaymentsToLedger(
    rows: PaymentRow[],
    nameMap: Record<string, string>,
    openingBalance = 0,
): CashbookLedgerRow[] {
    const ledgerRows: CashbookLedgerRow[] = [...rows].sort(comparePaymentsCanonical).flatMap((row): CashbookLedgerRow[] => {
        const isSettlement = row.voucher_subtype === "CROSS_SETTLE" || row.entry_kind === "party_settlement";
        const amount = Number(row.amount ?? 0);
        const pageNo = row.page_no ?? "1";
        const party = paymentParty(row);
        const payingName = party?.name ?? "Paying party";
        const receivingName = row.counter_party?.name ?? "Receiving party";
        const remark = row.remarks?.trim() || "";
        const common = {
            dbId: row.id,
            sourcePaymentNo: row.payment_no,
            sourceRemarks: remark,
            groupSourceId: row.id,
            partyCode: party?.code ?? "",
            counterPartyCode: row.counter_party?.code ?? "",
            entryKind: row.entry_kind ?? undefined,
            bankAccountCode: row.bank_account_code ?? undefined,
            pageNo,
            date: row.payment_date,
            amount,
            balance: 0,
        };

        if (isSettlement) {
            const route = `${payingName} → ${receivingName}`;
            const detail = ["Cross-party settlement", route, remark].filter(Boolean).join(" · ");
            return [
                {
                    ...common,
                    id: `${row.id}:settlement:receipt`,
                    virtualLeg: "settlement_receipt" as const,
                    account: payingName,
                    voucherType: "CRV",
                    mode: "Cross-Party",
                    desc: `${detail} · linked ${row.payment_no}`,
                    debit: amount,
                    credit: 0,
                },
                {
                    ...common,
                    id: `${row.id}:settlement:payment`,
                    virtualLeg: "settlement_payment" as const,
                    account: receivingName,
                    voucherType: "CPV",
                    mode: "Cross-Party",
                    desc: `${detail} · linked ${row.payment_no}`,
                    debit: 0,
                    credit: amount,
                },
            ];
        }

        const counterLabel = row.counter_account_code
            ? `[${row.counter_account_code}] ${nameMap[row.counter_account_code] ?? row.counter_account_code}`
            : null;
        const account = counterLabel ?? party?.name ?? "Cash";
        const typeLabel =
            row.voucher_subtype === "PARCHI_CLEAR"
                ? "Parchi clearance"
                : row.payment_type === "receipt"
                  ? "Cash received"
                  : "Cash paid";
        return [
            {
                ...common,
                id: `${row.id}:payment`,
                counterAccountCode: row.counter_account_code ?? undefined,
                account,
                voucherType:
                    row.voucher_subtype ?? (row.payment_type === "receipt" ? "CRV" : "CPV"),
                mode: row.voucher_subtype === "PARCHI_CLEAR" ? "Clear Parchi" : "Cash",
                desc: [typeLabel, account, remark].filter(Boolean).join(" · "),
                debit: row.payment_type === "receipt" ? amount : 0,
                credit: row.payment_type === "payment" ? amount : 0,
            },
        ];
    });

    return recalculateBalances(ledgerRows, openingBalance);
}

function openingBalanceForScope(
    ledger: CashbookLedgerRow[],
    scoped: CashbookLedgerRow[],
    viewMode: CashbookLedgerViewMode,
    date: string,
    registerOpening: number,
): number {
    if (scoped.length > 0) return balanceBeforeEntry(ledger, scoped[0].id);

    if (viewMode === "date") {
        const prior = ledger.filter((r) => r.date < date);
        return prior.length > 0 ? prior[prior.length - 1].balance : registerOpening;
    }

    return registerOpening;
}

/**
 * Net movement recorded on all pages BEFORE the given page (page-number order).
 * A paged cashbook chains page-to-page: page N+1 opens with page N's closing
 * even when dates interleave across pages (backdated entries etc.).
 */
function netForPagesBefore(ledger: CashbookLedgerRow[], pageNo: string): number {
    const target = pageNo || "1";
    return ledger.reduce(
        (sum, r) => (comparePageNo(r.pageNo || "1", target) < 0 ? sum + r.debit - r.credit : sum),
        0,
    );
}

function KpiCard({
    label,
    value,
    sub,
    icon: Icon,
    iconTone,
}: {
    label: string;
    value: string;
    sub: string;
    icon: typeof Wallet;
    iconTone: string;
}) {
    return (
        <Card className={cn(CARD, "hover:-translate-y-0.5 transition-transform")}>
            <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", iconTone)}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
                    <p className="text-lg font-semibold text-slate-900 tabular-nums truncate">{value}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
                </div>
            </CardContent>
        </Card>
    );
}

export default function Cashbook() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const [ledgerData, setLedgerData] = useState<CashbookLedgerRow[]>([]);
    const [parchiData, setParchiData] = useState<(ParchiCommitmentRow & { dbId?: string })[]>([]);
    /** Cash drawer GL (11101+11102) — source of truth for Cash in hand incl. JVs. */
    const [cashDrawerGlBalance, setCashDrawerGlBalance] = useState(0);
    /** Bank GL only (11111–11114). */
    const [bankBalance, setBankBalance] = useState(0);
    const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
    const [coaNameMap, setCoaNameMap] = useState<Record<string, string>>({});
    const [accountOptions, setAccountOptions] = useState<CashbookAccountOption[]>([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [ledgerError, setLedgerError] = useState<string | null>(null);

    useEffect(() => {
        void initPartyCatalog().then(() => {
            setParties(getParties().map((p) => ({ id: p.id, name: p.name })));
        });
    }, []);

    useEffect(() => {
        if (!liveMode) {
            setAccountOptions(buildCashbookAccountOptions(parties, []));
            setLedgerData([]);
            setParchiData([]);
            setCashDrawerGlBalance(0);
            setBankBalance(0);
            return;
        }
        void (async () => {
            const allCoa = await fetchCoaAccounts();
            setCoaNameMap(buildCoaNameMap(allCoa));
            setAccountOptions(buildCashbookAccountOptions(parties, allCoa));
        })();
    }, [liveMode, parties]);

    const refreshPayments = useCallback(async () => {
        if (!liveMode) return;
        setLedgerLoading(true);
        setLedgerError(null);
        try {
            const [rows, tbRows] = await Promise.all([
                fetchPayments() as Promise<PaymentRow[]>,
                fetchTrialBalance(),
            ]);
            const cashDrawer = tbNet(tbRows, isCashDrawerAccountCode);
            const bank = tbNet(tbRows, isBankGlAccountCode);
            setCashDrawerGlBalance(cashDrawer);
            setBankBalance(bank);

            // Bake non-cashbook GL (JVs, openings) into register opening so Cash in hand matches GL.
            const mapped = mapPaymentsToLedger(rows, coaNameMap, 0);
            const registerOpening = cashDrawer - registerMovementNet(mapped);
            setLedgerData(recalculateBalances(mapped, registerOpening));
        } catch (error) {
            setLedgerData([]);
            setLedgerError(error instanceof Error ? error.message : "Failed to load the cashbook.");
        } finally {
            setLedgerLoading(false);
        }
    }, [liveMode, coaNameMap]);

    useEffect(() => {
        if (!liveMode) return;
        void refreshPayments();
        void fetchParchis().then((rows) => {
            setParchiData(
                rows
                    .filter((p: { status?: string }) => p.status !== "void")
                    .map((p: any) => ({
                        parchi_id: p.parchi_no,
                        dbId: p.id,
                        party_id: p.parties?.code ?? "",
                        party_name: p.parties?.name ?? "",
                        total_amount: Number(p.total_amount),
                        cleared_amount: Number(p.cleared_amount),
                        available_balance: Number(p.open_amount),
                        status:
                            p.status === "cleared"
                                ? "Cleared"
                                : p.status === "partial"
                                  ? "Partially Cleared"
                                  : "Pending",
                    })),
            );
        });
    }, [liveMode, coaNameMap, refreshPayments]);

    const accountBtnRef = useRef<HTMLButtonElement>(null);
    const amountInputRef = useRef<HTMLInputElement>(null);
    const formCardRef = useRef<HTMLDivElement>(null);

    const focusAfterPost = (mode: CashbookEntryMode) => {
        setTimeout(() => {
            if (mode === "cross_party") {
                amountInputRef.current?.focus();
                amountInputRef.current?.select?.();
            } else {
                accountBtnRef.current?.focus();
            }
        }, 0);
    };

    const [accountOpen, setAccountOpen] = useState(false);
    const [receivingPartyOpen, setReceivingPartyOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingDbId, setEditingDbId] = useState<string | null>(null);
    const [voucherId, setVoucherId] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [pageNo, setPageNo] = useState("1");
    const [entryMode, setEntryMode] = useState<CashbookEntryMode>("standard");
    const [actionType, setActionType] = useState<"CRV" | "CPV">("CRV");
    const [clearanceMode, setClearanceMode] = useState<"Cash" | "Clear Parchi">("Cash");
    const [selectedAccount, setSelectedAccount] = useState("");
    const [receivingPartyCode, setReceivingPartyCode] = useState("");
    const [amount, setAmount] = useState("");
    const [desc, setDesc] = useState("");

    const [searchQuery, setSearchQuery] = useState("");
    const [ledgerViewMode, setLedgerViewMode] = useState<CashbookLedgerViewMode>("date");

    const [selectedParchiId, setSelectedParchiId] = useState("");
    const [additionalParchiIds, setAdditionalParchiIds] = useState<string[]>([]);
    const [applyRemainderAsCash, setApplyRemainderAsCash] = useState(false);
    const [editParchiPrior, setEditParchiPrior] = useState<Record<string, number>>({});
    const [isAdvance, setIsAdvance] = useState(false);
    const [settleAdvancesOpen, setSettleAdvancesOpen] = useState(false);

    const selectedParchi = useMemo(() => parchiData.find(p => p.parchi_id === selectedParchiId), [selectedParchiId, parchiData]);
    const partyParchisForAccount = useMemo(
        () => parchiData.filter((p) => p.party_id === selectedAccount),
        [parchiData, selectedAccount],
    );
    const receiptAmount = Number(amount) || 0;
    const additionalParchiOptions = useMemo(
        () =>
            partyParchiOptions(partyParchisForAccount, {
                excludeParchiIds: [selectedParchiId, ...additionalParchiIds],
            }),
        [partyParchisForAccount, selectedParchiId, additionalParchiIds],
    );
    const parchiClearancePlan = useMemo(() => {
        if (clearanceMode !== "Clear Parchi" || !selectedParchiId || receiptAmount <= 0) return null;
        return computeParchiClearancePlan({
            totalAmount: receiptAmount,
            primaryParchiId: selectedParchiId,
            additionalParchiIds,
            partyParchis: partyParchisForAccount,
            priorByParchiNo: editingId ? editParchiPrior : undefined,
            userNote: desc,
            allowCashRemainder: applyRemainderAsCash,
            cashRemainderLabel: entryMode === "cross_party" ? "On account" : undefined,
        });
    }, [
        clearanceMode,
        selectedParchiId,
        additionalParchiIds,
        applyRemainderAsCash,
        receiptAmount,
        partyParchisForAccount,
        editingId,
        editParchiPrior,
        desc,
        entryMode,
    ]);
    const entriesForDate = useMemo(() => {
        const indexed = ledgerData.map((r, i) => ({ r, i }));
        return indexed
            .filter(({ r }) => r.date === date)
            .sort((a, b) => comparePageNo(a.r.pageNo || "1", b.r.pageNo || "1") || a.i - b.i)
            .map(({ r }) => r);
    }, [ledgerData, date]);

    const entriesForPage = useMemo(
        () => ledgerData.filter((r) => (r.pageNo || "1") === pageNo),
        [ledgerData, pageNo],
    );

    const scopedEntries = useMemo(() => {
        if (ledgerViewMode === "date") return entriesForDate;
        return entriesForPage;
    }, [ledgerViewMode, ledgerData, entriesForDate, entriesForPage]);

    const filteredLedger = useMemo(
        () =>
            scopedEntries.filter(
                (row) =>
                    searchQuery === "" ||
                    row.account.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    row.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (row.pageNo || "1").includes(searchQuery) ||
                    row.date.includes(searchQuery),
            ),
        [scopedEntries, searchQuery],
    );

    const registerOpeningBalance = useMemo(() => {
        if (ledgerData.length > 0) return openingFromLedger(ledgerData);
        return cashDrawerGlBalance;
    }, [ledgerData, cashDrawerGlBalance]);

    const { openingBalance, closingBalance } = useMemo(() => {
        // Page view chains by PAGE SEQUENCE (earlier pages' net), so page N+1's
        // opening always equals page N's closing regardless of entry dates.
        const opening =
            ledgerViewMode === "page"
                ? registerOpeningBalance + netForPagesBefore(ledgerData, pageNo)
                : openingBalanceForScope(
                      ledgerData,
                      scopedEntries,
                      ledgerViewMode,
                      date,
                      registerOpeningBalance,
                  );
        const closing = scopedEntries.reduce(
            (balance, row) => balance + row.debit - row.credit,
            opening,
        );
        return { openingBalance: opening, closingBalance: closing };
    }, [ledgerData, scopedEntries, ledgerViewMode, pageNo, date, registerOpeningBalance]);
    const dayFlow = useMemo(() => {
        const received = scopedEntries.reduce((sum, row) => sum + row.debit, 0);
        const paid = scopedEntries.reduce((sum, row) => sum + row.credit, 0);
        return { received, paid };
    }, [scopedEntries]);

    const allEntriesClosingBalance = useMemo(
        () => (ledgerData.length > 0 ? ledgerData[ledgerData.length - 1].balance : cashDrawerGlBalance),
        [ledgerData, cashDrawerGlBalance],
    );

    const cashInHandBalance = closingBalance;
    const cashInHandSub =
        ledgerViewMode === "date"
            ? `Balance for ${date} (incl. opening)`
            : `Balance for page ${pageNo} (incl. opening)`;

    const withRegisterOpening = useCallback(
        (rows: CashbookLedgerRow[], prev: CashbookLedgerRow[]) =>
            recalculateBalances(rows, prev.length > 0 ? openingFromLedger(prev) : cashDrawerGlBalance),
        [cashDrawerGlBalance],
    );

    const editingRow = useMemo(
        () => (editingId ? ledgerData.find((r) => r.id === editingId) : undefined),
        [editingId, ledgerData],
    );

    const selectedIsParty = isPartyAccountSelection(selectedAccount, parties);

    const isReadyToSave = () => {
        if (receiptAmount <= 0) return false;
        if (entryMode === "cross_party") {
            if (!selectedAccount || !receivingPartyCode) return false;
            if (selectedAccount === receivingPartyCode) return false;
            if (clearanceMode === "Clear Parchi") {
                if (!selectedParchiId) return false;
                if (parchiClearancePlan?.ok !== true) return false;
                if ((parchiClearancePlan.cashAmount ?? 0) > 0 && !desc.trim()) return false;
                return true;
            }
            return desc.trim() !== "";
        }
        if (!selectedAccount) return false;
        if (clearanceMode === "Clear Parchi") {
            if (!selectedParchiId) return false;
            if (parchiClearancePlan?.ok !== true) return false;
            if ((parchiClearancePlan.cashAmount ?? 0) > 0 && !desc.trim()) return false;
            return true;
        }
        return editingId ? true : desc.trim() !== "";
    };

    const refreshNextVoucherId = useCallback(() => {
        void allocateNextPaymentNo().then(setVoucherId);
    }, []);

    useEffect(() => {
        refreshNextVoucherId();
    }, [refreshNextVoucherId]);

    const resetEntryForm = (opts?: { keepCrossPartyParties?: boolean }) => {
        setEditingId(null);
        setEditingDbId(null);
        setAmount("");
        setDesc("");
        setSelectedParchiId("");
        setAdditionalParchiIds([]);
        setApplyRemainderAsCash(false);
        setEditParchiPrior({});
        setIsAdvance(false);
        if (!opts?.keepCrossPartyParties) {
            setSelectedAccount("");
            setReceivingPartyCode("");
        }
        refreshNextVoucherId();
    };

    const swapParties = () => {
        const prevPaying = selectedAccount;
        setSelectedAccount(receivingPartyCode);
        setReceivingPartyCode(prevPaying);
    };

    const applyParchiClearanceDemo = (allocations: { parchiNo: string; amount: number }[]) => {
        setParchiData((prev) =>
            prev.map((p) => {
                const alloc = allocations.find((a) => a.parchiNo === p.parchi_id);
                if (!alloc) return p;
                const newCleared = p.cleared_amount + alloc.amount;
                const newAvail = Math.max(0, p.total_amount - newCleared);
                return {
                    ...p,
                    cleared_amount: newCleared,
                    available_balance: newAvail,
                    status: newAvail <= 0 ? "Cleared" : "Partially Cleared",
                };
            }),
        );
    };

    const loadRowForEdit = async (row: CashbookLedgerRow) => {
        setEditingId(row.id);
        setEditingDbId(row.dbId ?? null);
        setAmount(String(row.amount ?? (row.debit > 0 ? row.debit : row.credit)));
        setDate(row.date);
        setPageNo(row.pageNo || "1");

        const isCrv = row.voucherType === "CRV" || row.voucherType === "PARCHI_CLEAR";
        setActionType(isCrv ? "CRV" : "CPV");

        const isCrossSettle =
            row.entryKind === "party_settlement" ||
            row.mode === "Cross-Party" ||
            row.virtualLeg != null ||
            row.voucherType === "CROSS_SETTLE";
        if (isCrossSettle) {
            setEntryMode("cross_party");
            setSelectedAccount(row.partyCode ?? "");
            setReceivingPartyCode(row.counterPartyCode ?? "");
            setClearanceMode("Cash");
            setSelectedParchiId("");
            setAdditionalParchiIds([]);
            setApplyRemainderAsCash(false);
            setEditParchiPrior({});
            let hasParchi = false;
            if (liveMode && row.dbId) {
                const linked = await fetchParchiClearancesForPayment(row.dbId);
                if (linked.length > 0) {
                    hasParchi = true;
                    setClearanceMode("Clear Parchi");
                    const prior: Record<string, number> = {};
                    for (const c of linked) prior[c.parchiNo] = c.amount;
                    setEditParchiPrior(prior);
                    setSelectedParchiId(linked[0]?.parchiNo ?? "");
                    setAdditionalParchiIds(linked.slice(1).map((c) => c.parchiNo));
                    const parchiTotal = linked.reduce((s, c) => s + c.amount, 0);
                    const paymentTotal = row.amount ?? (row.debit > 0 ? row.debit : row.credit);
                    if (paymentTotal > parchiTotal + 0.001) {
                        setApplyRemainderAsCash(true);
                    }
                }
            }
            let userDesc = row.sourceRemarks ?? "";
            if (hasParchi) {
                const note = userDesc.replace(/^Parchi clearance —[^.]+\.\s*/i, "").trim();
                userDesc = note && !note.startsWith("Parchi ") ? note : "";
            }
            setDesc(userDesc);
        } else if (row.voucherType === "PARCHI_CLEAR" || row.mode === "Clear Parchi") {
            setEntryMode("standard");
            setClearanceMode("Clear Parchi");
            setSelectedAccount(row.partyCode ?? "");
            setAdditionalParchiIds([]);
            setApplyRemainderAsCash(false);
            setEditParchiPrior({});
            let parchiNo = "";
            const match = row.desc.match(/(P-[^\s:;]+)/);
            if (match) parchiNo = match[1] || "";
            if (liveMode && row.dbId) {
                const linked = await fetchParchiClearancesForPayment(row.dbId);
                const prior: Record<string, number> = {};
                for (const c of linked) prior[c.parchiNo] = c.amount;
                setEditParchiPrior(prior);
                if (linked[0]?.parchiNo) {
                    parchiNo = linked[0].parchiNo;
                    setAdditionalParchiIds(linked.slice(1).map((c) => c.parchiNo));
                }
                const parchiTotal = linked.reduce((s, c) => s + c.amount, 0);
                const paymentTotal = row.debit > 0 ? row.debit : row.credit;
                if (paymentTotal > parchiTotal + 0.001) {
                    setApplyRemainderAsCash(true);
                }
            }
            setSelectedParchiId(parchiNo);
            const userNote = row.desc.replace(/^Parchi clearance —[^.]+\.\s*/i, "").trim();
            setDesc(userNote && !userNote.startsWith("Parchi ") ? userNote : "");
        } else {
            setEntryMode("standard");
            setClearanceMode("Cash");
            setReceivingPartyCode("");
            setSelectedAccount(row.counterAccountCode ?? row.partyCode ?? "");
            setSelectedParchiId("");
            setDesc(row.sourceRemarks ?? "");
        }

        formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const handleSave = async () => {
        if (!isReadyToSave()) {
            toast({
                title: "Cannot save entry",
                description: "Complete the required fields (amount, account, party, and remarks) before saving.",
                variant: "destructive",
            });
            return;
        }

        if (liveMode && (actionType === "CRV" || actionType === "CPV" || entryMode === "cross_party")) {
            const paymentNo = editingRow?.sourcePaymentNo ?? voucherId;
            const wasEdit = Boolean(editingDbId);
            const isCrossParty = entryMode === "cross_party";
            const isClearParchi = clearanceMode === "Clear Parchi" && (isCrossParty || actionType === "CRV");
            let paymentRemarks = desc;
            let parchiAllocations: { parchiNo: string; amount: number }[] = [];

            if (isClearParchi) {
                const plan = computeParchiClearancePlan({
                    totalAmount: receiptAmount,
                    primaryParchiId: selectedParchiId,
                    additionalParchiIds,
                    partyParchis: partyParchisForAccount,
                    priorByParchiNo: editingId ? editParchiPrior : undefined,
                    userNote: desc,
                    allowCashRemainder: applyRemainderAsCash,
                    cashRemainderLabel: isCrossParty ? "On account" : undefined,
                });
                if (!plan.ok) {
                    toast({ title: "Cannot clear parchi", description: plan.error, variant: "destructive" });
                    return;
                }
                paymentRemarks = plan.remarks;
                parchiAllocations = plan.allocations;
            }

            const isParty = isClearParchi || isPartyAccountSelection(selectedAccount, parties);
            const paymentType = actionType === "CRV" ? "receipt" : "payment";
            const parchiClearances = isClearParchi
                ? parchiAllocations
                      .map((alloc) => {
                          const row = parchiData.find((p) => p.parchi_id === alloc.parchiNo);
                          return row?.dbId ? { parchiId: row.dbId, amount: alloc.amount } : null;
                      })
                      .filter((x): x is { parchiId: string; amount: number } => x !== null)
                : undefined;

            const result = await saveAndPostPayment({
                replacePaymentId: editingDbId ?? undefined,
                paymentNo,
                paymentType: isCrossParty ? "adjustment" : actionType === "CRV" ? "receipt" : "payment",
                paymentDate: date,
                partyCode: isCrossParty ? selectedAccount : isParty ? selectedAccount : undefined,
                counterPartyCode: isCrossParty ? receivingPartyCode : undefined,
                amount: receiptAmount,
                counterAccountCode: !isCrossParty && !isParty ? selectedAccount : undefined,
                entryKind: isCrossParty ? "party_settlement" : undefined,
                voucherSubtype: isCrossParty ? "CROSS_SETTLE" : isClearParchi ? "PARCHI_CLEAR" : actionType,
                pageNo,
                remarks: paymentRemarks,
                isAdvance: !isCrossParty && isParty && !isClearParchi ? isAdvance : false,
                parchiClearances,
            });
            if (!result.ok) {
                toast({ title: "Payment save failed", description: result.error, variant: "destructive" });
                return;
            }

            const parchiRowsFromRpc = (result.data.parchiRows ?? []) as Array<{
                parchi_no?: string;
                cleared_amount?: number;
                open_amount?: number;
                status?: string;
            }>;
            if (parchiRowsFromRpc.length > 0) {
                setParchiData((prev) =>
                    prev.map((p) => {
                        const updated = parchiRowsFromRpc.find((r) => r.parchi_no === p.parchi_id);
                        if (!updated) return p;
                        const open = Number(updated.open_amount ?? 0);
                        return {
                            ...p,
                            cleared_amount: Number(updated.cleared_amount ?? 0),
                            available_balance: open,
                            status:
                                updated.status === "cleared"
                                    ? "Cleared"
                                    : updated.status === "partial"
                                      ? "Partially Cleared"
                                      : "Pending",
                        };
                    }),
                );
            }

            await Promise.all([
                refreshPayments(),
                isClearParchi
                    ? fetchParchis().then((rows) => {
                          setParchiData(
                              rows.map((p: any) => ({
                                  parchi_id: p.parchi_no,
                                  dbId: p.id,
                                  party_id: p.parties?.code ?? "",
                                  party_name: p.parties?.name ?? "",
                                  total_amount: Number(p.total_amount),
                                  cleared_amount: Number(p.cleared_amount),
                                  available_balance: Number(p.open_amount),
                                  status:
                                      p.status === "cleared"
                                          ? "Cleared"
                                          : p.status === "partial"
                                            ? "Partially Cleared"
                                            : "Pending",
                              })),
                          );
                      })
                    : Promise.resolve(),
            ]);

            resetEntryForm(isCrossParty ? { keepCrossPartyParties: true } : undefined);
            toast({
                title: wasEdit ? "Entry updated" : "Entry recorded",
                description: isCrossParty
                    ? `${paymentNo} cross-party settlement posted.`
                    : `${paymentNo} posted to cashbook.`,
            });
            focusAfterPost(isCrossParty ? "cross_party" : "standard");
            return;
        }

        let newDebit = 0;
        let newCredit = 0;
        const isCrossPartyDemo = entryMode === "cross_party";

        if (!isCrossPartyDemo) {
            if (actionType === "CRV") newDebit = receiptAmount;
            if (actionType === "CPV") newCredit = receiptAmount;
        }

        const isParty = isCrossPartyDemo || isPartyAccountSelection(selectedAccount, parties);
        const counterDisplay = isCrossPartyDemo
            ? `${resolvePartyName(selectedAccount)} → ${resolvePartyName(receivingPartyCode)}`
            : (accountOptions.find((a) => a.id === selectedAccount)?.name ??
              (liveMode ? resolvePartyName(selectedAccount) : selectedAccount));

        let ledgerDesc = desc;
        let demoParchiAllocations: { parchiNo: string; amount: number }[] = [];
        if (clearanceMode === "Clear Parchi" && selectedParchiId) {
            const plan = computeParchiClearancePlan({
                totalAmount: receiptAmount,
                primaryParchiId: selectedParchiId,
                additionalParchiIds,
                partyParchis: partyParchisForAccount,
                priorByParchiNo: editingId ? editParchiPrior : undefined,
                userNote: desc,
                allowCashRemainder: applyRemainderAsCash,
                cashRemainderLabel: isCrossPartyDemo ? "On account" : undefined,
            });
            if (!plan.ok) {
                toast({ title: "Cannot clear parchi", description: plan.error, variant: "destructive" });
                return;
            }
            ledgerDesc = plan.remarks;
            demoParchiAllocations = plan.allocations;
        }

        const newLedgerEntry = {
            id: editingId || voucherId,
            pageNo: pageNo,
            date: date,
            account: counterDisplay,
            partyCode: isCrossPartyDemo || isParty ? selectedAccount : undefined,
            counterPartyCode: isCrossPartyDemo ? receivingPartyCode : undefined,
            entryKind: isCrossPartyDemo
                ? "party_settlement"
                : resolveCashbookEntryKind(actionType === "CRV" ? "receipt" : "payment", isParty),
            counterAccountCode: !isCrossPartyDemo && !isParty ? selectedAccount : undefined,
            voucherType: isCrossPartyDemo ? "CROSS_SETTLE" : actionType,
            mode: isCrossPartyDemo ? "Cross-Party" : clearanceMode,
            desc: ledgerDesc,
            debit: newDebit,
            credit: newCredit,
            balance: 0,
        };

        if (editingId) {
            setLedgerData((prev) =>
                withRegisterOpening(
                    prev.map((r) => (r.id === editingId ? newLedgerEntry : r)),
                    prev,
                ),
            );
            setEditingId(null);
        } else {
            setLedgerData((prev) => withRegisterOpening([...prev, newLedgerEntry], prev));
            refreshNextVoucherId();
        }

        if (clearanceMode === "Clear Parchi" && demoParchiAllocations.length > 0) {
            if (editingId) {
                const prior = editParchiPrior;
                setParchiData((prev) =>
                    prev.map((p) => {
                        const was = prior[p.parchi_id] ?? 0;
                        if (was <= 0) return p;
                        const newCleared = Math.max(0, p.cleared_amount - was);
                        const newAvail = p.total_amount - newCleared;
                        return {
                            ...p,
                            cleared_amount: newCleared,
                            available_balance: newAvail,
                            status: newAvail <= 0 ? "Cleared" : "Partially Cleared",
                        };
                    }),
                );
            }
            applyParchiClearanceDemo(demoParchiAllocations);
        }

        resetEntryForm(isCrossPartyDemo ? { keepCrossPartyParties: true } : undefined);
        focusAfterPost(isCrossPartyDemo ? "cross_party" : "standard");
    };

    const handleDelete = async () => {
        if (!editingId) return;
        if (liveMode) {
            if (editingDbId) {
                const paymentNo = editingRow?.sourcePaymentNo ?? editingId;
                if (
                    !window.confirm(
                        `Void cashbook entry ${paymentNo}? This reverses the journal and removes it from the register.`,
                    )
                ) {
                    return;
                }
                const result = await deletePaymentDocument(editingDbId);
                if (!result.ok) {
                    toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                    return;
                }
                setLedgerData((prev) =>
                    withRegisterOpening(
                        prev.filter((row) => row.dbId !== editingDbId),
                        prev,
                    ),
                );
                const [, parchiRows] = await Promise.all([refreshPayments(), fetchParchis()]);
                setParchiData(
                    parchiRows.map((p: any) => ({
                        parchi_id: p.parchi_no,
                        dbId: p.id,
                        party_id: p.parties?.code ?? "",
                        party_name: p.parties?.name ?? "",
                        total_amount: Number(p.total_amount),
                        cleared_amount: Number(p.cleared_amount),
                        available_balance: Number(p.open_amount),
                        status: p.status === "cleared" ? "Cleared" : p.status === "partial" ? "Partially Cleared" : "Pending",
                    }))
                );
                toast({
                    title: "Entry voided",
                    description: `${paymentNo} reversed and removed from cashbook.`,
                });
            }
        } else {
            setLedgerData((prev) =>
                withRegisterOpening(
                    prev.filter((r) => r.id !== editingId),
                    prev,
                ),
            );
        }
        resetEntryForm();
    };

    const parchiOpen = parchiData.reduce((acc, curr) => acc + curr.available_balance, 0);

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-[1400px] mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Cashbook</h1>
                        <p className="text-slate-500 mt-1 text-sm">
                            Record receipts and payments · clear parchi from receipts
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-lg border-zinc-200 shadow-soft"
                            onClick={() => setSettleAdvancesOpen(true)}
                        >
                            Settle advances
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-lg border-zinc-200 shadow-soft" asChild>
                            <Link to="/parchis">
                                Parchi register
                                <ArrowUpRight className="h-3.5 w-3.5 ml-1.5" />
                            </Link>
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <KpiCard
                        label="Cash in hand"
                        value={formatPkr(cashInHandBalance)}
                        sub={cashInHandSub}
                        icon={Wallet}
                        iconTone="bg-slate-100 text-black"
                    />
                    <KpiCard
                        label="Bank (GL)"
                        value={formatPkr(bankBalance)}
                        sub="Bank accounts only (11111–11114)"
                        icon={History}
                        iconTone="bg-slate-100 text-black"
                    />
                    <KpiCard
                        label="Parchi open"
                        value={formatPkr(parchiOpen)}
                        sub="Uncleared commitments"
                        icon={FileText}
                        iconTone="bg-slate-100 text-black"
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-5 lg:gap-6 items-start">
                    <div className="w-full lg:sticky lg:top-4 self-start">
                        <CashbookEntryForm
                    ref={formCardRef}
                    editingId={editingId}
                    voucherId={voucherId}
                    pageNo={pageNo}
                    date={date}
                    entryMode={entryMode}
                    actionType={actionType}
                    clearanceMode={clearanceMode}
                    selectedAccount={selectedAccount}
                    receivingPartyCode={receivingPartyCode}
                    amount={amount}
                    desc={desc}
                    accountOpen={accountOpen}
                    receivingPartyOpen={receivingPartyOpen}
                    onAccountOpenChange={setAccountOpen}
                    onReceivingPartyOpenChange={setReceivingPartyOpen}
                    accountOptions={accountOptions}
                    coaNameMap={coaNameMap}
                    liveMode={liveMode}
                    selectedIsParty={selectedIsParty}
                    resolvePartyName={resolvePartyName}
                    receiptAmount={receiptAmount}
                    currentBalance={allEntriesClosingBalance}
                    selectedParchiId={selectedParchiId}
                    additionalParchiIds={additionalParchiIds}
                    applyRemainderAsCash={applyRemainderAsCash}
                    additionalParchiOptions={additionalParchiOptions}
                    partyParchisForAccount={partyParchisForAccount}
                    selectedParchi={selectedParchi}
                    parchiClearancePlan={parchiClearancePlan}
                    isReadyToSave={isReadyToSave()}
                    onDateChange={setDate}
                    onPageNoChange={setPageNo}
                    onEntryModeChange={(v) => {
                        setEntryMode(v);
                        if (v === "standard") {
                            setReceivingPartyCode("");
                        }
                        setClearanceMode("Cash");
                        setSelectedParchiId("");
                        setAdditionalParchiIds([]);
                        setApplyRemainderAsCash(false);
                        setIsAdvance(false);
                    }}
                    onActionTypeChange={(v) => {
                        setActionType(v);
                        setClearanceMode("Cash");
                        setSelectedParchiId("");
                        setAdditionalParchiIds([]);
                        setApplyRemainderAsCash(false);
                        setIsAdvance(false);
                    }}
                    onClearanceModeChange={(v) => {
                        setClearanceMode(v);
                        if (v === "Clear Parchi") setIsAdvance(false);
                    }}
                    onSelectedAccountChange={(v) => {
                        setSelectedAccount(v);
                        setSelectedParchiId("");
                        setAdditionalParchiIds([]);
                        setApplyRemainderAsCash(false);
                    }}
                    onReceivingPartyCodeChange={setReceivingPartyCode}
                    onSwapParties={swapParties}
                    onAmountChange={setAmount}
                    onDescChange={setDesc}
                    onSelectedParchiIdChange={(v) => {
                        setSelectedParchiId(v);
                        setAdditionalParchiIds([]);
                        setApplyRemainderAsCash(false);
                    }}
                    onAdditionalParchiIdsChange={setAdditionalParchiIds}
                    onApplyRemainderAsCashChange={setApplyRemainderAsCash}
                    isAdvance={isAdvance}
                    onIsAdvanceChange={setIsAdvance}
                    onSave={() => void handleSave()}
                    onDelete={() => void handleDelete()}
                    onReset={() => resetEntryForm()}
                    accountBtnRef={accountBtnRef}
                    amountInputRef={amountInputRef}
                        />
                    </div>

                    <div className="min-w-0 flex flex-col min-h-[360px] lg:min-h-[calc(100vh-13rem)]">
                        <CashbookLedger
                            rows={filteredLedger}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            openingBalance={openingBalance}
                            closingBalance={closingBalance}
                            received={dayFlow.received}
                            paid={dayFlow.paid}
                            onEditRow={(row) => void loadRowForEdit(row)}
                            ledgerDate={date}
                            pageNo={pageNo}
                            viewMode={ledgerViewMode}
                            onViewModeChange={setLedgerViewMode}
                            highlightVoucherId={editingId}
                            isLoading={ledgerLoading}
                            error={ledgerError}
                            onRetry={() => void refreshPayments()}
                        />
                    </div>
                </div>

            </div>
            <SettleAdvancesModal
                open={settleAdvancesOpen}
                onOpenChange={setSettleAdvancesOpen}
                parties={parties.map((p) => ({ id: p.id, code: p.id, name: p.name }))}
            />
        </DashboardLayout>
    );
}
