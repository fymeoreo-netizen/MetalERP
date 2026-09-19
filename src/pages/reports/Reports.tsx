import DashboardLayout from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TabsScroller } from "@/components/ui/responsive-primitives";
import {
    ArrowLeft,
    BarChart3,
    BookOpen,
    ChevronRight,
    FileBarChart,
    Package,
    Search,
    ShoppingCart,
    TrendingUp,
    Users,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAppSession } from "@/contexts/AppSessionContext";
import { cn } from "@/lib/utils";
import { RouteFallback } from "@/components/shared/RouteFallback";
import { UnifiedLedgersPanel } from "./UnifiedLedgers";

const REPORT_LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
    pl: () => import("@/components/reports/ProfitLossReport"),
    bs: () => import("@/components/reports/BalanceSheetReport"),
    tb: () => import("@/components/reports/TrialBalanceReport"),
    te: () => import("@/components/reports/TrueExpenseReport"),
    "party-balance": () => import("@/components/reports/PartyBalanceReport"),
    parchi: () => import("@/components/reports/ParchiLedgerReport"),
    aging: () => import("@/components/reports/AgingReport"),
    "daily-prod": () => import("@/components/reports/DailyProductionReport"),
    scrap: () => import("@/components/reports/ScrapWastageReport"),
    "machine-prod": () => import("@/components/reports/MachineProductionReport"),
    "scrap-register": () => import("@/components/reports/ScrapTradeRegisterReport"),
    "stock-val": () => import("@/components/reports/StockValuationReport"),
    "pending-rate": () => import("@/components/reports/PendingRateRegisterReport"),
    "party-stock": () => import("@/components/reports/PartyStockMovementReport"),
    "sales-prod-tracker": () => import("@/components/reports/SalesProductionTrackerReport"),
    sales: () => import("@/components/reports/SalesReport"),
    "sales-return": () => import("@/components/reports/SalesReturnReport"),
    purchase: () => import("@/components/reports/PurchaseReport"),
    "purchase-return": () => import("@/components/reports/PurchaseReturnReport"),
    expenses: () => import("@/components/reports/ExpenseRegisterReport"),
};

const LazyReports = Object.fromEntries(
    Object.entries(REPORT_LOADERS).map(([id, loader]) => [id, lazy(loader)]),
) as Record<string, ReturnType<typeof lazy<ComponentType>>>;

