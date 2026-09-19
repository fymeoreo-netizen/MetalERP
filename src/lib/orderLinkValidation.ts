export type LinkedInvoiceLine = {
    itemCode?: string;
    item?: string;
    netWeight?: number;
    rate?: number;
    salesOrderLineId?: string;
    purchaseOrderLineId?: string;
    orderItemCode?: string;
    orderRate?: number;
    orderedQty?: number;
};

export type OrderLinkValidationResult = {
    ok: boolean;
    errors: string[];
    rateWarnings: Array<{ itemLabel: string; orderRate: number; invoiceRate: number }>;
};

const RATE_EPSILON = 0.001;

function linkedLineId(line: LinkedInvoiceLine): string | undefined {
    return line.salesOrderLineId ?? line.purchaseOrderLineId;
}

function lineItemCode(line: LinkedInvoiceLine): string {
    return (line.itemCode ?? line.item ?? "").trim();
}

export function validateLinkedInvoiceLines(
    lines: LinkedInvoiceLine[],
    linkedOrderId: string | null | undefined
): OrderLinkValidationResult {
    const errors: string[] = [];
    const rateWarnings: OrderLinkValidationResult["rateWarnings"] = [];

    if (!linkedOrderId) {
        return { ok: true, errors, rateWarnings };
    }

    for (const line of lines) {
        const orderLineId = linkedLineId(line);
        const itemCode = lineItemCode(line);
        const orderItemCode = (line.orderItemCode ?? "").trim();
        const netWeight = Number(line.netWeight ?? 0);
        const orderedQty = Number(line.orderedQty ?? 0);
        const rate = Number(line.rate ?? 0);
        const orderRate = Number(line.orderRate ?? 0);

        if (netWeight > 0 && !orderLineId) {
            if (orderItemCode && itemCode && itemCode === orderItemCode) {
                continue;
            }
            errors.push(
                `${itemCode || orderItemCode || "Line"}: linked order requires an order line reference. Pull from the order or unlink before saving.`
            );
            continue;
        }

        if (!orderLineId) continue;

        if (orderItemCode && itemCode && itemCode !== orderItemCode) {
            errors.push(
                `Item ${itemCode} does not match order line item ${orderItemCode}. Unlink the order or remove this line.`
            );
        }

        if (netWeight > 0 && orderedQty > 0 && netWeight > orderedQty + 0.001) {
            errors.push(
                `${itemCode || orderItemCode}: invoice qty ${netWeight.toLocaleString()} kg exceeds remaining order qty ${orderedQty.toLocaleString()} kg.`
            );
        }

        if (
            netWeight > 0 &&
            orderRate > 0 &&
            Math.abs(rate - orderRate) > RATE_EPSILON
        ) {
            rateWarnings.push({
                itemLabel: itemCode || orderItemCode || "Line",
                orderRate,
                invoiceRate: rate,
            });
        }
    }

    return { ok: errors.length === 0, errors, rateWarnings };
}

export function formatRateWarningMessage(warnings: OrderLinkValidationResult["rateWarnings"]): string {
    return warnings
        .map(
            (w) =>
                `${w.itemLabel}: order rate ₨ ${w.orderRate.toLocaleString()} vs invoice rate ₨ ${w.invoiceRate.toLocaleString()}`
        )
        .join("\n");
}
