import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Shield, Eye, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PanelScroller, TableScroller } from "@/components/ui/responsive-primitives";
import {
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
    fetchAuditChain,
    fetchTransactionHistory,
    formatAuditAction,
    type AuditChainEvent,
    type TransactionHistoryRow,
} from "@/lib/repositories/auditRepo";
import { InvoiceVerificationPanel } from "@/components/admin/InvoiceVerificationPanel";
import { isErpLiveMode } from "@/lib/backendFlags";
import { listManagedUsers, type ManagedUser } from "@/lib/userAdmin";
import { format } from "date-fns";

const MOCK_LOGS: TransactionHistoryRow[] = [
    {
        id: "demo-1",
        eventAt: new Date().toISOString(),
        action: "post",
        entityType: "sales_invoices",
        entityId: "demo",
        sourceDocType: "sales_invoice",
        sourceDocId: null,
        sourceDocNo: "SI-26-001",
        summary: "Posted sales invoice SI-26-001",
        actorUserId: null,
        actorDisplayName: "Demo User",
        beforeData: null,
        afterData: { invoice_no: "SI-26-001" },
        metadata: {},
    },
];

function actionBadgeClass(action: string): string {
    if (action === "insert" || action === "Create") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (action === "update" || action === "Update") return "bg-amber-50 text-amber-700 border-amber-200";
    if (action === "delete" || action === "Delete") return "bg-rose-50 text-rose-700 border-rose-200";
    if (action === "post" || action === "Post") return "bg-blue-50 text-blue-700 border-blue-200";
    return "bg-slate-50 text-slate-700 border-slate-200";
}

