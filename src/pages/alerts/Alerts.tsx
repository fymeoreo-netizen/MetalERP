import DashboardLayout from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, AlertTriangle, ShieldAlert, Plus, CheckCircle2, Activity, RefreshCw } from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useInventory } from "@/contexts/InventoryContext";
import { formatItemLabel } from "@/lib/inventoryStore";
import { CreateRuleModal } from "@/components/alerts/CreateRuleModal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { TabsScroller, TableScroller } from "@/components/ui/responsive-primitives";
import { useBackendLiveMode } from "@/lib/backendFlags";
import {
    acknowledgeProductionAlert,
    evaluateProductionAlerts,
    fetchProductionAlerts,
    type ProductionAlertRow,
} from "@/lib/api/production";
import { fetchPendingRateAlertsOrEmpty, type PendingRateAlertRow } from "@/lib/api/ratePending";
import { useToast } from "@/components/ui/use-toast";

export default function Alerts() {
    const liveMode = useBackendLiveMode();
    const { toast } = useToast();
    const { catalog, getBalance, getReorderLevel } = useInventory();
    const [createOpen, setCreateOpen] = useState(false);
    const [productionAlerts, setProductionAlerts] = useState<ProductionAlertRow[]>([]);
    const [ratePendingAlerts, setRatePendingAlerts] = useState<PendingRateAlertRow[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const loadProductionAlerts = useCallback(async () => {
        if (!liveMode) {
            setProductionAlerts([]);
            setRatePendingAlerts([]);
            return;
        }
        setRefreshing(true);
        try {
            await evaluateProductionAlerts();
            const [rows, rateRows] = await Promise.all([
                fetchProductionAlerts("open"),
                fetchPendingRateAlertsOrEmpty(3),
            ]);
            setProductionAlerts(rows);
            setRatePendingAlerts(rateRows);
        } finally {
            setRefreshing(false);
        }
    }, [liveMode]);

    useEffect(() => {
        void loadProductionAlerts();
    }, [loadProductionAlerts]);

    const stockAlerts = useMemo(
        () =>
            catalog
                .filter((i) => {
                    const threshold = getReorderLevel(i.code);
                    return threshold > 0 && getBalance(i.code) <= threshold;
                })
                .map((i, idx) => ({
                    id: 200 + idx,
                    message: `Low stock: ${formatItemLabel(i)} — ${getBalance(i.code).toLocaleString()} ${i.unit} (reorder ${getReorderLevel(i.code)})`,
                    time: "Live",
                    severity: "warning" as const,
                })),
        [catalog, getBalance, getReorderLevel]
    );

    // Mock Data
    const [rules, setRules] = useState([
        { id: 1, name: "Critical Wastage", metric: "Production Wastage %", condition: ">", value: "5", severity: "critical", status: true },
        { id: 2, name: "Low Stock Warning", metric: "Stock Level", condition: "<", value: "100", severity: "warning", status: true },
        { id: 3, name: "Parchi Due Soon", metric: "Parchi Due Date", condition: "<", value: "3 Days", severity: "info", status: false },
    ]);

    const [alerts, setAlerts] = useState([
        { id: 103, message: "Parchi #P-502 is due tomorrow", time: "5 hours ago", severity: "info" as const },
    ]);

    const productionAlertItems = useMemo(
        () =>
            productionAlerts.map((a) => ({
                id: a.id,
                message: a.message,
                time: new Date(a.created_at).toLocaleDateString(),
                severity: (a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info") as
                    | "critical"
                    | "warning"
                    | "info",
                productionId: a.id,
                metricValue: a.metric_value,
                thresholdValue: a.threshold_value,
                alertType: a.alert_type,
            })),
        [productionAlerts],
    );

    const ratePendingAlertItems = useMemo(
        () =>
            ratePendingAlerts.map((a, idx) => ({
                id: `rate-${idx}-${a.sourceDocNo}`,
                message: `Rate pending ${a.daysPending}d: ${a.partyName} · ${a.sourceDocNo} · ${a.qty.toLocaleString()} kg`,
                time: a.originalPostingDate,
                severity: (a.daysPending >= 7 ? "critical" : "warning") as "critical" | "warning" | "info",
            })),
        [ratePendingAlerts],
    );

    const allAlerts = useMemo(
        () => [...stockAlerts, ...productionAlertItems, ...ratePendingAlertItems, ...alerts],
        [stockAlerts, productionAlertItems, ratePendingAlertItems, alerts],
    );

    const ackProduction = async (id: string) => {
        const res = await acknowledgeProductionAlert(id);
        if (!res.ok) {
            toast({ title: "Failed to acknowledge", description: res.error, variant: "destructive" });
            return;
        }
        await loadProductionAlerts();
    };

    const handleCreateRule = (data: any) => {
        const newRule = {
            id: rules.length + 1,
            name: data.name,
            metric: data.metric === "wastage" ? "Production Wastage %" :
                data.metric === "stock" ? "Stock Level" :
                    data.metric === "credit" ? "Credit Limit" : "Parchi Due Date",
            condition: data.condition === "greater_than" ? ">" : data.condition === "less_than" ? "<" : "=",
            value: data.threshold,
            severity: data.severity,
            status: true
        };
        setRules([...rules, newRule]);
    };

    const toggleRule = (id: number) => {
        setRules(rules.map(r => r.id === id ? { ...r, status: !r.status } : r));
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Alerts & Risk</h1>
                        <p className="text-slate-500">System health monitoring and automated notifications.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            disabled={!liveMode || refreshing}
                            onClick={() => void loadProductionAlerts()}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            New Alert Rule
                        </Button>
                    </div>
                </div>

                <CreateRuleModal open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreateRule} />

                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="shadow-soft border-slate-100 bg-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
                            <Bell className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-rose-600">{allAlerts.length}</div>
                            <p className="text-xs text-slate-500">Requires attention</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-soft border-slate-100 bg-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Active Rules</CardTitle>
                            <ShieldAlert className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-600">{rules.filter(r => r.status).length}</div>
                            <p className="text-xs text-slate-500">Monitoring system</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-soft border-slate-100 bg-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">System Health</CardTitle>
                            <Activity className="h-4 w-4 text-blue-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-blue-600">98%</div>
                            <p className="text-xs text-slate-500">Operational uptime</p>
                        </CardContent>
                    </Card>
                </div>

                <Tabs defaultValue="active" className="space-y-4">
                    <TabsScroller>
                        <TabsList className="bg-slate-100 p-1">
                            <TabsTrigger value="active" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Active Alerts</TabsTrigger>
                            <TabsTrigger value="rules" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Rule Configuration</TabsTrigger>
                        </TabsList>
                    </TabsScroller>

                    <TabsContent value="active">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Current Notifications</CardTitle>
                                <CardDescription>Real-time alerts triggered by your rules.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {allAlerts.map((alert) => (
                                        <div key={alert.id} className={`flex items-start p-4 rounded-lg border ${alert.severity === 'critical' ? 'bg-rose-50 border-rose-100' :
                                                alert.severity === 'warning' ? 'bg-amber-50 border-amber-100' :
                                                    'bg-blue-50 border-blue-100'
                                            }`}>
                                            <div className="mr-4 mt-0.5">
                                                {alert.severity === 'critical' ? <AlertTriangle className="h-5 w-5 text-rose-600" /> :
                                                    alert.severity === 'warning' ? <AlertTriangle className="h-5 w-5 text-amber-600" /> :
                                                        <Bell className="h-5 w-5 text-blue-600" />}
                                            </div>
                                            <div className="flex-1">
                                                <h4 className={`text-sm font-semibold ${alert.severity === 'critical' ? 'text-rose-900' :
                                                        alert.severity === 'warning' ? 'text-amber-900' :
                                                            'text-blue-900'
                                                    }`}>
                                                    {alert.severity.toUpperCase()} ALERT
                                                </h4>
                                                <p className="text-sm text-slate-700 mt-1">{alert.message}</p>
                                                {"metricValue" in alert &&
                                                    alert.metricValue != null &&
                                                    "thresholdValue" in alert &&
                                                    alert.thresholdValue != null && (
                                                        <p className="text-xs font-mono text-slate-600 mt-1">
                                                            Actual {Number(alert.metricValue).toFixed(2)}% · Limit{" "}
                                                            {Number(alert.thresholdValue).toFixed(2)}%
                                                        </p>
                                                    )}
                                                <p className="text-xs text-slate-500 mt-2">{alert.time}</p>
                                                {"productionId" in alert && alert.productionId ? (
                                                    <Link
                                                        to="/admin/production-settings"
                                                        className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                                                    >
                                                        Production settings
                                                    </Link>
                                                ) : null}
                                            </div>
                                            {"productionId" in alert && alert.productionId ? (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8"
                                                    onClick={() => void ackProduction(String(alert.productionId))}
                                                >
                                                    Acknowledge
                                                </Button>
                                            ) : (
                                                <Button variant="ghost" size="sm" className="h-8">
                                                    Dismiss
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="rules">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Alert Rules</CardTitle>
                                <CardDescription>Configure the conditions that trigger notifications.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <TableScroller>
                                <Table noWrapper className="min-w-[720px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Rule Name</TableHead>
                                            <TableHead>Metric</TableHead>
                                            <TableHead>Condition</TableHead>
                                            <TableHead>Threshold</TableHead>
                                            <TableHead>Severity</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rules.map((rule) => (
                                            <TableRow key={rule.id}>
                                                <TableCell className="font-medium">{rule.name}</TableCell>
                                                <TableCell>{rule.metric}</TableCell>
                                                <TableCell className="font-mono text-xs">{rule.condition}</TableCell>
                                                <TableCell>{rule.value}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={
                                                        rule.severity === 'critical' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                            rule.severity === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                                'bg-blue-50 text-blue-700 border-blue-200'
                                                    }>{rule.severity}</Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center space-x-2">
                                                        <Switch checked={rule.status} onCheckedChange={() => toggleRule(rule.id)} />
                                                        <span className="text-xs text-slate-500">{rule.status ? 'Active' : 'Disabled'}</span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </TableScroller>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
