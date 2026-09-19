import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
} from "./ReportPrintPage";
import { ReportLoadState } from "./ReportLoadState";
import { fetchPendingRateItemsOrEmpty } from "@/lib/api/ratePending";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";
import type { PendingRateItemRow } from "@/lib/ratePending";
import { docTypeLabel } from "@/lib/ratePending";

export default function PendingRateRegisterReport() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const today = new Date().toISOString().split("T")[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const [dateFrom, setDateFrom] = useState(firstOfMonth);
    const [dateTo, setDateTo] = useState(today);
    const [partyCode, setPartyCode] = useState("");
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState<PendingRateItemRow[]>([]);
    const [loading, setLoading] = useState(false);

    const handleGenerate = async () => {
        setShow(true);
        if (!liveMode) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const data = await fetchPendingRateItemsOrEmpty({
                from: dateFrom,
                to: dateTo,
                partyCode: partyCode.trim() || undefined,
                openOnly: true,
            });
            setRows(data);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load pending rate register.";
            toast({ title: "Report failed", description: message, variant: "destructive" });
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    const totalKg = rows.reduce((s, r) => s + r.qty, 0);
    const hasData = rows.length > 0;

    return (
        <div className="space-y-4">
            <ReportPrintControls
                actions={show && !loading && hasData ? <ReportPrintButton /> : null}
            >
                <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                        <Label className="text-xs">From</Label>
                        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36" />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">To</Label>
                        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36" />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Party code</Label>
                        <Input
                            value={partyCode}
                            onChange={(e) => setPartyCode(e.target.value)}
                            placeholder="Optional"
                            className="h-8 w-32"
                        />
                    </div>
                    <Button className="bg-blue-600 hover:bg-blue-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                        {loading ? "Loading…" : "Generate Register"}
                    </Button>
                </div>
            </ReportPrintControls>

            <ReportLoadState
                loading={show && loading}
                error={show && !liveMode && !loading ? "Enable live mode to load pending rate register." : null}
                empty={show && !loading && liveMode && !hasData}
                emptyMessage="No open pending-rate items in this period."
            />

            {show && !loading && hasData && (
                <ReportPrintDocument
                    reportTitle="Pending Rate Register"
                    subtitle={`Open items · ${dateFrom} to ${dateTo}`}
                    density="compact"
                >
                    <ReportTable compact className="min-w-[720px]">
                        <thead>
                            <tr>
                                <th>Doc</th>
                                <th>Type</th>
                                <th>Date</th>
                                <th>Party</th>
                                <th>Item</th>
                                <th className="text-right">Kg</th>
                                <th className="text-right">Days</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-b border-slate-100">
                                    <td className="py-1.5 px-2 font-mono text-xs">{r.sourceDocNo}</td>
                                    <td className="py-1.5 px-2 text-xs">{docTypeLabel(r.sourceDocType)}</td>
                                    <td className="py-1.5 px-2 text-xs">{r.originalPostingDate}</td>
                                    <td className="py-1.5 px-2 text-sm">{r.partyName}</td>
                                    <td className="py-1.5 px-2 text-sm">{r.itemName ?? "—"}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{r.qty.toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right">
                                        <Badge variant={r.daysPending >= 3 ? "destructive" : "secondary"} className="text-[10px]">
                                            {r.daysPending}d
                                        </Badge>
                                    </td>
                                    <td className="py-1.5 px-2 text-xs capitalize">{r.status}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="report-row-total">
                                <td colSpan={5} className="text-right">
                                    Total open qty
                                </td>
                                <td className="text-right font-mono">{totalKg.toLocaleString()} kg</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
