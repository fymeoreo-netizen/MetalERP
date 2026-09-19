import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PartyScrapExpectationRow } from "@/lib/scrapObligationTypes";

export type ScrapExpectationsPanelProps = {
    rows: PartyScrapExpectationRow[];
};

export function ScrapExpectationsPanel({ rows }: ScrapExpectationsPanelProps) {
    if (!rows.length) return null;

    return (
        <div className="mb-8 print:mb-4 print:break-inside-avoid">
            <h3 className="text-lg font-bold text-slate-800 tracking-wide border-b-2 border-amber-600 print:border-black pb-0.5 inline-block uppercase mb-3 print:text-[10pt] print:mb-1.5 print:break-after-avoid">
                Open scrap to receive (premium enamel)
            </h3>
            <div className="border border-slate-300 print:border-slate-800 rounded-xl print:rounded-none overflow-hidden print:overflow-visible">
                <Table className="report-table report-table--compact text-[11px] w-full">
                    <TableHeader>
                        <TableRow className="bg-amber-50">
                            <TableHead>Invoice</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Ref rate</TableHead>
                            <TableHead className="text-right">Expected kg</TableHead>
                            <TableHead className="text-right">Received</TableHead>
                            <TableHead className="text-right">Open kg</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.obligation_no}>
                                <TableCell className="font-mono">{row.sales_invoice_no}</TableCell>
                                <TableCell>{row.invoice_date}</TableCell>
                                <TableCell className="text-right">{row.ref_scrap_rate.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{row.expected_kg.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{row.received_kg.toLocaleString()}</TableCell>
                                <TableCell className="text-right font-semibold">{row.open_kg.toLocaleString()}</TableCell>
                                <TableCell>
                                    {row.obligation_source === "opening" ? "opening" : row.status}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <p className="text-xs text-slate-500 mt-2 print:text-[8pt] print:mt-1">
                Enamel sold on premium invoices — customer sends scrap at the reference rate shown.
            </p>
        </div>
    );
}
