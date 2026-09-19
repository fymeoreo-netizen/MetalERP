import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { MarketHistoryChart } from "@/components/market/MarketHistoryChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsScroller } from "@/components/ui/responsive-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppSession } from "@/contexts/AppSessionContext";
import { useMarketHistory, useMarketQuotes, formatChangePct, formatQuoteValue } from "@/hooks/useMarketData";
import {
    fetchMarketErpContext,
    fetchMarketLatestBrief,
    fetchMarketSettings,
    invokeMarketBrief,
    invokeMarketSync,
    updateMarketSettings,
    upsertMarketManualOverride,
    type MarketBrief,
    type MarketErpContext,
    type MarketQuoteRow,
    type MarketSettings,
} from "@/lib/repositories/marketRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { parseMarketBriefSections, summarizeMarketBrief } from "@/lib/marketBrief";
import { ArrowDown, ArrowUp, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function MarketIntelligence() {
    const { isAdmin } = useAppSession();
    const live = isErpLiveMode();
    const { byCode, loading, error: quotesError, reload } = useMarketQuotes();
    const copperHistory = useMarketHistory("LME_COPPER_USD_T", 30);
    const [erpCtx, setErpCtx] = useState<MarketErpContext | null>(null);
    const [settings, setSettings] = useState<MarketSettings | null>(null);
    const [brief, setBrief] = useState<MarketBrief | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [briefing, setBriefing] = useState(false);
    const [manualScrap, setManualScrap] = useState("");
    const [convFactor, setConvFactor] = useState("1");
    const [localPremium, setLocalPremium] = useState("0");

    const loadExtras = useCallback(async () => {
        const [ctx, nextSettings, latestBrief] = await Promise.all([
            fetchMarketErpContext(7),
            fetchMarketSettings(),
            fetchMarketLatestBrief(),
        ]);
        setErpCtx(ctx);
        setSettings(nextSettings);
        setBrief(latestBrief);
        setConvFactor(String(nextSettings.conversion_factor ?? 1));
        setLocalPremium(String(nextSettings.local_premium_pkr ?? 0));
    }, []);

    useEffect(() => {
        void loadExtras();
    }, [loadExtras]);

    const copper = byCode("LME_COPPER_USD_T");
    const fx = byCode("USD_PKR");
    const implied = byCode("IMPLIED_COPPER_PKR_KG");

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await invokeMarketSync();
            if (!result.ok) toast.error(result.message ?? "Sync failed");
            else {
                toast.success(result.message ?? "Market data synced");
                await reload();
                await loadExtras();
            }
        } finally {
            setSyncing(false);
        }
    };

    const handleBrief = async () => {
        setBriefing(true);
        try {
            const result = await invokeMarketBrief();
            if (!result.ok) toast.error(result.message ?? "Brief failed");
            else {
                toast.success("Brief generated");
                setBrief(await fetchMarketLatestBrief());
            }
        } finally {
            setBriefing(false);
        }
    };

    const saveSettings = async () => {
        try {
            const nextSettings = await updateMarketSettings({
                conversion_factor: Number(convFactor) || 1,
                local_premium_pkr: Number(localPremium) || 0,
            });
            setSettings(nextSettings);
            toast.success("Settings saved");
            await reload();
            await loadExtras();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Save failed");
        }
    };

    const saveManualScrap = async () => {
        const value = Number(manualScrap);
        if (!value || value <= 0) {
            toast.error("Enter a valid PKR/kg rate");
            return;
        }
        try {
            await upsertMarketManualOverride("LOCAL_SCRAP_PKR_KG", value);
            toast.success("Local scrap override saved");
            setManualScrap("");
            await reload();
            await loadExtras();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Save failed");
        }
    };

    return (
        <DashboardLayout>
            <div className="mx-auto max-w-7xl space-y-7 text-black">
                <header className="flex flex-col justify-between gap-4 border-b border-black pb-5 sm:flex-row sm:items-end">
                    <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">Procurement</p>
                        <h1 className="text-2xl font-semibold">Market Intelligence</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {!live && <Badge variant="outline" className="rounded border-black text-black">Demo</Badge>}
                        {isAdmin && (
                            <Button variant="outline" size="sm" className="border-black" onClick={() => void handleSync()} disabled={syncing}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                                Sync feeds
                            </Button>
                        )}
                    </div>
                </header>

                {quotesError && (
                    <div className="border border-black px-4 py-3 text-sm">Market data unavailable: {quotesError}</div>
                )}

                <section className="grid border-y border-black sm:grid-cols-3 sm:divide-x sm:divide-black">
                    <QuoteMetric label="COMEX copper" quote={copper} loading={loading} />
                    <QuoteMetric label="USD / PKR" quote={fx} loading={loading} />
                    <QuoteMetric label="Implied copper" quote={implied} loading={loading} />
                </section>

                <Tabs defaultValue="overview">
                    <TabsScroller>
                        <TabsList className="h-10 rounded-none border-b border-neutral-300 bg-white p-0">
                            <TabsTrigger value="overview" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-black data-[state=active]:bg-white data-[state=active]:shadow-none">Overview</TabsTrigger>
                            <TabsTrigger value="erp" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-black data-[state=active]:bg-white data-[state=active]:shadow-none">ERP context</TabsTrigger>
                            {isAdmin && <TabsTrigger value="admin" className="h-10 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-black data-[state=active]:bg-white data-[state=active]:shadow-none">Settings</TabsTrigger>}
                        </TabsList>
                    </TabsScroller>

                    <TabsContent value="overview" className="mt-6">
                        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
                            <section>
                                <div className="mb-5 flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-sm font-semibold">30-day copper movement</h2>
                                        <p className="mt-1 text-xs text-neutral-500">COMEX futures benchmark in USD per metric tonne</p>
                                    </div>
                                    {settings?.last_sync_at && (
                                        <span className="text-right text-[11px] text-neutral-500">
                                            Updated {new Date(settings.last_sync_at).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                                <MarketHistoryChart data={copperHistory.chartData} loading={copperHistory.loading} stroke="#000000" />
                            </section>

                            <section className="border-t border-black pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                                <div className="mb-5 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold">Market brief</h2>
                                        <SignalBadge signal={brief?.signal} />
                                    </div>
                                    {isAdmin && (
                                        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={() => void handleBrief()} disabled={briefing || !live}>
                                            <Sparkles className="mr-2 h-4 w-4" />
                                            {briefing ? "Generating..." : "Generate"}
                                        </Button>
                                    )}
                                </div>
                                {brief ? (
                                    <div className="space-y-5">
                                        {parseMarketBriefSections(brief.content_md).map((section) => (
                                            <div key={section.title}>
                                                <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500">{section.title}</h3>
                                                <BriefBody body={section.body} />
                                            </div>
                                        ))}
                                        <p className="border-t border-neutral-200 pt-3 text-[11px] text-neutral-500">
                                            {new Date(brief.created_at).toLocaleString()} | {brief.model ?? "OpenRouter"}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-neutral-500">No brief available.</p>
                                )}
                            </section>
                        </div>
                    </TabsContent>

                    <TabsContent value="erp" className="mt-6">
                        <section>
                            <div className="mb-5">
                                <h2 className="text-sm font-semibold">ERP price context</h2>
                                <p className="mt-1 text-xs text-neutral-500">Premium invoices and scrap activity from the last {erpCtx?.days ?? 7} days</p>
                            </div>
                            <div className="grid border-y border-black sm:grid-cols-2 lg:grid-cols-4">
                                <Stat label="Implied PKR/kg" value={erpCtx?.implied_pkr_per_kg} />
                                <Stat label="Average reference scrap" value={erpCtx?.premium_ref_scrap_avg} />
                                <Stat label="Spread vs implied" value={erpCtx?.spread_vs_implied} />
                                <Stat label="Premium invoices" value={erpCtx?.premium_invoice_count} integer />
                                <Stat label="Suggested low" value={erpCtx?.suggested_ref_scrap_low} />
                                <Stat label="Suggested high" value={erpCtx?.suggested_ref_scrap_high} />
                                <Stat label="Average scrap lot" value={erpCtx?.avg_scrap_lot_rate} />
                            </div>
                        </section>
                    </TabsContent>

                    {isAdmin && (
                        <TabsContent value="admin" className="mt-6">
                            <div className="grid gap-10 lg:grid-cols-2">
                                <section>
                                    <h2 className="text-sm font-semibold">Implied price formula</h2>
                                    <p className="mt-1 text-xs text-neutral-500">Benchmark USD/t / 1,000 x USD/PKR x factor + local premium</p>
                                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                                        <div>
                                            <Label htmlFor="conversion-factor">Conversion factor</Label>
                                            <Input id="conversion-factor" className="mt-1 border-black" value={convFactor} onChange={(event) => setConvFactor(event.target.value)} />
                                        </div>
                                        <div>
                                            <Label htmlFor="local-premium">Local premium (PKR/kg)</Label>
                                            <Input id="local-premium" className="mt-1 border-black" value={localPremium} onChange={(event) => setLocalPremium(event.target.value)} />
                                        </div>
                                    </div>
                                    <Button className="mt-4 bg-black text-white hover:bg-neutral-800" onClick={() => void saveSettings()}>Save settings</Button>
                                </section>
                                <section className="border-t border-black pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                                    <h2 className="text-sm font-semibold">Manual local scrap override</h2>
                                    <p className="mt-1 text-xs text-neutral-500">Enter the current local rate in PKR/kg.</p>
                                    <div className="mt-5 flex max-w-md gap-2">
                                        <Input type="number" className="border-black" placeholder="PKR/kg" value={manualScrap} onChange={(event) => setManualScrap(event.target.value)} />
                                        <Button className="bg-black text-white hover:bg-neutral-800" onClick={() => void saveManualScrap()}>Save</Button>
                                    </div>
                                </section>
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
            </div>
        </DashboardLayout>
    );
}

function QuoteMetric({ label, quote, loading }: { label: string; quote?: MarketQuoteRow; loading: boolean }) {
    const change = formatChangePct(quote?.change_1d_pct);
    return (
        <div className="min-w-0 px-4 py-5">
            <p className="text-xs font-medium text-neutral-500">{label}</p>
            <p className="mt-2 truncate text-2xl font-semibold">{loading ? "..." : formatQuoteValue(quote)}</p>
            <div className="mt-1 flex h-4 items-center gap-1 text-xs text-neutral-500">
                {change.up === true && <ArrowUp className="h-3 w-3" />}
                {change.up === false && <ArrowDown className="h-3 w-3" />}
                <span>{change.text}</span>
            </div>
        </div>
    );
}

function SignalBadge({ signal }: { signal?: string | null }) {
    if (!signal) return null;
    return <Badge variant="outline" className="rounded border-black bg-white text-[10px] uppercase text-black">{signal}</Badge>;
}

function BriefBody({ body }: { body: string }) {
    return (
        <div className="space-y-2 text-sm leading-6 text-neutral-700">
            {body.split(/\r?\n/).filter(Boolean).map((line, index) => {
                const bullet = /^[-*]\s+/.test(line);
                const clean = summarizeMarketBrief(line.replace(/^[-*]\s+/, ""), 1_000);
                return bullet
                    ? <div key={index} className="flex gap-2"><span aria-hidden="true">-</span><p>{clean}</p></div>
                    : <p key={index}>{clean}</p>;
            })}
        </div>
    );
}

function Stat({ label, value, integer }: { label: string; value?: number | null; integer?: boolean }) {
    const display = value == null || Number.isNaN(value)
        ? "-"
        : integer
          ? Math.round(value).toLocaleString()
          : `PKR ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return (
        <div className="border-b border-neutral-300 px-4 py-5">
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-1 text-lg font-semibold">{display}</p>
        </div>
    );
}
