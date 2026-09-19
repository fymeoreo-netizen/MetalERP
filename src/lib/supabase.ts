import { createClient } from "@supabase/supabase-js";

const supabaseAnonKey = (
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
    ""
).trim();

function projectRefFromJwt(token: string | undefined): string | null {
    if (!token || !token.includes(".")) return null;
    try {
        const payload = token.split(".")[1];
        if (!payload) return null;
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const decoded = atob(normalized);
        const parsed = JSON.parse(decoded) as { ref?: string };
        return parsed.ref ?? null;
    } catch {
        return null;
    }
}

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const envUrl = rawSupabaseUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
const refFromKey = projectRefFromJwt(supabaseAnonKey);
const derivedUrl = refFromKey ? `https://${refFromKey}.supabase.co` : "";

// Prefer URL derived from anon JWT ref to avoid hostname typos in .env.
const supabaseUrl = derivedUrl || envUrl;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase client is not configured. Check VITE_SUPABASE_URL and key.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Persist across reloads but auto-refresh so short access-token TTLs are
        // practical, and rotate/refresh tokens rather than holding a long-lived JWT.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // PKCE avoids exposing tokens in the URL fragment for OAuth/magic-link flows.
        flowType: "pkce",
    },
    global: {
        headers: {
            apikey: supabaseAnonKey,
        },
    },
});
