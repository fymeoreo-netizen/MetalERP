// @ts-nocheck Deno Edge Function (Supabase Edge Runtime). This file targets Deno,
// not the app's Node/browser TS config, so the bundler type-checker is disabled here.
// Type-checking is handled by the Deno language server / `deno check` instead.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ASSISTANT_TOOL_DECLARATIONS, SYSTEM_PROMPT } from "./tools.ts";
import { estimateResultBytes, sanitizeToolResult } from "./sanitize.ts";

function parseAllowedTools(data: unknown): string[] {
    if (Array.isArray(data)) return data as string[];
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
            return [];
        }
    }
    return [];
}

function inferToolHint(message: string, task?: string): string {
    if (task === "parchi_overdue_summary") {
        return (
            "\nTASK: Write a short professional overdue-parchi follow-up note for the party." +
            "\nPrimary source: the authoritative ledger snapshot in the user message (treat every amount/date as verified tool data)." +
            "\nOptionally enrich with get_party_balance / get_party_ledger using UI party_code, but never invent or alter snapshot figures." +
            "\nMust cover: recent payments, overdue parchis (amount + days late), sales without received parchi, open parchi total, closing balance, balance after parchi adjustment." +
            "\nTone: concise, factual, shareable with the party. No fluff."
        );
    }
    const m = message.toLowerCase();
    if (/(who posted|who created|who changed|who edited|attribution)/.test(m)) {
        return "\nRouting hint: call get_document_attribution with doc_no and doc_type.";
    }
    if (/(cashbook|voucher|payment\s+pay-|pay-\d)/.test(m)) {
        return "\nRouting hint: resolve_entity(kind=payment) then get_cashbook_payment.";
    }
    if (/(scrap trade|triangle|bilty)/.test(m)) {
        return "\nRouting hint: resolve_entity(kind=scrap_trade) or get_scrap_trade.";
    }
    if (/(payable|ap aging|we owe|accounts payable)/.test(m) && !/receivable/.test(m)) {
        return "\nRouting hint: resolve_entity(kind=party) then get_party_balance and get_ap_aging.";
    }
    if (/(last|latest|recent|most recent)/.test(m) && /(sales invoice|invoice)/.test(m)) {
        return "\nRouting hint: call get_recent_sales_invoices with limit=1.";
    }
    if (/(sales summary|total sales|sales total|how much sales)/.test(m)) {
        return "\nRouting hint: call get_sales_summary (this month unless user gave dates).";
    }
    if (/balance/.test(m) && !/trial/.test(m)) {
        return "\nRouting hint: resolve_entity(kind=party) then get_party_balance — never invent a party code.";
    }
    return "";
}

function serializeFacts(facts: unknown): string {
    try {
        const json = JSON.stringify(facts);
        // Keep prompt size bounded; snapshot is already curated on the client.
        return json.length > 24_000 ? json.slice(0, 24_000) + "…[truncated]" : json;
    } catch {
        return "{}";
    }
}

type ResolveCandidate = {
    kind?: string;
    code?: string;
    name?: string;
    score?: number;
};

function extractCandidates(toolResults: { name: string; response: unknown }[]): ResolveCandidate[] {
    const out: ResolveCandidate[] = [];
    for (const { name, response } of toolResults) {
        if (name !== "resolve_entity" && name !== "search_parties") continue;
        const root = response as { data?: Record<string, unknown> };
        const data = root?.data ?? root;
        if (!data || typeof data !== "object") continue;
        if (data.needs_disambiguation !== true) continue;
        const candidates = data.candidates;
        if (!Array.isArray(candidates)) continue;
        for (const c of candidates.slice(0, 8)) {
            if (c && typeof c === "object" && "code" in c) {
                out.push(c as ResolveCandidate);
            }
        }
    }
    return out;
}

// Restrict CORS to a configured app origin (first of comma-separated APP_ALLOWED_ORIGINS).
// Falls back to "*" only when unset, so existing deployments keep working until configured.
const ALLOWED_ORIGINS = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS[0] : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
};

const MAX_TOOL_ROUNDS = 5;
const MODEL = "gemini-2.5-flash";
const READ_CACHE_TTL_MS = 60_000;
const MAX_MESSAGE_LEN = 2000;

// Best-effort per-user throttle (per warm isolate); DB rate limit is authoritative.
const lastAssistantRunByUser = new Map<string, number>();
const ASSISTANT_MIN_INTERVAL_MS = 3_000;

const readToolCache = new Map<string, { at: number; value: unknown }>();

function cacheKey(userId: string, tool: string, args: Record<string, unknown>): string {
    return `${userId}:${tool}:${JSON.stringify(args)}`;
}

function getCachedRead(userId: string, tool: string, args: Record<string, unknown>): unknown | undefined {
    const key = cacheKey(userId, tool, args);
    const hit = readToolCache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > READ_CACHE_TTL_MS) {
        readToolCache.delete(key);
        return undefined;
    }
    return hit.value;
}

