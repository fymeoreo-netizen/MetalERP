export const WORKSHOP_ROD_INPUT = "RM-CR-001";

export type WorkshopBatchLinePayload = {
    lineType: "issue" | "receipt";
    itemCode: string;
    warehouseType: string;
    grossWeight?: number;
    tareWeight?: number;
    netWeight: number;
    unitCount?: number;
};

export function expectedWorkshopOutputKg(inputKg: number, wastagePct: number): number {
    const loss = Math.round(inputKg * (wastagePct / 100) * 1000) / 1000;
    return Math.round((inputKg - loss) * 1000) / 1000;
}

export function buildWorkshopBatchLines(params: {
    rodInputKg: number;
    stripOutputKg: number;
    stripItemCode: string;
    grossWeight?: number;
    tareWeight?: number;
    unitCount?: number;
    rodItemCode?: string;
}): WorkshopBatchLinePayload[] {
    const input = params.rodInputKg;
    if (input <= 0 || !params.stripItemCode) return [];

    const lines: WorkshopBatchLinePayload[] = [
        {
            lineType: "issue",
            itemCode: params.rodItemCode ?? WORKSHOP_ROD_INPUT,
            warehouseType: "raw_material",
            netWeight: input,
        },
    ];
    if (params.stripOutputKg > 0) {
        lines.push({
            lineType: "receipt",
            itemCode: params.stripItemCode,
            warehouseType: "finished_goods",
            netWeight: params.stripOutputKg,
            grossWeight: params.grossWeight ?? 0,
            tareWeight: params.tareWeight ?? 0,
            unitCount: params.unitCount ?? 0,
        });
    }
    return lines;
}

export function validateWorkshopMassBalance(
    rodKg: number,
    stripKg: number,
    wastagePct = 3.5,
    toleranceKg?: number,
): string | null {
    if (rodKg <= 0) return "Rod input must be positive";
    if (stripKg <= 0) return "Strip output must be positive";
    const tol = toleranceKg ?? Math.max(0.5, rodKg * 2 * (wastagePct / 100));
    const loss = rodKg - stripKg;
    if (loss < -tol) {
        return `Strip output ${stripKg} kg exceeds rod input ${rodKg} kg`;
    }
    if (loss > tol) {
        return `Rod input ${rodKg} kg exceeds strip ${stripKg} kg by more than tolerance ${tol.toFixed(1)} kg`;
    }
    return null;
}
