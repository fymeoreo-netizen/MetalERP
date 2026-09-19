const STORAGE_KEYS = {
    tenantId: "erp.company_id",
    branchId: "erp.primary_unit_id",
    userId: "erp.user_id",
};
const LEGACY_STORAGE_KEYS = {
    tenantId: "erp.tenant_id",
    branchId: "erp.branch_id",
};

export interface AppSession {
    tenantId: string;
    branchId: string;
    userId: string | null;
}

function readEnv(name: string): string | null {
    const v = (import.meta.env[name] as string | undefined)?.trim();
    return v ? v : null;
}

function readStored(name: keyof typeof STORAGE_KEYS): string | null {
    try {
        if (name === "userId") return localStorage.getItem(STORAGE_KEYS.userId);
        return localStorage.getItem(STORAGE_KEYS[name]) ?? localStorage.getItem(LEGACY_STORAGE_KEYS[name]);
    } catch {
        return null;
    }
}

export function persistSessionPatch(patch: Partial<AppSession>): void {
    try {
        if (patch.tenantId) {
            localStorage.setItem(STORAGE_KEYS.tenantId, patch.tenantId);
            localStorage.setItem(LEGACY_STORAGE_KEYS.tenantId, patch.tenantId);
        }
        if (patch.branchId) {
            localStorage.setItem(STORAGE_KEYS.branchId, patch.branchId);
            localStorage.setItem(LEGACY_STORAGE_KEYS.branchId, patch.branchId);
        }
        if (patch.userId) localStorage.setItem(STORAGE_KEYS.userId, patch.userId);
    } catch {
        // Ignore local storage quota/runtime errors.
    }
}

export function clearSessionStorage(): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.userId);
        localStorage.removeItem(STORAGE_KEYS.tenantId);
        localStorage.removeItem(STORAGE_KEYS.branchId);
        localStorage.removeItem(LEGACY_STORAGE_KEYS.tenantId);
        localStorage.removeItem(LEGACY_STORAGE_KEYS.branchId);
        // Clear cached app data that may contain business info / PII so it does not
        // survive logout on shared machines.
        localStorage.removeItem("erp_agent_debug_log");
        localStorage.removeItem("erp.party_document_letterhead");
        // Actively destroy the Supabase auth token(s) on the client so the JWT +
        // refresh token cannot be recovered from storage after logout. Supabase
        // persists them under keys like `sb-<ref>-auth-token`. We also clear any
        // legacy key. This runs in addition to supabase.auth.signOut().
        purgeSupabaseAuthTokens();
    } catch {
        // ignore
    }
}

/** Remove all Supabase-persisted auth tokens from browser storage. */
export function purgeSupabaseAuthTokens(): void {
    for (const store of [
        typeof localStorage !== "undefined" ? localStorage : null,
        typeof sessionStorage !== "undefined" ? sessionStorage : null,
    ]) {
        if (!store) continue;
        try {
            const keys: string[] = [];
            for (let i = 0; i < store.length; i++) {
                const key = store.key(i);
                if (!key) continue;
                if ((key.startsWith("sb-") && key.endsWith("-auth-token")) || key === "supabase.auth.token") {
                    keys.push(key);
                }
            }
            keys.forEach((k) => store.removeItem(k));
        } catch {
            // ignore storage access errors (private mode / quota)
        }
    }
}

export function getAppSession(): AppSession {
    // Single-company mode: tenant/branch are no longer required runtime context.
    const tenantId = readStored("tenantId") ?? "single-company";
    const branchId = readStored("branchId") ?? "main-unit";
    // userId is only ever set from a real Supabase session (see persistSessionPatch in the
    // auth flow). We intentionally do NOT honor a VITE_ERP_USER_ID build-time override, which
    // could make hasErpContext() report "signed in" with no JWT.
    const userId = readStored("userId");
    return { tenantId, branchId, userId };
}

export function hasErpContext(): boolean {
    const s = getAppSession();
    return Boolean(s.userId);
}

export function isSupabaseConfigured(): boolean {
    const url = readEnv("VITE_SUPABASE_URL");
    const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ?? readEnv("VITE_SUPABASE_ANON_KEY");
    return Boolean(url && key);
}
