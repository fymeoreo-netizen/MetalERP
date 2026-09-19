import { supabase } from "@/lib/supabase";
import { formatDbError } from "./core";

export function parseRpcJsonResult(data: unknown): {
    ok: boolean;
    error?: string;
    step?: string;
    linkedOrderLines?: number;
} {
    let parsed: unknown = data;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return { ok: true };
        }
    }
    if (parsed === true) return { ok: true };
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "Empty server response." };
    const row = parsed as Record<string, unknown>;
    const okVal = row.ok;
    const ok = okVal === true || okVal === "true";
    return {
        ok,
        error: typeof row.error === "string" ? row.error : undefined,
        step: typeof row.step === "string" ? row.step : undefined,
        linkedOrderLines:
            typeof row.linked_order_lines === "number"
                ? row.linked_order_lines
                : Number(row.linked_order_lines ?? NaN) || undefined,
    };
}

export type InvoiceDeleteFn =
    | "hard_delete_sales_invoice"
    | "hard_delete_purchase_invoice"
    | "admin_hard_delete_sales_invoice"
    | "admin_hard_delete_purchase_invoice"
    | "delete_purchase_invoice"
    | "void_sales_invoice"
    | "void_purchase_invoice";

export async function tryInvoiceDeleteRpc(fn: InvoiceDeleteFn, id: string): Promise<{
    ok: boolean;
    missing: boolean;
    data?: unknown;
    error?: string;
}> {
    const payloads: Array<Record<string, string | null>> = [
        { p_doc_id: id },
        { doc_id: id },
        { doc_id: id, p_reason: null },
    ];
    for (const payload of payloads) {
        const { data, error } = await supabase.schema("erp").rpc(fn, payload);
        if (!error) return { ok: true, missing: false, data };
        const msg = formatDbError(error, `Failed to execute ${fn}.`);
        if (
            /could not find the function|does not exist|schema cache|no function matches|could not choose the best candidate|PGRST20[23]/i.test(msg)
        ) {
            continue;
        }
        return { ok: false, missing: false, error: msg };
    }
    return { ok: false, missing: true, error: `Function ${fn} unavailable.` };
}
