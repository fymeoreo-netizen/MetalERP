import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearSessionStorage, getAppSession, persistSessionPatch, type AppSession } from "@/lib/appSession";
import { prefetchCommonRoutesIdle } from "@/lib/routePrefetch";
import { canAccessPath as checkPathAccess, type AppRole } from "@/lib/roleAccess";
import { supabase } from "@/lib/supabase";

interface AppSessionContextValue extends AppSession {
    ready: boolean;
    role: AppRole;
    isAdmin: boolean;
    isAccountant: boolean;
    canViewAuditAttribution: boolean;
    canAccessPath: (pathname: string) => boolean;
    refresh: () => Promise<void>;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<AppSession>(() => getAppSession());
    const [ready, setReady] = useState(false);
    const [role, setRole] = useState<AppRole>(null);

    const refresh = useCallback(async () => {
        const next = getAppSession();
        try {
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) {
                next.userId = data.user.id;
                persistSessionPatch({ userId: data.user.id });
                try {
                    const [adminRole, accountantRole] = await Promise.all([
                        supabase.schema("erp").rpc("has_role", { p_role_code: "ADMIN" }),
                        supabase.schema("erp").rpc("has_role", { p_role_code: "ACCOUNTANT" }),
                    ]);
                    if (adminRole.data === true) {
                        setRole("admin");
                    } else if (accountantRole.data === true) {
                        setRole("accountant");
                    } else {
                        setRole(null);
                    }
                } catch (roleErr) {
                    console.warn("[ERP] role check failed", roleErr);
                    setRole(null);
                }

                next.tenantId = "single-company";
                next.branchId = "main-unit";
                persistSessionPatch({ tenantId: next.tenantId, branchId: next.branchId });
            } else {
                clearSessionStorage();
                next.userId = null;
                next.tenantId = "";
                next.branchId = "";
                setRole(null);
            }
        } catch (err) {
            console.warn("[ERP] session refresh failed", err);
            setRole(null);
        }
        setSession(next);
        setReady(true);
        if (next.userId) prefetchCommonRoutesIdle();
    }, []);

    const canAccessPath = useCallback(
        (pathname: string) => checkPathAccess(role, pathname),
        [role],
    );

    useEffect(() => {
        void refresh();
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
                clearSessionStorage();
                setSession({ tenantId: "", branchId: "", userId: null });
                setRole(null);
                setReady(true);
                return;
            }
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
                void refresh();
            }
        });
        return () => sub.subscription.unsubscribe();
    }, [refresh]);

    const value = useMemo<AppSessionContextValue>(
        () => ({
            ...session,
            ready,
            role,
            isAdmin: role === "admin",
            isAccountant: role === "accountant",
            canViewAuditAttribution: role === "admin" || role === "accountant",
            canAccessPath,
            refresh,
        }),
        [session, ready, role, refresh, canAccessPath]
    );

    return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
    const ctx = useContext(AppSessionContext);
    if (!ctx) throw new Error("useAppSession must be used within AppSessionProvider");
    return ctx;
}