function setCachedRead(userId: string, tool: string, args: Record<string, unknown>, value: unknown): void {
    const readTools = new Set([
        "get_party_balance",
        "get_party_context",
        "get_recent_sales_invoices",
        "get_sales_summary",
        "resolve_entity",
    ]);
    if (!readTools.has(tool)) return;
    readToolCache.set(cacheKey(userId, tool, args), { at: Date.now(), value });
}

type ChatMessage = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiPart =
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: unknown } };

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
        if (!supabaseUrl || !anonKey) {
            return json({ ok: false, error: "Missing Supabase env" }, 500);
        }
        if (!geminiKey) {
            return json({ ok: false, error: "GEMINI_API_KEY not configured" }, 503);
        }

        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return json({ ok: false, error: "Unauthorized" }, 401);
        }

        const body = (await req.json()) as {
            message?: string;
            context?: {
                page?: string;
                party_code?: string;
                doc_no?: string;
                doc_type?: string;
                task?: string;
                facts?: Record<string, unknown>;
            };
        };
        const message = (body.message ?? "").trim().slice(0, MAX_MESSAGE_LEN);
        if (!message) {
            return json({ ok: false, error: "message is required" }, 400);
        }
        const task = body.context?.task?.trim() || undefined;
        const facts = body.context?.facts && typeof body.context.facts === "object"
            ? body.context.facts
            : undefined;

        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
            db: { schema: "erp" },
        });

        const { data: userData, error: userErr } = await userClient.auth.getUser();
        if (userErr || !userData.user) {
            return json({ ok: false, error: "Unauthorized" }, 401);
        }

        const [{ data: access }, { data: allowedTools }, { data: rateCheck }] = await Promise.all([
            userClient.rpc("fn_my_erp_access"),
            userClient.rpc("fn_erp_assistant_allowed_tools"),
            userClient.rpc("fn_erp_assistant_check_rate_limit", { p_max_per_hour: 30 }),
        ]);

        if (!access?.auth_uid) {
            return json({ ok: false, error: "No ERP access for this user" }, 403);
        }

        const rateObj = rateCheck as { ok?: boolean; error?: string } | null;
        if (rateObj && rateObj.ok === false) {
            return json({ ok: false, error: rateObj.error ?? "Rate limited" }, 429);
        }

        const nowMs = Date.now();
        const lastRun = lastAssistantRunByUser.get(userData.user.id) ?? 0;
        if (nowMs - lastRun < ASSISTANT_MIN_INTERVAL_MS) {
            return json({ ok: false, error: "Rate limited: please wait a moment and retry." }, 429);
        }
        lastAssistantRunByUser.set(userData.user.id, nowMs);

        const allowed = new Set<string>(parseAllowedTools(allowedTools));
        // Snapshot tasks already include full ledger/parchi facts — skip tools so a broken
        // tool cannot block the summary (model must write from the snapshot only).
        const useSnapshotOnly = task === "parchi_overdue_summary" && Boolean(facts);
        const toolDecls = useSnapshotOnly
            ? []
            : ASSISTANT_TOOL_DECLARATIONS.filter((t) => allowed.has(t.name));

        const contextHint = body.context
            ? `\n\nUI context: page=${body.context.page ?? ""}, party_code=${body.context.party_code ?? ""}, doc_no=${body.context.doc_no ?? ""}, doc_type=${body.context.doc_type ?? ""}, task=${task ?? ""}`
            : "";
        const toolHint = useSnapshotOnly
            ? (
                "\nTASK: Write a short professional overdue-parchi follow-up note for the party." +
                "\nUse ONLY the authoritative ledger snapshot in the user message (verified UI data)." +
                "\nDo not call tools. Do not invent or alter amounts." +
                "\nMust cover: recent payments, overdue parchis (amount + days late), sales without received parchi, open parchi total, closing balance, balance after parchi adjustment." +
                "\nTone: concise, factual, shareable with the party."
            )
            : inferToolHint(message, task);
        const forceToolsOnFirstRound = toolHint.length > 0 && !useSnapshotOnly && toolDecls.length > 0;

        const factsBlock = facts
            ? `\n\nAuthoritative ledger snapshot (verified UI data — treat like tool results; do not invent or alter amounts):\n${serializeFacts(facts)}`
            : "";

        const systemText = `${SYSTEM_PROMPT}${contextHint}${toolHint}`;
        const contents: ChatMessage[] = [
            {
                role: "user",
                parts: [{ text: `User question: ${message}${factsBlock}` }],
            },
        ];

        const toolsCalled: string[] = [];
        const allToolResults: { name: string; response: unknown }[] = [];
        let answer = "";

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const geminiRes = await callGemini(
                geminiKey,
                contents,
                toolDecls,
                round === 0 && toolDecls.length > 0 && forceToolsOnFirstRound,
                systemText,
            );
            if (!geminiRes.ok) {
                await logQuery(userClient, message, toolsCalled, body.context?.page, false, geminiRes.error, 0);
                return json({ ok: false, error: geminiRes.error }, 502);
            }

            const candidate = geminiRes.candidate;
            const parts = candidate?.content?.parts ?? [];
            const functionCalls = parts.filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
                Boolean((p as { functionCall?: unknown }).functionCall),
            );

            if (functionCalls.length === 0) {
                answer = parts
                    .map((p) => (p as { text?: string }).text ?? "")
                    .join("")
                    .trim();
                break;
            }

            contents.push({ role: "model", parts });

            const permittedCalls = functionCalls.filter((fc) => allowed.has(fc.functionCall.name));
            const blockedCalls = functionCalls.filter((fc) => !allowed.has(fc.functionCall.name));

            const toolResults = await Promise.all(
                permittedCalls.map(async (fc) => {
                    const name = fc.functionCall.name;
                    const args = fc.functionCall.args ?? {};
                    toolsCalled.push(name);
                    const cached = getCachedRead(userData.user.id, name, args);
                    if (cached !== undefined) {
                        const sanitized = sanitizeToolResult(name, cached);
                        allToolResults.push({ name, response: sanitized });
                        return { name, response: sanitized };
                    }
                    const raw = await executeTool(userClient, name, args);
                    const sanitized = sanitizeToolResult(name, raw);
                    setCachedRead(userData.user.id, name, args, sanitized);
                    allToolResults.push({ name, response: sanitized });
                    return { name, response: sanitized };
                }),
            );

            const responseParts: GeminiPart[] = [
                ...blockedCalls.map((fc) => ({
                    functionResponse: {
                        name: fc.functionCall.name,
                        response: { ok: false, error: `Tool not permitted: ${fc.functionCall.name}` },
                    },
                })),
                ...toolResults.map(({ name, response }) => ({
                    functionResponse: { name, response },
                })),
            ];

            contents.push({ role: "user", parts: responseParts });
        }

        if (!answer) {
            answer =
                "I could not complete an answer. Try rephrasing or ask about a specific party name, invoice number, or date range.";
        }

        const resultBytes = estimateResultBytes(allToolResults.map((r) => r.response));
        const candidates = extractCandidates(allToolResults);

        await logQuery(userClient, message, toolsCalled, body.context?.page, true, null, resultBytes);

        return json({
            ok: true,
            answer,
            tools_called: toolsCalled,
            candidates: candidates.length ? candidates : undefined,
            access: {
                is_admin: access.is_admin,
                is_accountant: access.is_accountant,
            },
        });
    } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
    }
});

