import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Plus, MapPin, Building, CreditCard, Filter, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AddPartyModal } from "@/components/masters/AddPartyModal";
import { getParties, initPartyCatalog, removeParty, subscribeParties, type PartyRecord } from "@/lib/partyCatalog";
import { useToast } from "@/components/ui/use-toast";

export default function PartyMaster() {
    const { toast } = useToast();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingParty, setEditingParty] = useState<PartyRecord | null>(null);
    const [tick, setTick] = useState(0);
    const [search, setSearch] = useState("");

    useEffect(() => {
        void initPartyCatalog().then(() => setTick((v) => v + 1));
        return subscribeParties(() => setTick((v) => v + 1));
    }, []);
    const parties = useMemo(() => getParties(), [tick]);
    const visibleParties = useMemo(
        () =>
            parties.filter(
                (party) =>
                    !search ||
                    party.name.toLowerCase().includes(search.toLowerCase()) ||
                    party.id.toLowerCase().includes(search.toLowerCase()) ||
                    (party.city ?? "").toLowerCase().includes(search.toLowerCase()) ||
                    (party.phone ?? "").toLowerCase().includes(search.toLowerCase())
            ),
        [parties, search]
    );

    const handleDeleteParty = async (party: PartyRecord) => {
        if (!window.confirm(`Delete party ${party.name} (${party.id})?`)) return;
        try {
            await removeParty(party.id);
            toast({
                title: "Party removed",
                description: `${party.id} deactivated and opening balance removed from the general ledger.`,
            });
        } catch (e) {
            toast({
                title: "Delete failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Party Master</h1>
                        <p className="text-slate-500">Manage customers, vendors, and service providers.</p>
                    </div>
                    <div className="flex w-full sm:w-auto gap-2">
                        <div className="relative flex-1 sm:flex-none sm:w-[280px]">
                            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-500" />
                            <Input
                                className="pl-8"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by name, id, city..."
                            />
                        </div>
                        <Button variant="outline" className="shadow-sm">
                            <Filter className="h-4 w-4 mr-2" />
                            Filter Type
                        </Button>
                        <Button onClick={() => setIsAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 shadow-soft">
                            <Plus className="h-4 w-4 mr-2" />
                            Add Party
                        </Button>
                    </div>
                </div>

                <AddPartyModal open={isAddOpen} onOpenChange={setIsAddOpen} />
                <AddPartyModal
                    open={Boolean(editingParty)}
                    onOpenChange={(open) => {
                        if (!open) setEditingParty(null);
                    }}
                    mode="edit"
                    initialParty={editingParty}
                    onDone={() => setEditingParty(null)}
                />

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {visibleParties.map((party) => (
                        <Card key={party.id} className="shadow-soft border-slate-100 hover:shadow-medium transition-all group">
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                                        <Building className="h-5 w-5" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Badge variant="outline" className="bg-white">
                                            {party.type}
                                        </Badge>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-blue-600"
                                            onClick={() => setEditingParty(party)}
                                            title="Edit party"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-rose-600"
                                            onClick={() => void handleDeleteParty(party)}
                                            title="Delete party"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <CardTitle className="mt-3 text-base">{party.name}</CardTitle>
                                <CardDescription className="flex items-center gap-1 font-mono text-xs">
                                    {party.id}
                                </CardDescription>
                                <CardDescription className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" /> {party.city || "—"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-md">
                                        <div>
                                            <div className="text-slate-400">Receivable Anchor</div>
                                            <div className="font-semibold text-emerald-700">11201</div>
                                        </div>
                                        <div>
                                            <div className="text-slate-400">Payable Anchor</div>
                                            <div className="font-semibold text-blue-700">21101</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-md">
                                        <div>
                                            <div className="text-slate-400">Phone</div>
                                            <div className="font-semibold text-slate-700">{party.phone || "—"}</div>
                                        </div>
                                        <div>
                                            <div className="text-slate-400">Credit Limit</div>
                                            <div className="font-semibold text-slate-700">{party.creditLimit ?? 0}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-500 pt-2">
                                        <CreditCard className="h-4 w-4" />
                                        <span>
                                            {party.type === "Customer"
                                                ? "Customer ledger"
                                                : party.type === "Vendor"
                                                  ? "Vendor ledger"
                                                  : "Dual ledger (receivable + payable)"}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    {visibleParties.length === 0 && (
                        <Card className="shadow-soft border-slate-100 md:col-span-2 lg:col-span-3">
                            <CardContent className="py-10 text-center text-slate-500">
                                No parties found for your search.
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}
