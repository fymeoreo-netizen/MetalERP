import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function resolveCors(req: Request): Record<string, string> {
    const allowList = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const origin = req.headers.get("Origin") ?? "";
    const allowOrigin = allowList.length === 0
        ? "*"
        : (allowList.includes(origin) ? origin : allowList[0]);
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Vary": "Origin",
    };
}

const lastRunByUser = new Map<string, number>();
const SYNC_COOLDOWN_MS = 30_000;
const POUNDS_PER_METRIC_TONNE = 2204.62262185;

Deno.serve(async (req) => {
    const corsHeaders = resolveCors(req);
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        if (!supabaseUrl || !serviceKey) {
            return json({ ok: false, error: "Missing Supabase environment" }, 500, corsHeaders);
        }

        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return json({ ok: false, error: "Unauthorized" }, 401, corsHeaders);
        }

        const userClient = createClient(
            supabaseUrl,
            Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey,
            {
                global: { headers: { Authorization: authHeader } },
                db: { schema: "erp" },
            },
        );
        const { data: userData, error: userError } = await userClient.auth.getUser();
        if (userError || !userData.user) {
            return json({ ok: false, error: "Unauthorized" }, 401, corsHeaders);
        }

        const { data: isAdmin, error: roleError } = await userClient.rpc("has_role", {
            p_role_code: "ADMIN",
        });
        if (roleError || isAdmin !== true) {
            return json({ ok: false, error: "Forbidden: admin role required" }, 403, corsHeaders);
        }

        const now = Date.now();
        const last = lastRunByUser.get(userData.user.id) ?? 0;
        if (now - last < SYNC_COOLDOWN_MS) {
            return json({ ok: false, error: "Rate limited: try again shortly" }, 429, corsHeaders);
        }
        lastRunByUser.set(userData.user.id, now);

        const admin = createClient(supabaseUrl, serviceKey, { db: { schema: "erp" } });
        const messages: string[] = [];
        let syncedFeeds = 0;

        try {
            const fxRes = await fetch("https://open.er-api.com/v6/latest/USD", {
                headers: { "Accept": "application/json" },
            });
            if (!fxRes.ok) {
                messages.push(`FX provider failed (${fxRes.status})`);
            } else {
                const fxJson = await fxRes.json() as {
                    rates?: { PKR?: number };
                    time_last_update_utc?: string;
                };
                const pkr = fxJson.rates?.PKR;
                if (!pkr || pkr <= 0) {
                    messages.push("USD/PKR unavailable from provider");
                } else {
                    const { error } = await admin.rpc("fn_market_insert_quote", {
                        p_symbol: "USD_PKR",
                        p_value: pkr,
                        p_currency: "PKR",
                        p_source: "api",
                        p_raw: {
                            provider: "ExchangeRate-API open feed",
                            time_last_update_utc: fxJson.time_last_update_utc,
                        },
                    });
                    if (error) throw error;
                    syncedFeeds += 1;
                    messages.push(`USD/PKR ${pkr.toFixed(4)}`);
                }
            }
        } catch (error) {
            messages.push(`FX error: ${String(error)}`);
        }

        try {
            const copperRes = await fetch(
                "https://query1.finance.yahoo.com/v8/finance/chart/HG%3DF?range=5d&interval=1d",
                {
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": "CopperSync-ERP/1.0",
                    },
                },
            );
            if (!copperRes.ok) {
                messages.push(`Copper provider failed (${copperRes.status})`);
            } else {
                const copperJson = await copperRes.json() as {
                    chart?: {
                        result?: Array<{
                            meta?: { regularMarketPrice?: number; symbol?: string };
                            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
                        }>;
                    };
                };
                const result = copperJson.chart?.result?.[0];
                const closes = result?.indicators?.quote?.[0]?.close ?? [];
                const latestClose = [...closes]
                    .reverse()
                    .find((value) => typeof value === "number" && value > 0);
                const usdPerLb = result?.meta?.regularMarketPrice ?? latestClose;

                if (!usdPerLb || usdPerLb <= 0) {
                    messages.push("Copper quote unavailable from provider");
                } else {
                    const usdPerTonne = Math.round(usdPerLb * POUNDS_PER_METRIC_TONNE * 100) / 100;
                    const { error } = await admin.rpc("fn_market_insert_quote", {
                        p_symbol: "LME_COPPER_USD_T",
                        p_value: usdPerTonne,
                        p_currency: "USD",
                        p_source: "api",
                        p_raw: {
                            provider: "Yahoo Finance",
                            provider_symbol: result?.meta?.symbol ?? "HG=F",
                            source_unit: "USD/lb",
                            source_value: usdPerLb,
                            converted_unit: "USD/metric tonne",
                        },
                    });
                    if (error) throw error;
                    syncedFeeds += 1;
                    messages.push(`Copper benchmark $${usdPerTonne.toFixed(2)}/t`);
                }
            }
        } catch (error) {
            messages.push(`Copper error: ${String(error)}`);
        }

        const status = messages.join("; ");
        await admin.rpc("fn_market_record_sync_status", { p_status: status });

        return json(
            { ok: syncedFeeds > 0, message: status },
            syncedFeeds > 0 ? 200 : 502,
            corsHeaders,
        );
    } catch (error) {
        return json({ ok: false, error: String(error) }, 500, resolveCors(req));
    }
});

function json(body: Record<string, unknown>, status = 200, corsHeaders: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
