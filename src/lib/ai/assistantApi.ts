import { isErpLiveMode } from "@/lib/backendFlags";
import { supabase } from "@/lib/supabase";
import type { AssistantContext, AssistantResolveCandidate } from "@/lib/ai/tools";

export type ErpAssistantResponse = {
    ok: boolean;
    answer?: string;
    error?: string;
    tools_called?: string[];
    candidates?: AssistantResolveCandidate[];
};

function functionsBaseUrl(): string {
    const raw = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
    const base = raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
    return `${base}/functions/v1`;
}

export async function invokeErpAssistant(
    message: string,
    context?: AssistantContext,
): Promise<ErpAssistantResponse> {
    if (!isErpLiveMode()) {
        return {
            ok: false,
            error: "ERP Ask requires live mode. Sign in with Supabase configured.",
        };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
        return { ok: false, error: "Not signed in" };
    }

    const anonKey =
        (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
        (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
        "";

    const res = await fetch(`${functionsBaseUrl()}/erp-assistant`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
        },
        body: JSON.stringify({ message, context }),
    });

    const body = (await res.json().catch(() => ({}))) as ErpAssistantResponse;
    if (!res.ok || !body?.ok) {
        return {
            ok: false,
            error: body?.error || `Assistant request failed (${res.status})`,
        };
    }
    return body;
}

export async function fetchAssistantAllowedTools(): Promise<string[]> {
    if (!isErpLiveMode()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_erp_assistant_allowed_tools");
    if (error) {
        console.warn("[ERP] fn_erp_assistant_allowed_tools", error.message);
        return [];
    }
    if (Array.isArray(data)) return data as string[];
    return [];
}
