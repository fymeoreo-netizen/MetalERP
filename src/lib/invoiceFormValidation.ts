import {
    formatRateWarningMessage,
    type LinkedInvoiceLine,
    validateLinkedInvoiceLines,
} from "@/lib/orderLinkValidation";

export type InvoiceFormIssues = {
    errors: string[];
    warnings: string[];
};

export function collectInvoiceFormIssues(params: {
    partyId: string;
    partyLabel: "Customer" | "Supplier";
    lines: LinkedInvoiceLine[];
    linkedOrderId: string | null | undefined;
    forPost: boolean;
    /** Purchase invoice advance settlement — no line items required */
    skipLineChecks?: boolean;
}): InvoiceFormIssues {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!params.partyId?.trim()) {
        errors.push(`Select a ${params.partyLabel.toLowerCase()} before saving.`);
    }

    if (params.skipLineChecks) {
        return { errors, warnings };
    }

    const billable = params.lines.filter((l) => lineItemCode(l) && Number(l.netWeight ?? 0) > 0);
    const weightWithoutItem = params.lines.filter((l) => !lineItemCode(l) && Number(l.netWeight ?? 0) > 0);
    for (const line of weightWithoutItem) {
        errors.push("A line has weight entered but no item selected.");
    }

    const itemWithoutWeight = params.lines.filter((l) => lineItemCode(l) && Number(l.netWeight ?? 0) <= 0);
    if (params.forPost) {
        if (billable.length === 0) {
            errors.push("Add at least one line with an item and net weight (gross − tare) before posting.");
        } else if (itemWithoutWeight.length > 0) {
            warnings.push(
                `${itemWithoutWeight.length} line(s) have an item selected but no weight yet — they will not be posted.`,
            );
        }
    }

    const linkLines = params.forPost
        ? billable
        : params.lines.filter((l) => lineItemCode(l) || Number(l.netWeight ?? 0) > 0);
    const linkValidation = validateLinkedInvoiceLines(linkLines, params.linkedOrderId);
    errors.push(...linkValidation.errors);
    if (params.forPost && linkValidation.rateWarnings.length > 0) {
        warnings.push(formatRateWarningMessage(linkValidation.rateWarnings));
    }

    return { errors, warnings };
}

function lineItemCode(line: LinkedInvoiceLine): string {
    return (line.itemCode ?? line.item ?? "").trim();
}

export function collectPremiumSalesInvoiceErrors(params: {
    saleMode: string;
    refScrapRate: string;
    totalNetWeight: number;
    lines: Array<{ netWeight?: number; wattaRate?: number }>;
    liveMode: boolean;
}): string[] {
    if (params.saleMode !== "premium") return [];

    const errors: string[] = [];
    if (!params.refScrapRate || Number(params.refScrapRate) <= 0) {
        errors.push("Premium invoices need a scrap reference rate (PKR/kg).");
    }
    if (params.totalNetWeight <= 0) {
        errors.push("Premium invoice must have enamel line weight — this becomes scrap expected from customer.");
    }
    const missingWatta = params.lines.filter(
        (l) => Number(l.netWeight) > 0 && (!l.wattaRate || Number(l.wattaRate) <= 0),
    );
    if (missingWatta.length > 0 && params.liveMode) {
        errors.push("Each premium line needs watta from the matrix (party + SWG). Check customer and gauge.");
    }
    return errors;
}