async function executeTool(
    client: SupabaseClient,
    name: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    const { data, error } = await client.rpc("fn_erp_assistant_execute_tool", {
        p_tool: name,
        p_params: args,
    });
    if (error) {
        return { ok: false, error: error.message };
    }
    return data;
}

async function callGemini(
    apiKey: string,
    contents: ChatMessage[],
    tools: readonly (typeof ASSISTANT_TOOL_DECLARATIONS)[number][],
    forceToolUse = false,
    systemText = "",
): Promise<
    | { ok: true; candidate: { content?: { parts?: GeminiPart[] } } }
    | { ok: false; error: string }
> {
    const geminiContents = contents.map((c) => ({
        role: c.role,
        parts: c.parts.map((p) => {
            if ("text" in p && p.text !== undefined) return { text: p.text };
            if ("functionCall" in p) return { functionCall: p.functionCall };
            if ("functionResponse" in p) {
                return {
                    functionResponse: {
                        name: p.functionResponse.name,
                        response: { result: p.functionResponse.response },
                    },
                };
            }
            return { text: "" };
        }),
    }));

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: geminiContents,
                systemInstruction: systemText
                    ? { role: "system", parts: [{ text: systemText }] }
                    : undefined,
                tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
                toolConfig: tools.length
                    ? { functionCallingConfig: { mode: forceToolUse ? "ANY" : "AUTO" } }
                    : undefined,
                generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
            }),
        },
    );

    if (!res.ok) {
        const errText = await res.text();
        let detail = errText.slice(0, 300);
        try {
            const parsed = JSON.parse(errText) as { error?: { message?: string; code?: number } };
            if (parsed.error?.message) detail = parsed.error.message;
            if (res.status === 429) {
                return {
                    ok: false,
                    error: "Gemini API quota exceeded. Check billing at https://ai.google.dev or wait and retry.",
                };
            }
            if (res.status === 401 || res.status === 403) {
                return {
                    ok: false,
                    error: `Gemini API key rejected: ${detail}`,
                };
            }
        } catch {
            /* use raw slice */
        }
        return { ok: false, error: `Gemini error: ${detail}` };
    }

    const json = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const candidate = json.candidates?.[0];
    if (!candidate) {
        return { ok: false, error: "Empty Gemini response" };
    }
    return { ok: true, candidate };
}

async function logQuery(
    client: SupabaseClient,
    message: string,
    tools: string[],
    page: string | undefined,
    success: boolean,
    errorMessage: string | null,
    resultBytes: number,
) {
    const hash = await sha256Hex(message.toLowerCase().trim());
    await client.rpc("fn_erp_assistant_log", {
        p_question_hash: hash,
        p_tools_called: tools,
        p_context_page: page ?? null,
        p_success: success,
        p_error_message: errorMessage,
        p_result_bytes: resultBytes > 0 ? resultBytes : null,
    });
}

async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
