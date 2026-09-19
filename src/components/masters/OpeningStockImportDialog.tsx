import { useEffect, useMemo, useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { useInventory } from "@/contexts/InventoryContext";
import { postOpeningStockBatch } from "@/lib/api/posting";
import { useBackendLiveMode } from "@/lib/backendFlags";
import {
    DEFAULT_INVENTORY_CUTOVER_DATE,
    OPENING_STOCK_CSV_HEADER,
    openingStockRowsToPayload,
    parseOpeningStockCsv,
    type OpeningStockImportRow,
} from "@/lib/openingStock";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { Upload } from "lucide-react";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const SAMPLE_CSV = `${OPENING_STOCK_CSV_HEADER}
RM-W8-001,RM,1250,0,2850,${DEFAULT_INVENTORY_CUTOVER_DATE}
FG-ENW-001,FG,420,99,3100,${DEFAULT_INVENTORY_CUTOVER_DATE}`;

export function OpeningStockImportDialog({ open, onOpenChange }: Props) {
    const { toast } = useToast();
    const { refresh } = useInventory();
    const liveMode = useBackendLiveMode();
    const fileRef = useRef<HTMLInputElement>(null);

    const [csvText, setCsvText] = useState(SAMPLE_CSV);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [rows, setRows] = useState<OpeningStockImportRow[]>([]);
    const [importing, setImporting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setCsvText(SAMPLE_CSV);
        setParseErrors([]);
        setRows([]);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const { rows: parsed, errors } = parseOpeningStockCsv(csvText);
        setRows(parsed);
        setParseErrors(errors);
    }, [csvText, open]);

    const totalValue = useMemo(
        () => rows.reduce((sum, r) => sum + r.qty * r.unitCost, 0),
        [rows],
    );

    const handleFile = (file: File | null) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === "string" ? reader.result : "";
            if (text.trim()) setCsvText(text);
        };
        reader.readAsText(file);
    };

    const handleImport = async () => {
        if (!rows.length) {
            toast({
                title: "No rows to import",
                description: parseErrors[0] ?? "Paste or upload a CSV with at least one data row.",
                variant: "destructive",
            });
            return;
        }
        if (parseErrors.length) {
            toast({
                title: "Fix CSV errors first",
                description: parseErrors.slice(0, 3).join(" · "),
                variant: "destructive",
            });
            return;
        }
        if (!liveMode) {
            toast({
                title: "Live mode required",
                description: "Opening stock import posts to the database and requires live ERP mode.",
                variant: "destructive",
            });
            return;
        }

        setImporting(true);
        try {
            const result = await postOpeningStockBatch(openingStockRowsToPayload(rows));
            if (!result.ok) {
                const detail =
                    result.errors?.slice(0, 3).map((e) => `${e.item_code ?? "?"}: ${e.error}`).join(" · ") ??
                    result.error;
                toast({
                    title: result.posted ? "Import partially failed" : "Import failed",
                    description: detail,
                    variant: "destructive",
                });
                if (result.posted) {
                    await refresh();
                }
                return;
            }
            await refresh();
            toast({
                title: "Opening stock imported",
                description: `${result.posted} row(s) posted — total value PKR ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`,
            });
            onOpenChange(false);
        } catch (e) {
            toast({
                title: "Import failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setImporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Import opening stock</DialogTitle>
                    <DialogDescription>
                        Bulk-post opening inventory with unit cost. Warehouse codes: RM, FG, PM, VAR. Default as-of:{" "}
                        {DEFAULT_INVENTORY_CUTOVER_DATE}.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
                    <div className="flex flex-wrap gap-2">
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".csv,text/csv,text/plain"
                            className="hidden"
                            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload CSV
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setCsvText(SAMPLE_CSV)}>
                            Load sample
                        </Button>
                    </div>

                    <div className="grid gap-2">
                        <Label>CSV data</Label>
                        <Textarea
                            className="font-mono text-xs min-h-[140px]"
                            value={csvText}
                            onChange={(e) => setCsvText(e.target.value)}
                            spellCheck={false}
                        />
                        <p className="text-xs text-slate-500">
                            Columns: <code>{OPENING_STOCK_CSV_HEADER}</code>
                        </p>
                    </div>

                    {parseErrors.length > 0 && (
                        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                            {parseErrors.slice(0, 5).map((err) => (
                                <div key={err}>{err}</div>
                            ))}
                            {parseErrors.length > 5 ? <div>…and {parseErrors.length - 5} more</div> : null}
                        </div>
                    )}

                    {rows.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{rows.length} row(s) ready</span>
                                <span className="text-slate-500">
                                    Total value PKR {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                            <TableScroller>
                                <Table noWrapper className="min-w-[640px] text-sm">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Item</TableHead>
                                            <TableHead>WH</TableHead>
                                            <TableHead className="text-right">Qty (kg)</TableHead>
                                            <TableHead className="text-right">Units</TableHead>
                                            <TableHead className="text-right">Unit cost</TableHead>
                                            <TableHead>As-of</TableHead>
                                            <TableHead className="text-right">Value</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.map((r, i) => (
                                            <TableRow key={`${r.itemCode}-${r.warehouseCode}-${i}`}>
                                                <TableCell className="font-mono">{r.itemCode}</TableCell>
                                                <TableCell>{r.warehouseCode}</TableCell>
                                                <TableCell className="text-right">{r.qty.toLocaleString()}</TableCell>
                                                <TableCell className="text-right">
                                                    {r.unitCount > 0 ? r.unitCount.toLocaleString() : "—"}
                                                </TableCell>
                                                <TableCell className="text-right">{r.unitCost.toLocaleString()}</TableCell>
                                                <TableCell>{r.asOf}</TableCell>
                                                <TableCell className="text-right">
                                                    {(r.qty * r.unitCost).toLocaleString(undefined, {
                                                        maximumFractionDigits: 0,
                                                    })}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableScroller>
                        </div>
                    )}
                </div>

                <DialogFooter className="shrink-0 border-t pt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleImport()}
                        disabled={importing || !rows.length || parseErrors.length > 0}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        {importing ? "Importing…" : `Import ${rows.length || ""} row(s)`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
