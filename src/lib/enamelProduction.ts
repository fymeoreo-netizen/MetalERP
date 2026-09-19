import {
    getCatalogItem,
    getItemsBySection,
    getManagedCategoryForItem,
    getWarehouseType,
    type ItemMasterRecord,
} from "@/lib/itemCatalog";
import { formatItemLabel } from "@/lib/inventoryStore";

/** @deprecated Use wireInputItemCode from production settings via resolveWire8ItemCode */
export const ENAMEL_WIRE_INPUT_CODE = "RM-W8-001";

/** Default copper-rod input item used to backflush RM for strip production.
 *  Overridable via the `rod_input_item_code` production standard. */
export const DEFAULT_ROD_ITEM_CODE = "RM-CR-001";

export type EnamelWireInputOptions = {
    wireInputItemCode: string;
};

export type EnamelProductionEntryInput = {
    lineId?: string;
    itemCode: string;
    unitCount?: string | number;
    grossWeight?: string | number;
    tareWeight?: string | number;
    netWeight: string | number;
    machineId?: string | null;
};

export type EnamelBatchLinePayload = {
    lineId?: string;
    lineType: "issue" | "receipt" | "scrap";
    itemCode: string;
    warehouseType: string;
    grossWeight?: number;
    tareWeight?: number;
    netWeight: number;
    unitCount?: number;
    scrapWeight?: number;
    scrapCategory?: "enamel_scrap";
    machineId?: string | null;
};

/** A machine section within a single production batch. Every line derived from
 *  the section's entries is stamped with `machineId` so per-machine reports stay
 *  correct when one batch spans several machines. */
export type EnamelProductionSection = {
    machineId: string | null;
    entries: EnamelProductionEntryInput[];
};

export const DEFAULT_VARNISH_ITEM_CODE = "CHM-VAR-001";
export const DEFAULT_VARNISH_BLACK_ITEM_CODE = "CHM-VAR-002";
export const DEFAULT_ENAMEL_VARNISH_PCT = 2.7;
export type VarnishColor = "Golden" | "Black";

