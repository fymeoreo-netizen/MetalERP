import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PartyScrapCreditRow } from "@/lib/scrapObligationTypes";
import { PendingReasonBadge } from "@/components/shared/PendingReasonSelect";

type Props = {
    rows: PartyScrapCreditRow[];
};

export function PartyScrapCreditsTable({ rows }: Props) {
    if (!rows.length) return null;

    return (
        <div className="mb-8 print:mb-4 print:break-inside-avoid">
            <h3 className="text-lg font-bold text-slate-800 tracking-wide border-b-2 border-violet-600 print:border-black pb-0.5 inline-block uppercase mb-3 print:text-[10pt] print:mb-1.5 print:break-after-avoid">
                Advance scrap on hand
            </h3>
            <div className="border border-slate-300 print:border-slate-800 rounded-xl print:rounded-none overflow-hidden print:overflow-visible">
                <Table className="report-table report-table--compact text-[11px] w-full">
                    <TableHeader>
                        <TableRow className="bg-violet-50">
                            <TableHead>Trade</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Pending</TableHead>
                            <TableHead className="text-right">Credit kg</TableHead>
                            <TableHead className="text-right">Consumed</TableHead>
                            <TableHead className="text-right">Open kg</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.credit_id}>
                                <TableCell className="font-mono">{row.trade_no}</TableCell>
                                <TableCell>{row.trade_date}</TableCell>
                                <TableCell>
                                    <PendingReasonBadge reason={row.pending_reason} />
                                </TableCell>
                                <TableCell className="text-right">{row.credit_kg.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{row.consumed_kg.toLocaleString()}</TableCell>
                                <TableCell className="text-right font-semibold">{row.open_kg.toLocaleString()}</TableCell>
                                <TableCell>{row.status}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <p className="text-xs text-slate-500 mt-2 print:text-[8pt] print:mt-1">
                Unlinked toll-drops with pending rate or tare — selectable on the next scrap trade.
            </p>
        </div>
    );
}
