/** Display label for GL rows: name first; code in separate column or subtitle. */
export function formatAccountRowLabel(name: string, code: string): string {
    const n = (name ?? "").trim();
    const c = (code ?? "").trim();
    if (n && n !== c) return n;
    return c || n || "—";
}

export function humanizeReportGroup(slug: string): string {
    if (!slug) return "Other";
    return slug
        .replace(/_/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export type ReportAccountRow = {
    code: string;
    name: string;
    amount: number;
    reportGroup?: string;
};

export function groupByReportGroup<T extends { reportGroup?: string }>(
    rows: T[],
): { group: string; items: T[] }[] {
    const map = new Map<string, T[]>();
    for (const row of rows) {
        const g = row.reportGroup ?? "other";
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(row);
    }
    return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, items]) => ({ group, items }));
}
