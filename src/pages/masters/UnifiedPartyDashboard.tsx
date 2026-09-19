import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Wallet, Package, AlertTriangle, ArrowRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { getParty, initPartyCatalog } from "@/lib/partyCatalog";
import { PartyStockActivityCard } from "@/components/inventory/PartyStockActivityCard";
import { fetchPartyLedger, fetchPartyMetalLedger } from "@/lib/api/reports";
import { isErpLiveMode } from "@/lib/backendFlags";

export default function UnifiedPartyDashboard() {
    const { id = "" } = useParams();
    const [partyName, setPartyName] = useState("Unknown Party");
    const [partyType, setPartyType] = useState("Vendor");
    const [financialBalance, setFinancialBalance] = useState<number | null>(null);
    const [metalBalance, setMetalBalance] = useState(0);
    const [ledgerError, setLedgerError] = useState(false);

    useEffect(() => {
        void (async () => {
            await initPartyCatalog();
            const party = getParty(id);
            setPartyName(party?.name ?? "Unknown Party");
            setPartyType(party?.type ?? "Vendor");
            if (!isErpLiveMode() || !id) {
                setFinancialBalance(null);
                setLedgerError(false);
                return;
            }

            setLedgerError(false);
            try {
                const [ledger, metal] = await Promise.all([fetchPartyLedger(id), fetchPartyMetalLedger(id)]);
                let finBal = 0;
                ledger.forEach((r: { debit_amount?: number; credit_amount?: number }) => {
                    finBal += Number(r.debit_amount ?? 0) - Number(r.credit_amount ?? 0);
                });
                setFinancialBalance(finBal);

                const lastMetal = metal.length ? metal[metal.length - 1] : null;
                setMetalBalance(Number(lastMetal?.running_kg ?? 0));
            } catch {
                setLedgerError(true);
                setFinancialBalance(null);
                setMetalBalance(0);
            }
        })();
    }, [id]);

    const unallocatedWeight = Math.max(0, Math.abs(metalBalance));

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-5xl mx-auto">
                <div className="flex items-center gap-4">
                    <Link to="/masters/parties">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{partyName}</h1>
                            <Badge variant="outline" className="bg-slate-100 text-slate-700">{id}</Badge>
                            <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">{partyType}</Badge>
                        </div>
                        <p className="text-slate-500 mt-1">Unified Party Dashboard — dual ledger from live ERP</p>
                    </div>
                </div>

                {unallocatedWeight > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="bg-amber-100 p-2 rounded-full text-amber-600">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-amber-900">Metal position alert</h3>
                                <p className="text-sm text-amber-700 font-medium mt-0.5">
                                    Net metal balance: <strong className="font-mono">{metalBalance.toLocaleString()} kg</strong>
                                </p>
                            </div>
                        </div>
                        <Link to="/purchase">
                            <Button className="bg-amber-500 hover:bg-amber-600 shadow-sm text-white border-0">
                                Settle Advance <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </div>
                )}

                <PartyStockActivityCard partyId={id} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="shadow-sm border-slate-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-slate-600 text-lg flex items-center gap-2">
                                <Wallet className="h-5 w-5 text-slate-400" /> Financial Khata (PKR)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={`text-5xl font-mono font-bold py-4 ${
                                ledgerError
                                    ? "text-slate-400"
                                    : (financialBalance ?? 0) >= 0
                                      ? "text-emerald-600"
                                      : "text-rose-600"
                            }`}>
                                {ledgerError || financialBalance === null
                                    ? "—"
                                    : `₨ ${Math.abs(financialBalance).toLocaleString()}`}
                            </div>
                            <p className="text-sm text-slate-500 mt-2">
                                {ledgerError
                                    ? "Could not load financial balance from party ledger."
                                    : financialBalance === null
                                      ? "Connect live ERP to see balance."
                                      : (financialBalance ?? 0) >= 0
                                        ? "Receivable (Dr)"
                                        : "Payable (Cr)"}{" "}
                                {!ledgerError && financialBalance !== null ? "from posted AR/AP lines" : ""}
                            </p>
                        </CardContent>
                    </Card>

                    <Card className="shadow-sm border-slate-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-slate-600 text-lg flex items-center gap-2">
                                <Package className="h-5 w-5 text-slate-400" /> Metal Khata (KG)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={`text-5xl font-mono font-bold py-4 ${metalBalance < 0 ? "text-amber-500" : "text-blue-600"}`}>
                                {Math.abs(metalBalance).toLocaleString()} <span className="text-3xl text-slate-400">kg</span>
                            </div>
                            <p className="text-sm text-slate-500 mt-2">Running balance from metal ledger RPC</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
