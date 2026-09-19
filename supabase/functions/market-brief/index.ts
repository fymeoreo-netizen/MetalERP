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
const BRIEF_COOLDOWN_MS = 30_000;

Deno.serve(async (req) => {
    const corsHeaders = resolveCors(req);
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
        const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

        if (!supabaseUrl || !serviceKey) {
            return json({ ok: false, error: "Missing Supabase environment" }, 500, corsHeaders);
        }
        if (!openRouterKey && !geminiKey) {
            return json({ ok: false, error: "OPENROUTER_API_KEY not configured" }, 503, corsHeaders);
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
        if (now - last < BRIEF_COOLDOWN_MS) {
            return json({ ok: false, error: "Rate limited: try again shortly" }, 429, corsHeaders);
        }
        lastRunByUser.set(userData.user.id, now);

        const admin = createClient(supabaseUrl, serviceKey, { db: { schema: "erp" } });
        const [settingsResult, quotesResult, contextResult] = await Promise.all([
            admin.rpc("fn_market_get_settings"),
            admin.rpc("fn_market_latest_quotes"),
            admin.rpc("fn_market_erp_context", { p_days: 7 }),
        ]);

        if (settingsResult.error || quotesResult.error || contextResult.error) {
            return json({ ok: false, error: "Could not load the market snapshot" }, 500, corsHeaders);
        }
        if (settingsResult.data?.ai_brief_enabled === false) {
            return json({ ok: false, error: "AI brief disabled in settings" }, 400, corsHeaders);
        }

        const snapshot: Record<string, unknown> = {
            quotes: quotesResult.data,
            erp_context: contextResult.data,
            settings: settingsResult.data,
        };
        const today = new Date().toISOString().slice(0, 10);
        const prompt = `You are the procurement market analyst for a copper wire and enameled-wire manufacturer in Pakistan.
Today is ${today}.

Use the ERP snapshot below as the numerical source of truth. Add only relevant current market drivers when web search is available, and cite those sources with markdown links. Never invent a quote, percentage, ERP value, or event. Clearly label the copper quote as a COMEX futures benchmark rather than official LME cash copper. If information is missing or stale, say so.

Write a concise decision brief in markdown with these headings:
## Market position
## ERP exposure
## Procurement action

Include 3 to 5 short action bullets. Finish with exactly one line in this form:
SIGNAL: BUY
The allowed signals are BUY, HOLD, or CAUTION.

ERP snapshot:
${JSON.stringify(snapshot, null, 2)}`;

        let responseText = "";
        let model = "";
        let provider = "";

        if (openRouterKey) {
            model = Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";
            provider = "OpenRouter";
            const modelResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": Deno.env.get("APP_PUBLIC_URL") ?? supabaseUrl,
                    "X-Title": "CopperSync ERP Market Intelligence",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: "system",
                            content: "Produce evidence-based copper procurement briefs. ERP values must never be altered. Check every numerical comparison. Do not state an external market driver unless that sentence contains a supporting markdown link. Missing ERP activity is uncertainty, not evidence for a buy signal.",
                        },
                        { role: "user", content: prompt },
                    ],
                    plugins: [{ id: "web", max_results: 4 }],
                    temperature: 0.25,
                    max_tokens: 1400,
                }),
            });

            if (!modelResponse.ok) {
                const errorText = await modelResponse.text();
                return json(
                    {
                        ok: false,
                        error: `OpenRouter error (${modelResponse.status}): ${errorText.slice(0, 300)}`,
                    },
                    502,
                    corsHeaders,
                );
            }

            const responseJson = await modelResponse.json() as {
                model?: string;
                choices?: Array<{
                    message?: {
                        content?: string | Array<{ text?: string }>;
                        annotations?: unknown[];
                    };
                }>;
            };
            const content = responseJson.choices?.[0]?.message?.content;
            responseText = typeof content === "string"
                ? content
                : (content ?? []).map((part) => part.text ?? "").join("");
            model = responseJson.model ?? model;
            snapshot.ai_provider = provider;
            snapshot.web_annotations = responseJson.choices?.[0]?.message?.annotations ?? [];
        } else {
            model = "gemini-2.5-flash";
            provider = "Gemini fallback";
            const modelResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": geminiKey,
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.25, maxOutputTokens: 1400 },
                    }),
                },
            );

            if (!modelResponse.ok) {
                const errorText = await modelResponse.text();
                return json(
                    { ok: false, error: `Gemini fallback error: ${errorText.slice(0, 300)}` },
                    502,
                    corsHeaders,
                );
            }

            const responseJson = await modelResponse.json() as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            responseText = responseJson.candidates?.[0]?.content?.parts
                ?.map((part) => part.text ?? "")
                .join("") ?? "";
            snapshot.ai_provider = provider;
        }

        if (!responseText.trim()) {
            return json({ ok: false, error: `Empty ${provider} response` }, 502, corsHeaders);
        }

        const signalMatch = responseText.match(/SIGNAL:\s*(BUY|HOLD|CAUTION)\s*$/im);
        const signal = signalMatch
            ? (signalMatch[1].toLowerCase() as "buy" | "hold" | "caution")
            : "hold";
        const briefText = responseText
            .replace(/\n?SIGNAL:\s*(BUY|HOLD|CAUTION)\s*$/im, "")
            .trim();

        const { error: insertError } = await admin.rpc("fn_market_insert_brief", {
            p_brief_date: today,
            p_content_md: briefText,
            p_signal: signal,
            p_model: model,
            p_snapshot: snapshot,
        });
        if (insertError) {
            return json({ ok: false, error: "Brief generated but could not be saved" }, 500, corsHeaders);
        }

        return json(
            { ok: true, message: `Brief generated with ${provider}`, model },
            200,
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
