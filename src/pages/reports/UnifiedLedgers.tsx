import DashboardLayout from "@/components/layout/DashboardLayout";
import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportPrintButton, ReportPrintDocument, ReportMetaStrip } from "@/components/reports/ReportPrintPage";
import { PartyScrapCreditsTable } from "@/components/reports/PartyScrapCreditsTable";
import { LedgerFiltersPanel } from "@/components/reports/unified-ledgers/LedgerFiltersPanel";
import { FinancialLedgerPanel } from "@/components/reports/unified-ledgers/FinancialLedgerPanel";
import { MetalLedgerPanel } from "@/components/reports/unified-ledgers/MetalLedgerPanel";
import { ScrapExpectationsPanel } from "@/components/reports/unified-ledgers/ScrapExpectationsPanel";
import {
    LEDGER_TABS,
    LEDGER_TAB_CONTEXT,
    MOCK_ACCOUNTS,
    MOCK_FINANCIAL_TRANSACTIONS,
    MOCK_METAL_TRANSACTIONS,
    MOCK_PARCHIS,
    type AccountTypeFilter,
    type FinancialLedgerDisplayRow,
    type LedgerAccountOption,
    type LedgerAccountTab,
    type MetalLedgerDisplayRow,
    type UnifiedLedgersPanelProps,
} from "@/components/reports/unified-ledgers/types";
import {
    compareFinancialLedgerRows,
    isFinancialOpeningRow,
    mapFinancialLedgerRow,
    openingBalanceSeed,
    parseParchiParam,
} from "@/components/reports/unified-ledgers/ledgerRowMappers";

const AssistantPanel = lazy(() =>
    import("@/components/assistant/AssistantPanel").then((m) => ({ default: m.AssistantPanel })),
);
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAppSession } from "@/contexts/AppSessionContext";
import { getParties, initPartyCatalog } from "@/lib/partyCatalog";
import { enrichLedgerRowsWithAttribution } from "@/lib/repositories/auditRepo";
import {
    fetchAccountLedger,
    fetchPartyLedger,
    fetchPartyMetalLedger,
    fetchPartyScrapExpectations,
    fetchPartyScrapCredits,
    fetchParchis,
    fetchPostableCoaAccounts,
} from "@/lib/repositories/reportsRepo";
import type { PartyScrapCreditRow, PartyScrapExpectationRow } from "@/lib/scrapObligationTypes";
import { queryClient, queryKeys, staleTimes } from "@/lib/queryClient";
import { isErpLiveMode } from "@/lib/backendFlags";
import { filterCoaForContext, inferLedgerTab, toCoaPickerOptions, type CoaSelectContext } from "@/lib/coaSelectors";
import type { DbCoaRow } from "@/lib/api/masters";
import { toast } from "sonner";
import { ParchiLedgerSection } from "@/components/reports/ParchiLedgerSection";