function parseParchiParam(raw: string | null): boolean {
    if (!raw) return false;
    return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

type ReportDef = {
    id: string;
    label: string;
    hint: string;
};

type SectionDef = {
    id: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: "blue" | "emerald" | "purple" | "amber" | "rose";
    stripe: string;
    reports: ReportDef[];
};

const SECTIONS: SectionDef[] = [
    {
        id: "financials",
        label: "Financials",
        description: "P&L, balance sheet, trial balance",
        icon: TrendingUp,
        accent: "blue",
        stripe: "bg-blue-500",
        reports: [
            { id: "pl", label: "Profit & Loss", hint: "Revenue, COGS, and net result" },
            { id: "bs", label: "Balance Sheet", hint: "Assets, liabilities, and equity" },
            { id: "tb", label: "Trial Balance", hint: "All GL balances by account" },
            {
                id: "expenses",
                label: "Expense Register",
                hint: "Posted expenses by voucher — detail or account summary",
            },
        ],
    },
    {
        id: "unit-economics",
        label: "Unit Economics",
        description: "Per-kg cost and margin intelligence",
        icon: BarChart3,
        accent: "emerald",
        stripe: "bg-emerald-500",
        reports: [
            { id: "te", label: "True Expense (Per KG)", hint: "Factory cost per kilogram" },
        ],
    },
    {
        id: "sales-operations",
        label: "Sales & Operations",
        description: "Sales, production, and item tracking",
        icon: ShoppingCart,
        accent: "rose",
        stripe: "bg-rose-500",
        reports: [
            {
                id: "sales",
                label: "Sales Register",
                hint: "Posted sales by date with rates, totals, and avg rate (detail / summary)",
            },
            {
                id: "sales-return",
                label: "Sales Return Register",
                hint: "Posted sales returns with rates, totals, and avg rate",
            },
            {
                id: "purchase",
                label: "Purchase Register",
                hint: "Posted purchases by date with rates, totals, and avg rate",
            },
            {
                id: "purchase-return",
                label: "Purchase Return Register",
                hint: "Posted purchase returns with rates, totals, and avg rate",
            },
            {
                id: "sales-prod-tracker",
                label: "Sales / Production / Item Tracker",
                hint: "Sales by party/size, production by machine, item ledger with opening balance",
            },
        ],
    },
    {
        id: "party-liquidity",
        label: "Party & Liquidity",
        description: "Balances, parchi, and aging",
        icon: Users,
        accent: "purple",
        stripe: "bg-violet-500",
        reports: [
            { id: "party-balance", label: "Party Balance", hint: "Outstanding party balances" },
            { id: "parchi", label: "Parchi Ledger", hint: "Commitment register and clearance" },
            { id: "aging", label: "Aging", hint: "Customer and supplier aging" },
        ],
    },
    {
        id: "inventory-production",
        label: "Inventory & Production",
        description: "Production, scrap, and stock movement",
        icon: Package,
        accent: "amber",
        stripe: "bg-amber-500",
        reports: [
            { id: "daily-prod", label: "Daily Production", hint: "Posted production batches by date" },
            {
                id: "scrap",
                label: "Scrap & Wastage",
                hint: "Machine scrap %, vendor dispatches, broker trades",
            },
            { id: "machine-prod", label: "Machine Production", hint: "Input, output, and scrap by machine" },
            {
                id: "scrap-register",
                label: "Scrap Trade Register",
                hint: "Detail / summary with source & destination filters and avg rate",
            },
            { id: "stock-val", label: "Stock Valuation", hint: "Inventory value by category" },
            { id: "pending-rate", label: "Pending Rate Register", hint: "Open rate-pending lines awaiting fix" },
            { id: "party-stock", label: "Party Stock Movement", hint: "Metal in/out by party" },
        ],
    },
];

function findReportContext(reportId: string): { section: SectionDef; report: ReportDef } | null {
    for (const section of SECTIONS) {
        const report = section.reports.find((r) => r.id === reportId);
        if (report) return { section, report };
    }
    return null;
}

const ACCENT_ICON: Record<SectionDef["accent"], string> = {
    blue: "text-black",
    emerald: "text-black",
    purple: "text-black",
    amber: "text-black",
    rose: "text-black",
};

function SectionKpiCard({
    section,
    active,
    onClick,
}: {
    section: SectionDef;
    active: boolean;
    onClick: () => void;
}) {
    const Icon = section.icon;
    return (
        <button type="button" onClick={onClick} className="w-full text-left">
            <Card
                className={cn(
                    "shadow-soft border-slate-100 bg-white transition-shadow duration-200 hover:shadow-md hover:border-slate-200",
                    active && "ring-2 ring-slate-300 border-slate-200",
                )}
            >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{section.label}</CardTitle>
                    <Icon className={cn("h-4 w-4", ACCENT_ICON[section.accent])} />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-slate-900">
                        {section.reports.length} Report{section.reports.length !== 1 ? "s" : ""}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{section.description}</p>
                </CardContent>
            </Card>
        </button>
    );
}

function ReportBoxCard({
    report,
    section,
    onClick,
}: {
    report: ReportDef;
    section: SectionDef;
    onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick} className="w-full text-left">
            <Card className="shadow-soft border-slate-100 bg-white overflow-hidden flex flex-col h-full transition-shadow duration-200 hover:shadow-md hover:border-slate-200">
                <div className={cn("h-1 w-full", section.stripe)} />
                <CardHeader className="p-4 pb-2 border-b border-slate-50">
                    <div className="flex justify-between items-start gap-2">
                        <div className="font-semibold text-sm text-slate-900 leading-snug">{report.label}</div>
                        <Badge variant="outline" className="text-[10px] shrink-0 border-slate-200 bg-slate-50 text-slate-600">
                            {section.label.split(" ")[0]}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-4 flex-1">
                    <p className="text-xs text-slate-500 leading-relaxed">{report.hint}</p>
                </CardContent>
                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                    <span>Open report</span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
            </Card>
        </button>
    );
}

