export type FormValidationIssues = {
    errors: string[];
    warnings: string[];
};

export const emptyFormIssues: FormValidationIssues = { errors: [], warnings: [] };

export function mergeFormIssues(draft: FormValidationIssues, post: FormValidationIssues): FormValidationIssues {
    return {
        errors: [...draft.errors, ...post.errors.filter((e) => !draft.errors.includes(e))],
        warnings: post.warnings,
    };
}

export function issuesForAction(
    action: "draft" | "post" | "submit",
    draft: FormValidationIssues,
    post: FormValidationIssues,
): FormValidationIssues {
    return action === "post" || action === "submit" ? mergeFormIssues(draft, post) : draft;
}

export function collectReturnFormIssues(params: {
    partyId: string;
    partyLabel: string;
    lines: unknown[];
    forPost: boolean;
}): FormValidationIssues {
    const errors: string[] = [];

    if (!params.partyId?.trim()) {
        errors.push(`Select a ${params.partyLabel.toLowerCase()} before saving.`);
    }
    if (params.lines.length === 0) {
        errors.push(
            params.forPost ? "Add at least one line before posting." : "Add at least one line before saving.",
        );
    }

    return { errors, warnings: [] };
}

export function collectOrderFormIssues(params: {
    partyId: string;
    partyLabel: string;
    validLineCount: number;
}): FormValidationIssues {
    const errors: string[] = [];

    if (!params.partyId?.trim()) {
        errors.push(`Select a ${params.partyLabel.toLowerCase()}.`);
    }
    if (params.validLineCount === 0) {
        errors.push("Add at least one line with an item and quantity.");
    }

    return { errors, warnings: [] };
}

export function collectTriangleTradeIssues(params: {
    source: string;
    destination: string;
    netWeight: number;
    sameParty: boolean;
    allocationError: string | null;
    hasPremiumSelection: boolean;
    manualRate: number;
    rateStatus: string;
}): FormValidationIssues {
    const errors: string[] = [];

    if (!params.source) errors.push("Select a source party.");
    if (!params.destination) errors.push("Select a destination party.");
    if (params.sameParty) {
        errors.push("Source and destination must differ for AP/AR to show on the party ledger.");
    }
    if (params.netWeight <= 0) errors.push("Enter gross and tare weight to calculate net weight.");
    if (params.hasPremiumSelection && params.allocationError) {
        errors.push(params.allocationError);
    }
    if (!params.hasPremiumSelection && params.manualRate <= 0 && params.rateStatus !== "pending") {
        errors.push("Enter a rate for this scrap trade, or link premium invoices above.");
    }

    return { errors, warnings: [] };
}