export function UnifiedLedgersPanel({
    embedded = false,
    initialPartyCode,
    initialShowParchi,
    allowedAccountTabs,
}: UnifiedLedgersPanelProps) {
    const [searchParams] = useSearchParams();
    const { canViewAuditAttribution } = useAppSession();
    const partyFromUrl = initialPartyCode ?? searchParams.get("party") ?? "";
    const parchiFromUrl = initialShowParchi ?? parseParchiParam(searchParams.get("parchi"));
    const [dateFrom, setDateFrom] = useState(() => {
        const d = new Date();
        d.setDate(1); // 1st of current month
        return d.toISOString().split('T')[0];
    });
    const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
    const [accountType, setAccountType] = useState<AccountTypeFilter>("All");
    const [selectedAccountId, setSelectedAccountId] = useState("Select");
    const [accountPickerOpen, setAccountPickerOpen] = useState(false);
    const [ledgerViewMode, setLedgerViewMode] = useState("Financial"); // Both, Financial, Material
    const [isFiltering, setIsFiltering] = useState(false);
    const [partyLedgerRows, setPartyLedgerRows] = useState<any[]>([]);
    const [accountLedgerRows, setAccountLedgerRows] = useState<any[]>([]);
    const [metalLedgerRows, setMetalLedgerRows] = useState<any[]>([]);
    const [scrapExpectationRows, setScrapExpectationRows] = useState<PartyScrapExpectationRow[]>([]);
    const [scrapCreditRows, setScrapCreditRows] = useState<PartyScrapCreditRow[]>([]);
    const [metalViewMode, setMetalViewMode] = useState<"detail" | "summary">("detail");
    const [coaAccounts, setCoaAccounts] = useState<Record<string, { id: string; name: string }[]>>({});
    const [postableCoaRows, setPostableCoaRows] = useState<DbCoaRow[]>([]);
    const [openParchis, setOpenParchis] = useState<any[]>([]);
    const [showParchiInfo, setShowParchiInfo] = useState(parchiFromUrl);
    const [askOpen, setAskOpen] = useState(false);
    const finScrollRef = useRef<HTMLDivElement>(null);
    const metalScrollRef = useRef<HTMLDivElement>(null);
    const useMock = !isErpLiveMode();

    const permittedTabs = useMemo((): LedgerAccountTab[] => {
        if (!allowedAccountTabs?.length) return [...LEDGER_TABS];
        return LEDGER_TABS.filter((t) => (allowedAccountTabs as readonly string[]).includes(t));
    }, [allowedAccountTabs]);

    const isTabPermitted = useCallback(
        (tab: LedgerAccountTab) => permittedTabs.includes(tab),
        [permittedTabs],
    );

    useEffect(() => {
        if (!allowedAccountTabs?.length) return;
        if (accountType !== "All" && !isTabPermitted(accountType as LedgerAccountTab)) {
            setAccountType(permittedTabs[0] ?? "Party");
            setSelectedAccountId("Select");
        }
    }, [allowedAccountTabs, accountType, isTabPermitted, permittedTabs]);

    // forceRefresh is set when the operator explicitly presses Filter, so a manual
    // refresh always bypasses the cache and re-reads the ledger.
    const runFilter = useCallback(async (
        accountId: string,
        acctType: AccountTypeFilter,
        includeParchi: boolean,
        forceRefresh = false,
    ) => {
        const ledgerStaleTime = forceRefresh ? 0 : staleTimes.partyLedger;
        setIsFiltering(true);
        try {
            const isParty =
                accountId !== "Select" &&
                (acctType === "Party" ||
                    (acctType === "All" && getParties().some((p) => p.id === accountId)));

            if (isParty) {
                const { live, metal, scrapExpectations, scrapCredits, parchis } = await queryClient.fetchQuery({
                    queryKey: queryKeys.unifiedPartyLedger(
                        accountId,
                        dateFrom,
                        dateTo,
                        includeParchi,
                        canViewAuditAttribution,
                    ),
                    staleTime: ledgerStaleTime,
                    queryFn: async () => {
                        const [liveRaw, metalRows, expectations, credits, parchiRows] = await Promise.all([
                            fetchPartyLedger(accountId, dateFrom, dateTo),
                            fetchPartyMetalLedger(accountId, dateFrom, dateTo),
                            isErpLiveMode()
                                ? fetchPartyScrapExpectations(accountId, undefined, undefined, true)
                                : Promise.resolve([] as PartyScrapExpectationRow[]),
                            isErpLiveMode()
                                ? fetchPartyScrapCredits(accountId, true)
                                : Promise.resolve([] as PartyScrapCreditRow[]),
                            isErpLiveMode() && includeParchi
                                ? fetchParchis({ partyCode: accountId })
                                : Promise.resolve([]),
                        ]);
                        return {
                            live: canViewAuditAttribution
                                ? await enrichLedgerRowsWithAttribution(liveRaw)
                                : liveRaw,
                            metal: metalRows,
                            scrapExpectations: expectations,
                            scrapCredits: credits,
                            parchis: parchiRows,
                        };
                    },
                });

                setPartyLedgerRows(live);
                setMetalLedgerRows(metal);
                setScrapExpectationRows(scrapExpectations);
                setScrapCreditRows(scrapCredits);
                setAccountLedgerRows([]);
                setOpenParchis(
                    includeParchi
                        ? useMock
                            ? (MOCK_PARCHIS[accountId] ?? [])
                            : parchis.filter((p: { status?: string }) => p.status !== "void")
                        : [],
                );
            } else if (!useMock && accountId !== "Select") {
                const rows = await queryClient.fetchQuery({
                    queryKey: queryKeys.unifiedAccountLedger(accountId, dateFrom, dateTo, canViewAuditAttribution),
                    staleTime: ledgerStaleTime,
                    queryFn: async () => {
                        const raw = await fetchAccountLedger(accountId, dateFrom, dateTo);
                        return canViewAuditAttribution ? await enrichLedgerRowsWithAttribution(raw) : raw;
                    },
                });
                setAccountLedgerRows(rows);
                setPartyLedgerRows([]);
                setMetalLedgerRows([]);
                setScrapExpectationRows([]);
                setScrapCreditRows([]);
                setOpenParchis([]);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load ledger";
            toast.error(message);
            setPartyLedgerRows([]);
            setAccountLedgerRows([]);
            setMetalLedgerRows([]);
            setScrapExpectationRows([]);
            setScrapCreditRows([]);
        } finally {
            setIsFiltering(false);
        }
    }, [dateFrom, dateTo, useMock, canViewAuditAttribution]);

    useEffect(() => {
        setShowParchiInfo(parchiFromUrl);
    }, [parchiFromUrl]);

    useEffect(() => {
        void initPartyCatalog().then(() => {
            if (!partyFromUrl) return;
            setAccountType("Party");
            setSelectedAccountId(partyFromUrl);
        });
        if (!isErpLiveMode()) return;
        void (async () => {
            const allPostable = (await queryClient.fetchQuery({
                queryKey: queryKeys.postableCoa("ledger_all"),
                queryFn: () => fetchPostableCoaAccounts("ledger_all"),
                staleTime: staleTimes.coa,
            })) as DbCoaRow[];
            setPostableCoaRows(allPostable);
            const next: Record<string, { id: string; name: string }[]> = {};
            for (const tab of permittedTabs) {
                if (tab === "Party") continue;
                const ctx = LEDGER_TAB_CONTEXT[tab];
                if (!ctx) continue;
                next[tab] = toCoaPickerOptions(filterCoaForContext(allPostable, ctx));
            }
            setCoaAccounts(next);
        })();
    }, [partyFromUrl, permittedTabs]);

    useEffect(() => {
        if (accountType !== "Party" || selectedAccountId === "Select" || !partyFromUrl) return;
        if (selectedAccountId !== partyFromUrl) return;
        void runFilter(selectedAccountId, accountType, showParchiInfo);
    }, [accountType, selectedAccountId, partyFromUrl, showParchiInfo, runFilter]);

    const dynamicAccounts = useMemo((): Record<LedgerAccountTab, { id: string; name: string }[]> => ({
        Party: getParties().map((p) => ({ id: p.id, name: p.name })),
        "Cash & Bank": coaAccounts["Cash & Bank"]?.length ? coaAccounts["Cash & Bank"] : MOCK_ACCOUNTS["Cash & Bank"],
        Revenue: coaAccounts.Revenue?.length ? coaAccounts.Revenue : MOCK_ACCOUNTS.Revenue,
        Expenses: coaAccounts.Expenses?.length ? coaAccounts.Expenses : MOCK_ACCOUNTS.Expenses,
        Liabilities: coaAccounts.Liabilities?.length ? coaAccounts.Liabilities : MOCK_ACCOUNTS.Liabilities,
        Equity: coaAccounts.Equity?.length ? coaAccounts.Equity : MOCK_ACCOUNTS.Equity,
        "Inventory & Assets": coaAccounts["Inventory & Assets"]?.length
            ? coaAccounts["Inventory & Assets"]
            : MOCK_ACCOUNTS["Inventory & Assets"],
    }), [coaAccounts]);

    const allAccounts = useMemo((): LedgerAccountOption[] => {
        const out: LedgerAccountOption[] = [];
        for (const acc of dynamicAccounts.Party) {
            out.push({ ...acc, kind: "party", tab: "Party" });
        }
        if (postableCoaRows.length) {
            for (const row of postableCoaRows) {
                const tab = inferLedgerTab(row);
                if (!isTabPermitted(tab)) continue;
                out.push({
                    id: row.code,
                    name: `[${row.code}] ${row.name}`,
                    kind: "gl",
                    tab,
                });
            }
        } else {
            for (const tab of permittedTabs) {
                if (tab === "Party") continue;
                for (const acc of dynamicAccounts[tab]) {
                    out.push({ ...acc, kind: "gl", tab });
                }
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }, [dynamicAccounts, postableCoaRows, permittedTabs, isTabPermitted]);

    const availableAccounts: LedgerAccountOption[] =
        accountType === "All"
            ? allAccounts
            : dynamicAccounts[accountType].map((acc) => ({
                  ...acc,
                  kind: accountType === "Party" ? ("party" as const) : ("gl" as const),
                  tab: accountType,
              }));

    const selectedAccountMeta = availableAccounts.find((a) => a.id === selectedAccountId);

    const selectedIsParty =
        accountType === "Party" || (accountType === "All" && selectedAccountMeta?.kind === "party");

    const effectiveAccountType = useMemo((): AccountTypeFilter | "Select" => {
        if (accountType !== "All") return accountType;
        if (selectedAccountId === "Select") return "All";
        return selectedAccountMeta?.tab ?? "All";
    }, [accountType, selectedAccountId, selectedAccountMeta]);

    const handleFilter = async () => {
        await runFilter(selectedAccountId, accountType, showParchiInfo, true);
    };

    // Sort by posting date (RPC orders by posted_at wall-clock, which scrambles dates),
    // then recompute running balance so intermediate balances match the date order.
    const financialLedgerRows = useMemo((): FinancialLedgerDisplayRow[] => {
        let runningBalance = 0;
        const liveFiltered =
            selectedIsParty && partyLedgerRows.length
                ? partyLedgerRows.map((t, index) => mapFinancialLedgerRow(t, index))
                : !selectedIsParty && accountLedgerRows.length
                  ? accountLedgerRows.map((t, index) => mapFinancialLedgerRow(t, index))
                  : [];
        const filtered: FinancialLedgerDisplayRow[] = liveFiltered.length
            ? liveFiltered
            : useMock
              ? MOCK_FINANCIAL_TRANSACTIONS.filter(t => t.accId === selectedAccountId).map((t, index) => ({
                    id: `mock-${index}`,
                    date: t.date,
                    ref: t.ref,
                    desc: t.desc,
                    particulars: t.particulars,
                    weight: t.weight,
                    rate: t.rate,
                    debit: t.debit,
                    credit: t.credit,
                    isOpening: t.isOpening ?? false,
                    startingBal: t.startingBal ?? null,
                    runningBalance: t.startingBal ?? 0,
                    sortIndex: index,
                }))
              : [];

        const ordered = [...filtered].sort(compareFinancialLedgerRows);

        return ordered.map((t) => {
            // B/F has Dr/Cr = 0; prior closing lives only in running_balance / startingBal.
            if (isFinancialOpeningRow(t)) {
                runningBalance = openingBalanceSeed(t);
            } else {
                runningBalance = runningBalance + t.debit - t.credit;
            }
            return { ...t, runningBalance };
        });
    }, [selectedAccountId, isFiltering, partyLedgerRows, accountLedgerRows, selectedIsParty, useMock, dateFrom, dateTo]);

    const parchiLedgerSourceRows = useMemo((): Record<string, unknown>[] => {
        if (partyLedgerRows.length > 0) return partyLedgerRows;
        if (!useMock || !selectedIsParty || selectedAccountId === "Select") return [];
        const rows: Record<string, unknown>[] = [];
        for (const t of MOCK_FINANCIAL_TRANSACTIONS.filter((m) => m.accId === selectedAccountId)) {
            if (t.debit > 0 && t.ref.startsWith("SI")) {
                rows.push({
                    source_doc_type: "sales_invoice",
                    source_doc_id: t.id,
                    posting_date: t.date,
                    ref_no: t.ref,
                    debit_amount: t.debit,
                });
            } else if (t.credit > 0 && t.ref.startsWith("CV")) {
                rows.push({
                    source_doc_type: "payment",
                    posting_date: t.date,
                    ref_no: t.ref,
                    credit_amount: t.credit,
                });
            }
        }
        return rows;
    }, [partyLedgerRows, useMock, selectedIsParty, selectedAccountId]);

    const closingBalance =
        financialLedgerRows.length > 0
            ? financialLedgerRows[financialLedgerRows.length - 1].runningBalance
            : 0;

    const metalLedgerDisplay = useMemo(() => {
        let runningBalance = 0;
        const filtered = useMock
            ? [...MOCK_METAL_TRANSACTIONS.filter((t) => t.accId === selectedAccountId)].sort(
                  (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
              )
            : metalLedgerRows.map((t: any, index: number) => ({
                  id: `${t.posting_date}-${t.reference_no ?? t.source_doc_type}-${index}`,
                  date: t.posting_date,
                  ref: t.reference_no ?? t.source_doc_type ?? "—",
                  material:
                      t.source_doc_type === "party_opening"
                          ? "Opening metal entry"
                          : t.source_doc_type === "carry_forward"
                            ? "Balance b/f"
                            : t.item_name ?? t.source_doc_type ?? "Metal",
                  desc:
                      t.source_doc_type === "party_opening"
                          ? "Party opening metal"
                          : t.source_doc_type === "carry_forward"
                            ? "Balance brought forward"
                            : [t.description, t.size_spec].filter(Boolean).join(" · ") || t.source_doc_type,
                  weightIn: Number(t.weight_in ?? 0),
                  weightOut: Number(t.weight_out ?? 0),
                  sourceDocType: t.source_doc_type ?? null,
                  isOpening:
                      t.source_doc_type === "opening" ||
                      t.reference_no === "OPENING" ||
                      t.reference_no === "B/F",
                  runningKgFromBackend:
                      t.running_kg != null && t.running_kg !== "" ? Number(t.running_kg) : null,
              }));

        const ordered = useMock
            ? filtered
            : [...filtered].sort((a, b) => {
                  const rank = (r: (typeof filtered)[number]) => {
                      const sourceDocType =
                          (r as { sourceDocType?: string | null }).sourceDocType ?? null;
                      if (r.isOpening || sourceDocType === "opening") return 0;
                      if (sourceDocType === "carry_forward") return 1;
                      return 2;
                  };
                  const ra = rank(a);
                  const rb = rank(b);
                  if (ra !== rb) return ra - rb;
                  return String(a.date ?? "").localeCompare(String(b.date ?? ""));
              });

        return ordered.map((t) => {
            const mockOpening =
                useMock && t.isOpening && "startingBal" in t
                    ? Number((t as { startingBal?: number }).startingBal ?? NaN)
                    : NaN;
            if (!Number.isNaN(mockOpening)) {
                runningBalance = mockOpening;
            } else if (t.isOpening) {
                const backendKg =
                    "runningKgFromBackend" in t
                        ? (t as { runningKgFromBackend?: number | null }).runningKgFromBackend
                        : null;
                const fromBackend =
                    backendKg != null && !Number.isNaN(backendKg) ? backendKg : null;
                runningBalance = fromBackend ?? runningBalance + t.weightIn - t.weightOut;
            } else {
                runningBalance = runningBalance + t.weightIn - t.weightOut;
            }
            return { ...t, runningBalance };
        });
    }, [selectedAccountId, isFiltering, useMock, metalLedgerRows, dateFrom, dateTo, metalViewMode]);

    const metalLedgerRowsForDisplay = useMemo(() => {
        if (metalViewMode !== "summary" || useMock) return metalLedgerDisplay;

        const grouped = new Map<string, (typeof metalLedgerDisplay)[number]>();
        for (const row of metalLedgerDisplay) {
            if (row.isOpening) {
                grouped.set("__opening__", row);
                continue;
            }
            const sourceDocType = "sourceDocType" in row ? row.sourceDocType : null;
            const key = `${sourceDocType ?? "entry"}::${row.ref}`;
            const existing = grouped.get(key);
            const isInvoiceRow = sourceDocType === "sales_invoice" || sourceDocType === "purchase_invoice";
            const summaryLabel =
                sourceDocType === "party_opening"
                    ? `Opening entry · ${row.ref}`
                    : sourceDocType === "carry_forward"
                      ? `Balance brought forward · ${row.ref}`
                      : isInvoiceRow
                        ? `Invoice total · ${row.ref}`
                        : `Entry total · ${row.ref}`;
            if (!existing) {
                grouped.set(key, {
                    ...row,
                    material:
                        sourceDocType === "party_opening"
                            ? "Opening metal entry"
                            : sourceDocType === "carry_forward"
                              ? "Balance b/f"
                              : row.ref,
                    desc: summaryLabel,
                });
            } else {
                existing.weightIn += row.weightIn;
                existing.weightOut += row.weightOut;
                existing.runningBalance = row.runningBalance;
            }
        }
        return Array.from(grouped.values());
    }, [metalLedgerDisplay, metalViewMode, useMock]);

    const hasLedgerContent =
        financialLedgerRows.length > 0 ||
        metalLedgerDisplay.length > 0 ||
        scrapExpectationRows.length > 0 ||
        scrapCreditRows.length > 0 ||
        (showParchiInfo && openParchis.length > 0);

    const surfaceCard = embedded
        ? "shadow-soft border-slate-100"
        : "rounded-2xl border border-slate-200/70 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]";

    return (
            <div className="space-y-6">
                {!embedded && (
                <div className="print:hidden">
                    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:flex-row sm:items-end sm:justify-between" data-reveal>
                        <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                        <BookOpen className="h-8 w-8 text-blue-600" /> Unified Ledgers
                    </h1>
                            <p className="text-slate-500 mt-2">View PKR and metal transactions in one clean, printable statement.</p>
                </div>
                        <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Account Type</p>
                                <p className="font-semibold text-slate-800">{accountType}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Ledger View</p>
                                <p className="font-semibold text-slate-800">{ledgerViewMode}</p>
                            </div>
                        </div>
                    </div>
                </div>
                )}

                <LedgerFiltersPanel
                    surfaceCard={surfaceCard}
                    accountType={accountType}
                    onAccountTypeChange={setAccountType}
                    selectedAccountId={selectedAccountId}
                    onSelectedAccountIdChange={setSelectedAccountId}
                    accountPickerOpen={accountPickerOpen}
                    onAccountPickerOpenChange={setAccountPickerOpen}
                    selectedAccountMeta={selectedAccountMeta}
                    selectedIsParty={selectedIsParty}
                    ledgerViewMode={ledgerViewMode}
                    onLedgerViewModeChange={setLedgerViewMode}
                    showParchiInfo={showParchiInfo}
                    onShowParchiInfoChange={setShowParchiInfo}
                    onOpenParchisChange={setOpenParchis}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={setDateFrom}
                    onDateToChange={setDateTo}
                    onLoadLedger={() => void handleFilter()}
                    isFiltering={isFiltering}
                    permittedTabs={permittedTabs}
                    allowedAccountTabs={allowedAccountTabs}
                    availableAccounts={availableAccounts}
                />

                {selectedAccountId !== "Select" && !isFiltering && hasLedgerContent && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex justify-end gap-2 mb-4 erp-no-print">
                            {selectedIsParty ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => setAskOpen(true)}
                                >
                                    <Sparkles className="h-4 w-4 text-black" />
                                    Ask about this party
                            </Button>
                            ) : null}
                            <ReportPrintButton />
                        </div>
                        
                        <ReportPrintDocument
                            reportTitle={`${effectiveAccountType === "All" ? "Account" : effectiveAccountType} Ledger`}
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                                hierarchyLabel="Sub Accounts (Leaf)"
                            density="compact"
                        >

                            <ReportMetaStrip
                                left={{ label: "Account Title", value: selectedAccountMeta?.name ?? selectedAccountId }}
                                right={{ label: "Account ID", value: selectedAccountId }}
                            />

                            {selectedIsParty && scrapCreditRows.length > 0 && (
                                <PartyScrapCreditsTable rows={scrapCreditRows} />
                            )}

                            {selectedIsParty && <ScrapExpectationsPanel rows={scrapExpectationRows} />}

                            {selectedIsParty && (ledgerViewMode === "Both" || ledgerViewMode === "Material") && (
                                <MetalLedgerPanel
                                    rows={metalLedgerRowsForDisplay as MetalLedgerDisplayRow[]}
                                    metalViewMode={metalViewMode}
                                    onMetalViewModeChange={setMetalViewMode}
                                    scrollRef={metalScrollRef}
                                />
                            )}

                            {/* Financial Ledger Section */}
                            {(ledgerViewMode === "Both" || ledgerViewMode === "Financial" || !selectedIsParty) && (
                                <FinancialLedgerPanel
                                    rows={financialLedgerRows}
                                    effectiveAccountType={effectiveAccountType}
                                    canViewAuditAttribution={canViewAuditAttribution}
                                    scrollRef={finScrollRef}
                                />
                            )}

                            {selectedIsParty &&
                                showParchiInfo &&
                                financialLedgerRows.length > 0 &&
                                (ledgerViewMode === "Both" || ledgerViewMode === "Financial") && (
                                    <ParchiLedgerSection
                                        partyCode={selectedAccountId}
                                        partyName={selectedAccountMeta?.name ?? selectedAccountId}
                                        dateFrom={dateFrom}
                                        dateTo={dateTo}
                                        partyLedgerRows={parchiLedgerSourceRows}
                                        parchis={openParchis}
                                        closingBalance={closingBalance}
                                    />
                                )}

                        </ReportPrintDocument>
                    </div>
                )}
                
                {selectedAccountId !== "Select" && !isFiltering && !hasLedgerContent && (
                    <div className="p-12 text-center border-2 border-dashed rounded-lg text-slate-500">
                        <BookOpen className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                        <h2 className="text-xl font-semibold text-slate-700">No entries found.</h2>
                        <p className="text-slate-500 max-w-sm mx-auto mt-2">Try adjusting the date filters or check if this account has had recent activity.</p>
                    </div>
                )}

                <Sheet open={askOpen} onOpenChange={setAskOpen}>
                    <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
                        <SheetHeader>
                            <SheetTitle className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-black" />
                                Ask about this party
                            </SheetTitle>
                            <SheetDescription>
                                {selectedAccountMeta?.name ?? selectedAccountId} — balance, pending rates, and recent activity.
                            </SheetDescription>
                        </SheetHeader>
                        <div className="flex-1 overflow-hidden pt-4">
                            {askOpen ? (
                                <Suspense fallback={<div className="text-sm text-slate-500 p-4">Loading assistant…</div>}>
                                    <AssistantPanel
                                        compact
                                        context={{
                                            page: "unified-ledgers",
                                            party_code: selectedIsParty ? selectedAccountId : undefined,
                                        }}
                                    />
                                </Suspense>
                            ) : null}
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
    );
}

export default function UnifiedLedgers() {
    return (
        <DashboardLayout>
            <UnifiedLedgersPanel />
        </DashboardLayout>
    );
}