export function formatProductionBatchNo(seq: number, prefix = "PRD"): string {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export function isStripItem(item: ItemMasterRecord | null | undefined): boolean {
    if (!item) return false;
    return item.category === "Strip" || item.itemType === "Strip";
}

export function isStripItemCode(itemCode: string): boolean {
    return isStripItem(getCatalogItem(itemCode));
}

export function isEnamelWireItem(item: ItemMasterRecord | null | undefined): boolean {
    if (!item) return false;
    // Category/group only — never treat FG-ENW* copper SKUs as enamel.
    return getManagedCategoryForItem(item) === "Enameled";
}

export function isPlainCopperWireItem(item: ItemMasterRecord | null | undefined): boolean {
    if (!item) return false;
    return getManagedCategoryForItem(item) === "Copper Wire";
}

export function isEnamelWireItemCode(itemCode: string): boolean {
    return isEnamelWireItem(getCatalogItem(itemCode));
}

export function getEnamelProductionItemOptions(): ItemMasterRecord[] {
    const enameled = getItemsBySection("fg_enameled");
    const strip = getItemsBySection("fg_strip");
    const copperWire = getItemsBySection("fg_copper_wire");
    return [...enameled, ...strip, ...copperWire].sort((a, b) => {
        const rank = (item: ItemMasterRecord) => {
            if (isStripItem(item)) return 2;
            if (item.category === "Copper Wire" || item.itemType === "Copper Wire") return 1;
            return 0;
        };
        const diff = rank(a) - rank(b);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
}

export function getWorkshopStripItemOptions(): ItemMasterRecord[] {
    return getItemsBySection("fg_strip").sort((a, b) => a.name.localeCompare(b.name));
}

export function getVarnishItemOptions(): ItemMasterRecord[] {
    return getItemsBySection("varnish").sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveVarnishItemCode(color: VarnishColor, goldenCode: string, blackCode: string): string {
    return color === "Black" ? blackCode : goldenCode;
}

export function resolveEnamelItemColor(itemCode: string): VarnishColor {
    const item = getCatalogItem(itemCode);
    if (!item) return "Golden";
    const text = `${item.name} ${item.sizeSpec}`;
    if (/black/i.test(text)) return "Black";
    return "Golden";
}

export type GoatPackingOptions = {
    thresholdMidLoKg?: number;
    thresholdMidHiKg?: number;
    goat5kgItemCode?: string;
    goat10kgItemCode?: string;
};

const DEFAULT_GOAT_MID_LO = 8;
const DEFAULT_GOAT_MID_HI = 13;
const DEFAULT_GOAT_5KG = "CON-GOT-001";
const DEFAULT_GOAT_10KG = "CON-GOT-002";

export function computeGoatIssueForEntry(
    entry: EnamelProductionEntryInput,
    options?: GoatPackingOptions,
): { itemCode: string; qty: number } | null {
    const item = getCatalogItem(entry.itemCode);
    // Goats pack both enameled and plain copper wire (not strip).
    if (!item || (!isEnamelWireItem(item) && !isPlainCopperWireItem(item))) return null;

    const units = Number(entry.unitCount) || 0;
    const net = Number(entry.netWeight) || 0;
    if (units <= 0 || net <= 0) return null;

    const avg = net / units;
    const thrMidLo = options?.thresholdMidLoKg ?? DEFAULT_GOAT_MID_LO;
    const thrMidHi = options?.thresholdMidHiKg ?? DEFAULT_GOAT_MID_HI;
    const goat5 = options?.goat5kgItemCode ?? DEFAULT_GOAT_5KG;
    const goat10 = options?.goat10kgItemCode ?? DEFAULT_GOAT_10KG;

    if (avg < thrMidLo) {
        return { itemCode: goat5, qty: units };
    }
    if (avg >= thrMidLo && avg < thrMidHi) {
        return { itemCode: goat10, qty: units };
    }
    return null;
}

export function summarizeEnamelBatchDeductions(
    entries: EnamelProductionEntryInput[],
    options?: {
        varnishPct?: number;
        varnishGoldenCode?: string;
        varnishBlackCode?: string;
        goatPacking?: GoatPackingOptions;
    },
): {
    varnishByCode: Record<string, number>;
    goatsByCode: Record<string, number>;
    totalVarnishKg: number;
    totalGoatRolls: number;
} {
    const varnishPct = options?.varnishPct ?? DEFAULT_ENAMEL_VARNISH_PCT;
    const goldenCode = options?.varnishGoldenCode ?? DEFAULT_VARNISH_ITEM_CODE;
    const blackCode = options?.varnishBlackCode ?? DEFAULT_VARNISH_BLACK_ITEM_CODE;
    const varnishByCode: Record<string, number> = {};
    const goatsByCode: Record<string, number> = {};

    for (const entry of entries) {
        const item = getCatalogItem(entry.itemCode);
        if (!item) continue;
        const net = Number(entry.netWeight) || 0;
        if (net <= 0) continue;

        // Varnish: enamel only. Goats: enamel + plain copper.
        if (isEnamelWireItem(item)) {
            const color = resolveEnamelItemColor(entry.itemCode);
            const varnishCode = resolveVarnishItemCode(color, goldenCode, blackCode);
            const varnishKg = computeVarnishKg(net, varnishPct);
            if (varnishKg > 0) {
                varnishByCode[varnishCode] = round3((varnishByCode[varnishCode] ?? 0) + varnishKg);
            }
        }
        const goat = computeGoatIssueForEntry(entry, options?.goatPacking);
        if (goat) {
            goatsByCode[goat.itemCode] = (goatsByCode[goat.itemCode] ?? 0) + goat.qty;
        }
    }

    const totalVarnishKg = round3(Object.values(varnishByCode).reduce((s, n) => s + n, 0));
    const totalGoatRolls = Object.values(goatsByCode).reduce((s, n) => s + n, 0);
    return { varnishByCode, goatsByCode, totalVarnishKg, totalGoatRolls };
}

export function computeVarnishKgFromDrums(drumCount: number, drumWeightKg: number): number {
    return round3(drumCount * drumWeightKg);
}

export function formatEnamelItemLabel(itemCode: string): string {
    const item = getCatalogItem(itemCode);
    if (!item) return itemCode;
    return `${formatItemLabel(item)} (${item.code})`;
}

export function buildEnamelBatchLines(
    entry: EnamelProductionEntryInput,
    options?: {
        includeVarnish?: boolean;
        varnishPct?: number;
        varnishItemCode?: string;
        wireInputItemCode?: string;
        rodInputItemCode?: string;
    },
): EnamelBatchLinePayload[] {
    const item = getCatalogItem(entry.itemCode);
    if (!item) return [];

    const net = Number(entry.netWeight) || 0;
    if (net <= 0) return [];

    const gross = Number(entry.grossWeight) || 0;
    const tare = Number(entry.tareWeight) || 0;
    const unitCount = Number(entry.unitCount) || 0;
    const warehouseType = getWarehouseType(item);

    const lines: EnamelBatchLinePayload[] = [];

    const wireInputCode = options?.wireInputItemCode ?? ENAMEL_WIRE_INPUT_CODE;

    if (isEnamelWireItem(item)) {
        lines.push({
            lineType: "issue",
            itemCode: wireInputCode,
            warehouseType: "raw_material",
            netWeight: net,
            grossWeight: 0,
            tareWeight: 0,
            unitCount: 0,
        });

        if (options?.includeVarnish) {
            const varnishPct = options?.varnishPct ?? DEFAULT_ENAMEL_VARNISH_PCT;
            const varnishKg = computeVarnishKg(net, varnishPct);
            if (varnishKg > 0) {
                lines.push({
                    lineType: "issue",
                    itemCode: options?.varnishItemCode ?? DEFAULT_VARNISH_ITEM_CODE,
                    warehouseType: "varnish",
                    netWeight: varnishKg,
                });
            }
        }
    }

    // Strip is rolled from copper rod, 1:1 by weight (no added material).
    if (isStripItem(item)) {
        const rodInputCode = options?.rodInputItemCode ?? DEFAULT_ROD_ITEM_CODE;
        lines.push({
            lineType: "issue",
            itemCode: rodInputCode,
            warehouseType: "raw_material",
            netWeight: net,
            grossWeight: 0,
            tareWeight: 0,
            unitCount: 0,
        });
    }

    lines.push({
        lineId: entry.lineId,
        lineType: "receipt",
        itemCode: entry.itemCode,
        warehouseType,
        netWeight: net,
        grossWeight: isStripItem(item) ? gross : 0,
        tareWeight: isStripItem(item) ? tare : 0,
        unitCount,
    });

    return lines;
}

export function computeVarnishKg(totalOutputKg: number, varnishPct: number): number {
    return round3(totalOutputKg * (varnishPct / 100));
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

export function buildEnamelBatchLinesFromEntries(
    entries: EnamelProductionEntryInput[],
    options?: {
        varnishPct?: number;
        varnishGoldenCode?: string;
        varnishBlackCode?: string;
        goatPacking?: GoatPackingOptions;
        wireInputItemCode?: string;
        rodInputItemCode?: string;
    },
): EnamelBatchLinePayload[] {
    return buildEnamelSectionLines(entries, undefined, options);
}

/** Build the receipt + auto-issue lines for one machine section, stamping every
 *  derived line with the section's machineId. Wire No 8 input is attributed per
 *  section (section output − section varnish) so each machine's input is correct
 *  even when multiple machines share a single production batch. */
export function buildEnamelSectionLines(
    entries: EnamelProductionEntryInput[],
    machineId: string | null | undefined,
    options?: {
        varnishPct?: number;
        varnishGoldenCode?: string;
        varnishBlackCode?: string;
        goatPacking?: GoatPackingOptions;
        wireInputItemCode?: string;
        rodInputItemCode?: string;
    },
): EnamelBatchLinePayload[] {
    const varnishPct = options?.varnishPct ?? DEFAULT_ENAMEL_VARNISH_PCT;
    const goldenCode = options?.varnishGoldenCode ?? DEFAULT_VARNISH_ITEM_CODE;
    const blackCode = options?.varnishBlackCode ?? DEFAULT_VARNISH_BLACK_ITEM_CODE;
    const stamp = machineId ?? null;

    const lines: EnamelBatchLinePayload[] = [];
    let totalEnamelOutput = 0;
    let totalCopperOutput = 0;
    let totalStripOutput = 0;
    let hasEnamelWire = false;
    let hasCopperWire = false;
    let hasStrip = false;
    const varnishByCode = new Map<string, number>();
    const goatsByCode = new Map<string, number>();

    for (const entry of entries) {
        const item = getCatalogItem(entry.itemCode);
        if (!item) continue;
        const net = Number(entry.netWeight) || 0;
        if (net <= 0) continue;

        const isEnamel = isEnamelWireItem(item);
        const isCopper = isPlainCopperWireItem(item);
        const isStrip = isStripItem(item);
        if (isEnamel) {
            hasEnamelWire = true;
            totalEnamelOutput += net;
        }
        if (isCopper) {
            hasCopperWire = true;
            totalCopperOutput += net;
        }
        if (isStrip) {
            hasStrip = true;
            totalStripOutput += net;
        }

        lines.push({
            lineId: entry.lineId,
            lineType: "receipt",
            itemCode: entry.itemCode,
            warehouseType: getWarehouseType(item),
            netWeight: net,
            grossWeight: isStripItem(item) ? Number(entry.grossWeight) || 0 : 0,
            tareWeight: isStripItem(item) ? Number(entry.tareWeight) || 0 : 0,
            unitCount: Number(entry.unitCount) || 0,
            machineId: stamp,
        });

        // Varnish only for enamel
        if (isEnamel) {
            const color = resolveEnamelItemColor(entry.itemCode);
            const varnishCode = resolveVarnishItemCode(color, goldenCode, blackCode);
            const varnishKg = computeVarnishKg(net, varnishPct);
            if (varnishKg > 0) {
                varnishByCode.set(varnishCode, round3((varnishByCode.get(varnishCode) ?? 0) + varnishKg));
            }
        }
        // Goats for enamel and plain copper
        const goat = computeGoatIssueForEntry(entry, options?.goatPacking);
        if (goat) {
            goatsByCode.set(goat.itemCode, (goatsByCode.get(goat.itemCode) ?? 0) + goat.qty);
        }
    }

    const totalVarnishKg = round3([...varnishByCode.values()].reduce((s, n) => s + n, 0));
    const wireInputCode = options?.wireInputItemCode ?? ENAMEL_WIRE_INPUT_CODE;

    if (hasEnamelWire || hasCopperWire) {
        // Wire8 = (enamel − varnish) + plain copper. Strip does not consume Wire 8.
        const wireIssueKg = round3(totalEnamelOutput - totalVarnishKg + totalCopperOutput);
        if (wireIssueKg > 0) {
            lines.unshift({
                lineType: "issue",
                itemCode: wireInputCode,
                warehouseType: "raw_material",
                netWeight: wireIssueKg,
                grossWeight: 0,
                tareWeight: 0,
                unitCount: 0,
                machineId: stamp,
            });
        }

        for (const [varnishCode, varnishKg] of varnishByCode) {
            if (varnishKg > 0) {
                lines.push({
                    lineType: "issue",
                    itemCode: varnishCode,
                    warehouseType: "varnish",
                    netWeight: varnishKg,
                    machineId: stamp,
                });
            }
        }

        for (const [goatCode, goatQty] of goatsByCode) {
            if (goatQty > 0) {
                lines.push({
                    lineType: "issue",
                    itemCode: goatCode,
                    warehouseType: "packing_material",
                    netWeight: goatQty,
                    unitCount: goatQty,
                    machineId: stamp,
                });
            }
        }
    }

    // Strip is rolled from copper rod, 1:1 by weight (no added material, no
    // varnish, no goats). Issue rod per machine section so per-machine RM
    // attribution stays correct when one batch spans several machines.
    if (hasStrip) {
        const rodInputCode = options?.rodInputItemCode ?? DEFAULT_ROD_ITEM_CODE;
        const rodIssueKg = round3(totalStripOutput);
        if (rodIssueKg > 0) {
            lines.unshift({
                lineType: "issue",
                itemCode: rodInputCode,
                warehouseType: "raw_material",
                netWeight: rodIssueKg,
                grossWeight: 0,
                tareWeight: 0,
                unitCount: 0,
                machineId: stamp,
            });
        }
    }

    return lines;
}

/** Flatten machine sections into a single ordered line list for one production
 *  batch. `line_no` is assigned sequentially by the API layer. */
export function buildEnamelBatchLinesFromSections(
    sections: EnamelProductionSection[],
    options?: {
        varnishPct?: number;
        varnishGoldenCode?: string;
        varnishBlackCode?: string;
        goatPacking?: GoatPackingOptions;
        wireInputItemCode?: string;
        rodInputItemCode?: string;
    },
): EnamelBatchLinePayload[] {
    const lines: EnamelBatchLinePayload[] = [];
    for (const section of sections) {
        if (!section.entries.length) continue;
        lines.push(...buildEnamelSectionLines(section.entries, section.machineId, options));
    }
    return lines;
}

/** Distinct machine ids actually used by a list of batch lines (for setting the
 *  batch header machine: single distinct machine, else null = multi-machine). */
export function distinctLineMachineIds(lines: EnamelBatchLinePayload[]): string[] {
    const ids = new Set<string>();
    for (const l of lines) if (l.machineId) ids.add(l.machineId);
    return [...ids];
}

export type EnamelHistoryRow = {
    entryId: string;
    productionId: string;
    batchDbId: string;
    date: string;
    itemCode: string;
    itemName: string;
    unitCount: string;
    grossWeight?: string;
    tareWeight?: string;
    netWeight: string;
    status: string;
    posted: boolean;
    machineId?: string | null;
};

export type EnamelBatchHistory = {
    batchDbId: string;
    productionId: string;
    date: string;
    posted: boolean;
    status: string;
    lineCount: number;
    totalNetKg: number;
    totalUnits: number;
    itemSummary: string;
    machineId?: string | null;
    machineCode?: string | null;
    machineName?: string | null;
    /** Distinct machine ids across the batch's receipt lines (empty for legacy
     *  batches with no line-level machine). Used to show "Multiple machines". */
    lineMachineIds: string[];
    isMultiMachine: boolean;
    lines: EnamelHistoryRow[];
};

export function receiptLinesToEntryInputs(
    lines: EnamelHistoryRow[],
): EnamelProductionEntryInput[] {
    return lines.map((row) => ({
        lineId: row.entryId,
        itemCode: row.itemCode,
        unitCount: row.unitCount,
        grossWeight: row.grossWeight,
        tareWeight: row.tareWeight,
        netWeight: row.netWeight,
        machineId: row.machineId ?? null,
    }));
}

function distinctReceiptMachineIds(receiptLines: EnamelHistoryRow[]): string[] {
    const ids = new Set<string>();
    for (const r of receiptLines) if (r.machineId) ids.add(r.machineId);
    return [...ids];
}

export function mapProductionBatchesToHistoryBatches(batches: any[]): EnamelBatchHistory[] {
    const result: EnamelBatchHistory[] = [];
    for (const batch of batches) {
        const lineRows = mapProductionBatchesToHistoryRows([batch]);
        const receiptLines = lineRows.filter((r) => r.itemCode);
        const totalNetKg = receiptLines.reduce((s, r) => s + (Number(r.netWeight) || 0), 0);
        const totalUnits = receiptLines.reduce((s, r) => s + (Number(r.unitCount) || 0), 0);
        const first = receiptLines[0];
        let itemSummary = "—";
        if (receiptLines.length === 1 && first) {
            itemSummary = formatEnamelItemLabel(first.itemCode);
        } else if (receiptLines.length > 1 && first) {
            itemSummary = `${formatEnamelItemLabel(first.itemCode)} +${receiptLines.length - 1}`;
        } else if (receiptLines.length > 0) {
            itemSummary = `${receiptLines.length} items`;
        }

        result.push({
            batchDbId: batch.id,
            productionId: batch.batch_no,
            date: batch.batch_date,
            posted: batch.status === "posted",
            status: batch.status ?? "draft",
            lineCount: receiptLines.length,
            totalNetKg,
            totalUnits,
            itemSummary,
            machineId: batch.machine_id ?? null,
            machineCode: batch.production_machines?.machine_code ?? null,
            machineName: batch.production_machines?.name ?? null,
            lineMachineIds: distinctReceiptMachineIds(receiptLines),
            isMultiMachine: distinctReceiptMachineIds(receiptLines).length > 1,
            lines: receiptLines,
        });
    }
    return result;
}

export function mapProductionBatchesToHistoryRows(batches: any[]): EnamelHistoryRow[] {
    const rows: EnamelHistoryRow[] = [];
    for (const batch of batches) {
        const lines = (batch.production_batch_lines ?? []) as any[];
        const receiptLines = lines.filter((l) => l.line_type === "receipt");
        const targetLines = receiptLines.length ? receiptLines : lines;

        for (const line of targetLines) {
            const itemCode = line.items?.code ?? "";
            rows.push({
                entryId: line.id ?? `${batch.id}-${line.line_no}`,
                productionId: batch.batch_no,
                batchDbId: batch.id,
                date: batch.batch_date,
                itemCode,
                itemName: line.items?.name ?? itemCode,
                unitCount: String(line.unit_count ?? ""),
                grossWeight: Number(line.gross_weight) > 0 ? String(line.gross_weight) : undefined,
                tareWeight: Number(line.tare_weight) > 0 ? String(line.tare_weight) : undefined,
                netWeight: String(line.net_weight ?? 0),
                status: batch.status ?? "draft",
                posted: batch.status === "posted",
                machineId: line.machine_id ?? null,
            });
        }

        if (!targetLines.length) {
            rows.push({
                entryId: batch.id,
                productionId: batch.batch_no,
                batchDbId: batch.id,
                date: batch.batch_date,
                itemCode: "",
                itemName: "—",
                unitCount: "",
                netWeight: "0",
                status: batch.status ?? "draft",
                posted: batch.status === "posted",
            });
        }
    }
    return rows;
}
