import { applyStockMovement } from "@/lib/inventoryStore";
import {
    buildEnamelBatchLines,
    ENAMEL_WIRE_INPUT_CODE,
    type EnamelProductionEntryInput,
} from "@/lib/enamelProduction";

export function applyEnamelProductionBatch(
    productionId: string,
    entries: EnamelProductionEntryInput[],
    wireInputItemCode = ENAMEL_WIRE_INPUT_CODE,
): void {
    for (const entry of entries) {
        const apiLines = buildEnamelBatchLines(entry, { wireInputItemCode });
        for (const line of apiLines) {
            const qty = line.netWeight;
            if (qty <= 0) continue;

            if (line.lineType === "issue") {
                applyStockMovement({
                    type: "PRODUCTION_ISSUE",
                    itemCode: line.itemCode,
                    qty,
                    refDocId: productionId,
                    refDocType: "ENAMEL_PRODUCTION",
                });
            } else if (line.lineType === "receipt") {
                applyStockMovement({
                    type: "PRODUCTION_RECEIPT",
                    itemCode: line.itemCode,
                    qty,
                    refDocId: productionId,
                    refDocType: "ENAMEL_PRODUCTION",
                });
            }
        }
    }
}

export { ENAMEL_WIRE_INPUT_CODE };
