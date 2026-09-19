import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import {
    getDefaultMonthFilters,
    getPartyStockActivityForParty,
    formatQty,
} from "@/lib/partyMovementReport";

export function PartyStockActivityCard({ partyId }: { partyId: string }) {
    const filters = getDefaultMonthFilters();
    const activity = getPartyStockActivityForParty(partyId, filters);
    const reportLink = `/reports?report=party-stock&from=${filters.dateFrom}&to=${filters.dateTo}&party=${partyId}`;

    const receivedTotal =
        activity.totals.scrapReceived + activity.totals.wire8Received + activity.totals.rodReceived;
    const soldTotal = activity.totals.fgEnameledSold + activity.totals.fgStripSold;

    return (
        <Card className="shadow-soft border-slate-100 border-l-4 border-l-blue-400">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <CardTitle className="text-lg">Stock activity (this month)</CardTitle>
                        <CardDescription>
                            {filters.dateFrom} → {filters.dateTo}
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                        <Link to={reportLink}>
                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                            Full report
                        </Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
                <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">RM received</p>
                    <p className="text-xl font-bold mt-1">{formatQty(receivedTotal)}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                        Scrap {formatQty(activity.totals.scrapReceived)} · W8{" "}
                        {formatQty(activity.totals.wire8Received)} · Rod{" "}
                        {formatQty(activity.totals.rodReceived)}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">FG sold</p>
                    <p className="text-xl font-bold mt-1">{formatQty(soldTotal)}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                        Enameled {formatQty(activity.totals.fgEnameledSold)} · Strip{" "}
                        {formatQty(activity.totals.fgStripSold)}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Scrap sent</p>
                    <p className="text-xl font-bold mt-1">{formatQty(activity.totals.scrapSent)}</p>
                </div>
            </CardContent>
        </Card>
    );
}
