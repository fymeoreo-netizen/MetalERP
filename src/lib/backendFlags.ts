import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { useAppSession } from "@/contexts/AppSessionContext";

const readBoolEnv = (raw: string | undefined, fallback: boolean): boolean => {
    if (!raw) return fallback;
    const v = raw.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
    return fallback;
};

export function useBackendLiveMode(): boolean {
    const { ready, userId } = useAppSession();
    if (!ready || !userId) return false;
    return isErpLiveMode();
}

/** Non-hook live-mode check — use in reports and data loaders. */
export function isErpLiveMode(): boolean {
    if (!isSupabaseConfigured() || !hasErpContext()) return false;
    const forceDemo = readBoolEnv(import.meta.env.VITE_FORCE_DEMO_MODE, false);
    return !forceDemo;
}

