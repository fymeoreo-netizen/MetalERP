export type AppRole = "admin" | "accountant" | null;

/** Paths accountants cannot open (prefix match). All other staff routes are allowed. */
export const ACCOUNTANT_DENIED_PREFIXES = ["/admin", "/reports", "/inventory"] as const;

function normalizePath(pathname: string): string {
    const base = pathname.split("?")[0] ?? pathname;
    if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
    return base;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isAccountantDeniedPath(pathname: string): boolean {
    const path = normalizePath(pathname);
    return ACCOUNTANT_DENIED_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

export function canAccessPath(role: AppRole, pathname: string): boolean {
    if (!role) return false;
    if (role === "admin") return true;
    if (role === "accountant") return !isAccountantDeniedPath(pathname);
    return false;
}

export function getDefaultPathForRole(_role: AppRole): string {
    return "/dashboard";
}
