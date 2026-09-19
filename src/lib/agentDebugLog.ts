const STORAGE_KEY = "erp_agent_debug_log";
const MAX_ENTRIES = 80;

export function agentDebugLog(
    location: string,
    message: string,
    data: Record<string, unknown>,
    hypothesisId?: string,
): void {
    const entry = { location, message, data, hypothesisId, timestamp: Date.now() };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const arr: unknown[] = raw ? JSON.parse(raw) : [];
        arr.push(entry);
        if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
        // ignore quota errors
    }
    if (import.meta.env.DEV) {
        console.warn("[ERP-DEBUG]", message, location, data);
    }
}

export function readAgentDebugLog(): unknown[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}