function ReportPicker({
    activeSection,
    onSectionChange,
    query,
    onQueryChange,
    onSelectReport,
}: {
    activeSection: string;
    onSectionChange: (sectionId: string) => void;
    query: string;
    onQueryChange: (value: string) => void;
    onSelectReport: (reportId: string, sectionId: string) => void;
}) {
    const currentSection = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];
    const q = query.trim().toLowerCase();

    const sectionReports = useMemo(() => {
        if (!q) return currentSection.reports;
        return currentSection.reports.filter(
            (r) => r.label.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q),
        );
    }, [currentSection, q]);

    const globalMatches = useMemo(() => {
        if (!q) return null;
        const matches: { section: SectionDef; report: ReportDef }[] = [];
        for (const section of SECTIONS) {
            for (const report of section.reports) {
                if (report.label.toLowerCase().includes(q) || report.hint.toLowerCase().includes(q)) {
                    matches.push({ section, report });
                }
            }
        }
        return matches;
    }, [q]);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {SECTIONS.map((section) => (
                    <SectionKpiCard
                        key={section.id}
                        section={section}
                        active={activeSection === section.id}
                        onClick={() => onSectionChange(section.id)}
                    />
                ))}
            </div>

            <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                <TabsScroller className="sm:flex-1">
                    <Tabs value={activeSection} onValueChange={onSectionChange}>
                        <TabsList className="bg-slate-100 p-1">
                            {SECTIONS.map((section) => (
                                <TabsTrigger
                                    key={section.id}
                                    value={section.id}
                                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
                                >
                                    <section.icon className="h-4 w-4 mr-2" />
                                    {section.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </TabsScroller>
                <div className="relative w-full sm:w-auto sm:min-w-[250px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        className="pl-9 w-full sm:w-[250px]"
                        placeholder="Search reports..."
                    />
                </div>
            </div>

            <Card className="shadow-soft border-slate-100">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">
                        {q ? "Search results" : currentSection.label}
                    </CardTitle>
                    <CardDescription>
                        {q
                            ? `${globalMatches?.length ?? 0} matching report${(globalMatches?.length ?? 0) !== 1 ? "s" : ""}`
                            : `${sectionReports.length} report${sectionReports.length !== 1 ? "s" : ""} in this category`}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {q ? (
                        globalMatches && globalMatches.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {globalMatches.map(({ section, report }) => (
                                    <ReportBoxCard
                                        key={report.id}
                                        report={report}
                                        section={section}
                                        onClick={() => onSelectReport(report.id, section.id)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="py-8 text-center text-slate-500 text-sm">
                                No reports match your search.
                            </div>
                        )
                    ) : sectionReports.length === 0 ? (
                        <div className="py-8 text-center text-slate-500 text-sm">
                            No reports in this category.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {sectionReports.map((report) => (
                                <ReportBoxCard
                                    key={report.id}
                                    report={report}
                                    section={currentSection}
                                    onClick={() => onSelectReport(report.id, currentSection.id)}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function Reports() {
    const { isAccountant } = useAppSession();
    const [searchParams] = useSearchParams();
    const [workspaceTab, setWorkspaceTab] = useState<"reports" | "ledgers">("reports");
    const [activeSection, setActiveSection] = useState("financials");
    const [activeReport, setActiveReport] = useState<string | null>(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
        const report = searchParams.get("report");
        if (!report) return;
        if (report === "unified-ledgers") {
            setWorkspaceTab("ledgers");
            return;
        }
        const legacyScrapReports = ["machine-scrap", "factory-dispatch"];
        const resolvedReport = legacyScrapReports.includes(report) ? "scrap" : report;
        const ctx = findReportContext(resolvedReport);
        if (ctx) {
            setWorkspaceTab("reports");
            setActiveSection(ctx.section.id);
            setActiveReport(ctx.report.id);
        }
    }, [searchParams]);

    const reportContext = activeReport ? findReportContext(activeReport) : null;
    const ActiveReport = activeReport ? LazyReports[activeReport] : null;

    const handleSelectReport = (reportId: string, sectionId: string) => {
        setActiveSection(sectionId);
        setActiveReport(reportId);
        setQuery("");
    };

    const handleBackToPicker = () => {
        setActiveReport(null);
    };

    if (isAccountant) {
        return <Navigate to="/ledgers" replace />;
    }

    return (
        <DashboardLayout>
            <div className="space-y-4 print:space-y-0">
                <div className="report-hub-header print:hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Reports</h1>
                        <p className="text-slate-500 text-sm">Statements, analytics, and account ledgers.</p>
                    </div>
                </div>

                <Tabs
                    value={workspaceTab}
                    onValueChange={(v) => {
                        setWorkspaceTab(v as "reports" | "ledgers");
                        if (v === "reports") setActiveReport(null);
                    }}
                    className="space-y-4"
                >
                    <div className="print:hidden flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                        <TabsScroller className="sm:flex-1">
                            <TabsList className="bg-slate-100 p-1">
                                <TabsTrigger
                                    value="reports"
                                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
                                >
                                    <FileBarChart className="h-4 w-4 mr-2" /> Reports
                                </TabsTrigger>
                                <TabsTrigger
                                    value="ledgers"
                                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm"
                                >
                                    <BookOpen className="h-4 w-4 mr-2" /> Unified Ledgers
                                </TabsTrigger>
                            </TabsList>
                        </TabsScroller>
                    </div>

                    <TabsContent value="reports" className="min-h-[420px] space-y-4 print:block">
                        {activeReport && reportContext ? (
                            <>
                                <div className="report-workspace-nav print:hidden flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 text-xs"
                                        onClick={handleBackToPicker}
                                    >
                                        <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                                        All reports
                                    </Button>
                                    <div className="flex items-center gap-2 text-sm text-slate-500">
                                        <span>{reportContext.section.label}</span>
                                        <ChevronRight className="h-3.5 w-3.5" />
                                        <span className="font-semibold text-slate-900">
                                            {reportContext.report.label}
                                        </span>
                                    </div>
                                </div>
                                <div className="report-workspace-canvas print:bg-white print:p-0 min-w-0 overflow-x-hidden">
                                    {ActiveReport ? (
                                        <Suspense fallback={<RouteFallback />}>
                                            <ActiveReport />
                                        </Suspense>
                                    ) : null}
                                </div>
                            </>
                        ) : (
                            <div className="report-workspace-nav print:hidden">
                                <ReportPicker
                                    activeSection={activeSection}
                                    onSectionChange={setActiveSection}
                                    query={query}
                                    onQueryChange={setQuery}
                                    onSelectReport={handleSelectReport}
                                />
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="ledgers" className="min-h-[420px]">
                        <div className="report-workspace-canvas print:bg-white print:p-0 min-w-0 overflow-x-hidden">
                            <UnifiedLedgersPanel
                                embedded
                                initialPartyCode={searchParams.get("party") ?? undefined}
                                initialShowParchi={parseParchiParam(searchParams.get("parchi"))}
                            />
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