export default function SystemAudit() {
    const [searchTerm, setSearchTerm] = useState("");
    const [dateFrom, setDateFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split("T")[0];
    });
    const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
    const [entityType, setEntityType] = useState("all");
    const [actionFilter, setActionFilter] = useState("all");
    const [actorId, setActorId] = useState("all");
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [logs, setLogs] = useState<TransactionHistoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedLog, setSelectedLog] = useState<TransactionHistoryRow | null>(null);
    const [chain, setChain] = useState<AuditChainEvent[]>([]);

    const loadLogs = useCallback(async () => {
        setLoading(true);
        try {
            if (!isErpLiveMode()) {
                setLogs(MOCK_LOGS);
                return;
            }
            const toExclusive = new Date(dateTo);
            toExclusive.setDate(toExclusive.getDate() + 1);
            const rows = await fetchTransactionHistory({
                from: new Date(dateFrom).toISOString(),
                to: toExclusive.toISOString(),
                entityType: entityType === "all" ? undefined : entityType,
                action: actionFilter === "all" ? undefined : actionFilter,
                actorId: actorId === "all" ? undefined : actorId,
                search: searchTerm.trim() || undefined,
                limit: 300,
            });
            setLogs(rows);
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, entityType, actionFilter, actorId, searchTerm]);

    useEffect(() => {
        void listManagedUsers().then(setUsers).catch(() => setUsers([]));
    }, []);

    useEffect(() => {
        void loadLogs();
    }, [loadLogs]);

    useEffect(() => {
        if (!selectedLog?.sourceDocType || !selectedLog.sourceDocId) {
            setChain([]);
            return;
        }
        void fetchAuditChain(selectedLog.sourceDocType, selectedLog.sourceDocId).then(setChain);
    }, [selectedLog]);

    const filteredLogs = logs.filter((log) => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return (
            log.actorDisplayName.toLowerCase().includes(q) ||
            log.entityType.toLowerCase().includes(q) ||
            log.action.toLowerCase().includes(q) ||
            (log.sourceDocNo ?? "").toLowerCase().includes(q) ||
            (log.summary ?? "").toLowerCase().includes(q)
        );
    });

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Transaction History</h1>
                    <p className="text-slate-500">Who recorded, edited, posted, or deleted every document in the system.</p>
                </div>

                <InvoiceVerificationPanel />

                <Card className="shadow-soft border-slate-100">
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <CardTitle className="flex items-center gap-2">
                                        <Shield className="h-5 w-5 text-blue-600" />
                                        Audit Trail
                                    </CardTitle>
                                    <CardDescription>
                                        {isErpLiveMode() ? "Live append-only audit log (admin only)" : "Demo sample"}
                                    </CardDescription>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => void loadLogs()} disabled={loading}>
                                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                                    Refresh
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10" />
                                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10" />
                                <Select value={entityType} onValueChange={setEntityType}>
                                    <SelectTrigger className="h-10"><SelectValue placeholder="Module" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All modules</SelectItem>
                                        {AUDIT_ENTITY_TYPES.map((t) => (
                                            <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={actionFilter} onValueChange={setActionFilter}>
                                    <SelectTrigger className="h-10"><SelectValue placeholder="Action" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All actions</SelectItem>
                                        {AUDIT_ACTIONS.map((a) => (
                                            <SelectItem key={a} value={a}>{formatAuditAction(a)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={actorId} onValueChange={setActorId}>
                                    <SelectTrigger className="h-10"><SelectValue placeholder="User" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All users</SelectItem>
                                        {users.map((u) => (
                                            <SelectItem key={u.userId} value={u.userId}>
                                                {u.displayName ?? u.email ?? u.userId.slice(0, 8)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                                    <Input
                                        placeholder="Search ref, summary…"
                                        className="pl-9 h-10"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <TableScroller>
                            <Table noWrapper className="min-w-[1100px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date / Time</TableHead>
                                        <TableHead>User</TableHead>
                                        <TableHead>Action</TableHead>
                                        <TableHead>Module</TableHead>
                                        <TableHead>Ref No.</TableHead>
                                        <TableHead>Summary</TableHead>
                                        <TableHead className="text-right">Details</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredLogs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-slate-500 whitespace-nowrap text-xs">
                                                {log.eventAt ? format(new Date(log.eventAt), "dd-MMM-yy HH:mm") : "—"}
                                            </TableCell>
                                            <TableCell className="font-medium text-sm">{log.actorDisplayName}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={actionBadgeClass(log.action)}>
                                                    {formatAuditAction(log.action)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs capitalize">{log.entityType.replace(/_/g, " ")}</TableCell>
                                            <TableCell className="font-mono text-xs">{log.sourceDocNo ?? log.entityId.slice(0, 8)}</TableCell>
                                            <TableCell className="text-xs text-slate-600 max-w-[240px] truncate">{log.summary ?? "—"}</TableCell>
                                            <TableCell className="text-right">
                                                <button
                                                    type="button"
                                                    className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-slate-100"
                                                    onClick={() => setSelectedLog(log)}
                                                >
                                                    <Eye className="h-4 w-4 text-slate-500" />
                                                </button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {!loading && filteredLogs.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                                                No audit events found for the selected filters.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </TableScroller>
                    </CardContent>
                </Card>

                <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
                    <DialogContent className="sm:max-w-[720px]">
                        <DialogHeader>
                            <DialogTitle>Event Details</DialogTitle>
                            <DialogDescription>
                                {selectedLog?.summary ?? selectedLog?.entityType}
                            </DialogDescription>
                        </DialogHeader>
                        {chain.length > 0 && (
                            <div className="rounded-lg border bg-slate-50 p-3 mb-2">
                                <p className="text-xs font-semibold text-slate-700 mb-2">Document timeline</p>
                                <ul className="space-y-1 text-xs text-slate-600">
                                    {chain.map((ev) => (
                                        <li key={ev.eventId}>
                                            <span className="font-medium">{formatAuditAction(ev.action)}</span>
                                            {" · "}{ev.actorDisplayName}
                                            {" · "}{format(new Date(ev.eventAt), "dd-MMM-yy HH:mm")}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 border rounded-md h-48">
                            <div className="border-r">
                                <p className="text-xs font-semibold p-2 border-b bg-slate-50">Before</p>
                                <PanelScroller className="h-36 p-2">
                                    <pre className="text-xs font-mono whitespace-pre-wrap text-slate-600">
                                        {selectedLog?.beforeData ? JSON.stringify(selectedLog.beforeData, null, 2) : "N/A"}
                                    </pre>
                                </PanelScroller>
                            </div>
                            <div>
                                <p className="text-xs font-semibold p-2 border-b bg-slate-50">After</p>
                                <PanelScroller className="h-36 p-2">
                                    <pre className="text-xs font-mono whitespace-pre-wrap text-slate-600">
                                        {selectedLog?.afterData ? JSON.stringify(selectedLog.afterData, null, 2) : "N/A"}
                                    </pre>
                                </PanelScroller>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </DashboardLayout>
    );
}
