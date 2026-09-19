import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Activity, CheckCircle2, ClipboardList, RefreshCw, Stethoscope } from "lucide-react";
import { isErpLiveMode } from "@/lib/backendFlags";
import {
    fetchInvoicePostingIntegrity,
    runPostingDiagnostics,
    type InvoicePostingIntegrityRow,
} from "@/lib/api/diagnostics";
import type { PostingDiagnosticRow } from "@/lib/api/types";
import { TableScroller } from "@/components/ui/responsive-primitives";

const SMOKE_STORAGE_KEY = "erp-invoice-smoke-checklist-v1";

const SMOKE_CASES = [
    { id: "sales-direct", label: "Sales direct (no SO)", href: "/sales", hint: "Post FG line; stock ↓, AR aging" },
    { id: "sales-so", label: "Sales direct (linked SO)", href: "/sales", hint: "Pull from order; SO fulfillment updates" },
    { id: "sales-premium", label: "Sales premium", href: "/sales", hint: "Watta + scrap obligation created" },
    { id: "purchase-cash", label: "Purchase cash", href: "/purchase", hint: "Stock ↑, AP aging" },
    { id: "purchase-premium", label: "Purchase premium", href: "/purchase", hint: "Premium allocation valid" },
    { id: "purchase-advance", label: "Purchase advance settlement", href: "/purchase", hint: "No lines; post succeeds" },
    { id: "sales-return", label: "Sales return (restock)", href: "/sales", hint: "Stock ↑, AR reduced" },
    { id: "purchase-return", label: "Purchase return", href: "/purchase", hint: "Stock ↓, AP reduced" },
    { id: "void-si", label: "Void posted sales invoice", href: "/sales", hint: "Auto return posted; audit trail" },
] as const;

function statusBadgeClass(status: string): string {
    if (status === "OK" || status === "PASS") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "WARN") return "bg-amber-50 text-amber-800 border-amber-200";
    return "bg-rose-50 text-rose-700 border-rose-200";
}

function loadSmokeState(): Record<string, boolean> {
    try {
        const raw = sessionStorage.getItem(SMOKE_STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
        return {};
    }
}

export function InvoiceVerificationPanel() {
    const liveMode = isErpLiveMode();
    const [diagLoading, setDiagLoading] = useState(false);
    const [integrityLoading, setIntegrityLoading] = useState(false);
    const [diagRows, setDiagRows] = useState<PostingDiagnosticRow[]>([]);
    const [integrityRows, setIntegrityRows] = useState<InvoicePostingIntegrityRow[]>([]);
    const [diagError, setDiagError] = useState<string | null>(null);
    const [integrityError, setIntegrityError] = useState<string | null>(null);
    const [smoke, setSmoke] = useState<Record<string, boolean>>(loadSmokeState);

    useEffect(() => {
        sessionStorage.setItem(SMOKE_STORAGE_KEY, JSON.stringify(smoke));
    }, [smoke]);

    const runDiagnostics = useCallback(async () => {
        setDiagLoading(true);
        setDiagError(null);
        try {
            const result = await runPostingDiagnostics();
            setDiagRows(result.rows);
        } catch (e) {
            setDiagError(e instanceof Error ? e.message : "Diagnostics failed.");
            setDiagRows([]);
        } finally {
            setDiagLoading(false);
        }
    }, []);

    const runIntegrity = useCallback(async () => {
        setIntegrityLoading(true);
        setIntegrityError(null);
        try {
            const result = await fetchInvoicePostingIntegrity();
            if (!result.ok) {
                setIntegrityError(result.error);
                setIntegrityRows([]);
                return;
            }
            setIntegrityRows(result.data);
        } catch (e) {
            setIntegrityError(e instanceof Error ? e.message : "Integrity check failed.");
            setIntegrityRows([]);
        } finally {
            setIntegrityLoading(false);
        }
    }, []);

    const smokeDone = SMOKE_CASES.filter((c) => smoke[c.id]).length;

    return (
        <div className="space-y-4">
            <Card className="shadow-soft border-slate-100">
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Stethoscope className="h-4 w-4 text-blue-600" />
                                Posting health
                            </CardTitle>
                            <CardDescription>
                                Auth, posting maps, deploy checks, and RPC reachability
                            </CardDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!liveMode || diagLoading}
                            onClick={() => void runDiagnostics()}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${diagLoading ? "animate-spin" : ""}`} />
                            Run check
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {!liveMode && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            Sign in with live Supabase to run posting diagnostics.
                        </p>
                    )}
                    {diagError && <p className="text-sm text-rose-600 mb-2">{diagError}</p>}
                    {diagRows.length > 0 && (
                        <TableScroller>
                            <Table noWrapper className="min-w-[520px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Check</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Detail</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {diagRows.map((row) => (
                                        <TableRow key={row.check_name}>
                                            <TableCell className="text-xs font-medium">{row.check_name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={statusBadgeClass(row.status)}>
                                                    {row.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-600 max-w-md">{row.detail}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableScroller>
                    )}
                </CardContent>
            </Card>

            <Card className="shadow-soft border-slate-100">
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Activity className="h-4 w-4 text-violet-600" />
                                Invoice posting integrity
                            </CardTitle>
                            <CardDescription>
                                GL, AR/AP subledger, premium obligations, stuck drafts
                            </CardDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!liveMode || integrityLoading}
                            onClick={() => void runIntegrity()}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${integrityLoading ? "animate-spin" : ""}`} />
                            Run check
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {integrityError && <p className="text-sm text-rose-600 mb-2">{integrityError}</p>}
                    {integrityRows.length > 0 && (
                        <TableScroller>
                            <Table noWrapper className="min-w-[640px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Check</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Issues</TableHead>
                                        <TableHead>Sample refs</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {integrityRows.map((row) => (
                                        <TableRow key={row.check_code}>
                                            <TableCell className="text-xs">{row.check_name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={statusBadgeClass(row.status)}>
                                                    {row.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right text-xs tabular-nums">
                                                {row.issue_count}
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                                                {row.sample_refs || "—"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableScroller>
                    )}
                </CardContent>
            </Card>

            <Card className="shadow-soft border-slate-100">
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ClipboardList className="h-4 w-4 text-emerald-600" />
                                Manual smoke checklist
                            </CardTitle>
                            <CardDescription>
                                {smokeDone}/{SMOKE_CASES.length} completed this session — tick after each post test
                            </CardDescription>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setSmoke({})}>
                            Reset
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-2">
                    {SMOKE_CASES.map((item) => (
                        <label
                            key={item.id}
                            className="flex items-start gap-3 rounded-md border border-slate-100 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                        >
                            <Checkbox
                                checked={Boolean(smoke[item.id])}
                                onCheckedChange={(v) => setSmoke((prev) => ({ ...prev, [item.id]: v === true }))}
                                className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-slate-900">{item.label}</span>
                                    <Link to={item.href} className="text-xs text-blue-600 hover:underline">
                                        Open →
                                    </Link>
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">{item.hint}</p>
                            </div>
                            {smoke[item.id] && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                        </label>
                    ))}
                    <p className="text-xs text-slate-500 pt-2 border-t">
                        After posting, cross-check in{" "}
                        <Link to="/reports?report=unified-ledgers" className="text-blue-600 hover:underline">
                            Unified Ledgers
                        </Link>
                        ,{" "}
                        <Link to="/reports?report=party-balance" className="text-blue-600 hover:underline">
                            Party Balance
                        </Link>
                        , and AR/AP aging reports. Post events appear in the audit trail below.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
