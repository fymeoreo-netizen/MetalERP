import { supabase } from "@/lib/supabase";

/** Company letterhead + print helpers for all ERP reports. */
export const REPORT_COMPANY = {
    name: "CopperSync Manufacturing",
    monogram: "CS",
    addressLine: "42 Industrial Estate, Gujranwala, Pakistan",
    contactLine: "Phone: +92 300 1234567 | NTN: 1234567-8",
    footerNote: "Confidential — For internal management use only.",
} as const;

export type ReportPrintMetaItem = {
    label: string;
    value: string;
};

let cachedPrintedBy: string | null = null;

/** Resolve display name for letterhead (cached per session). */
export async function resolveReportPrintedBy(): Promise<string> {
    if (cachedPrintedBy) return cachedPrintedBy;
    try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        const fromMeta =
            (user?.user_metadata?.full_name as string | undefined) ??
            (user?.user_metadata?.name as string | undefined);
        const email = user?.email;
        cachedPrintedBy = fromMeta?.trim() || email?.split("@")[0] || "Authorized User";
    } catch {
        cachedPrintedBy = "Authorized User";
    }
    return cachedPrintedBy;
}

/** Opens the browser print dialog (Save as PDF). */
export function printReport(): void {
    if (typeof window === "undefined") return;

    const source = document.querySelector<HTMLElement>(".report-print-document");
    if (source) {
        printHtmlElementInIframe(source);
        return;
    }

    printFullPage();
}

/** Fallback: print entire page with print-only body class. */
function printFullPage(): void {
    document.body.classList.add("erp-printing");
    const cleanup = () => {
        document.body.classList.remove("erp-printing");
        window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
}

/**
 * Print only the given element in an isolated iframe.
 * Avoids popup blockers and waits for stylesheets before opening the print dialog.
 */
export function printHtmlElementInIframe(source: HTMLElement): void {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "Print preview");
    Object.assign(iframe.style, {
        position: "fixed",
        right: "0",
        bottom: "0",
        width: "0",
        height: "0",
        border: "0",
        opacity: "0",
        pointerEvents: "none",
    });
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
        document.body.removeChild(iframe);
        printFullPage();
        return;
    }

    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body class="erp-printing"></body></html>');
    doc.close();

    const pageStyle = doc.createElement("style");
    pageStyle.textContent = "@page { size: A4; margin: 14mm; } body { margin: 0; background: #fff; }";
    doc.head.appendChild(pageStyle);

    const styleLoads: Promise<void>[] = [];
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        if (node instanceof HTMLLinkElement && node.href) {
            const link = doc.createElement("link");
            link.rel = "stylesheet";
            link.href = node.href;
            styleLoads.push(
                new Promise((resolve) => {
                    link.onload = () => resolve();
                    link.onerror = () => resolve();
                }),
            );
            doc.head.appendChild(link);
        } else {
            doc.head.appendChild(node.cloneNode(true));
        }
    });

    doc.body.appendChild(source.cloneNode(true));

    const runPrint = () => {
        win.focus();
        win.print();
        const removeFrame = () => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        };
        win.addEventListener("afterprint", removeFrame, { once: true });
        // Fallback if afterprint never fires (some browsers)
        setTimeout(removeFrame, 3000);
    };

    const schedulePrint = () => requestAnimationFrame(() => requestAnimationFrame(runPrint));

    if (styleLoads.length === 0) {
        schedulePrint();
    } else {
        void Promise.all(styleLoads).then(schedulePrint);
    }
}

export function formatReportPeriod(from?: string, to?: string): string | undefined {
    if (!from || !to) return undefined;
    try {
        const f = new Date(from);
        const t = new Date(to);
        if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return `${from} – ${to}`;
        return `${f.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – ${t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
    } catch {
        return `${from} – ${to}`;
    }
}

export function formatReportAsOf(asOf?: string): string | undefined {
    if (!asOf) return undefined;
    try {
        const d = new Date(asOf);
        if (Number.isNaN(d.getTime())) return asOf;
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
        return asOf;
    }
}

export function formatReportAmount(n: number, opts?: { showZero?: boolean }): string {
    if (!opts?.showZero && n === 0) return "—";
    const prefix = n < 0 ? "−₨ " : "₨ ";
    return `${prefix}${Math.abs(n).toLocaleString()}`;
}
