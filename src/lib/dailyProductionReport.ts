import type { DailyProductionDetailRow } from "@/lib/api/reports";

export type ReportWeightTotals = {
    units: number;
    gross: number;
    tare: number;
    net: number;
    input: number;
    consumed: number;
};

export type ReportLine = {
    itemCode: string;
    itemName: string;
    category: string;
    units: number;
    gross: number;
    tare: number;
    net: number;
    inputKg: number;
};

export type ReportBatch = {
    batchNo: string;
    process: string;
    processType: string;
    batchInputKg: number;
    lines: ReportLine[];
    totals: ReportWeightTotals;
};

export type ReportDay = {
    date: string;
    batches: ReportBatch[];
    totals: ReportWeightTotals;
};

export type ReportModel = {
    days: ReportDay[];
    grandTotals: ReportWeightTotals;
};

function emptyTotals(): ReportWeightTotals {
    return { units: 0, gross: 0, tare: 0, net: 0, input: 0, consumed: 0 };
}

function addTotals(target: ReportWeightTotals, line: ReportLine): void {
    target.units += line.units;
    target.gross += line.gross;
    target.tare += line.tare;
    target.net += line.net;
    target.input += line.inputKg;
}

function finalizeBatchTotals(totals: ReportWeightTotals): void {
    totals.consumed = totals.input > 0 ? totals.input : totals.net;
}

function finalizeBatchTotalsWithInput(totals: ReportWeightTotals, batchInputKg: number): void {
    totals.input = batchInputKg > 0 ? batchInputKg : totals.input;
    totals.consumed = totals.input > 0 ? totals.input : totals.net;
}

function formatProcessLabel(processType: string): string {
    if (processType === "enamel") return "Enamel";
    if (processType === "drawing") return "Drawing";
    return processType.charAt(0).toUpperCase() + processType.slice(1);
}

function mapDetailRow(r: DailyProductionDetailRow): ReportLine {
    return {
        itemCode: r.item_code,
        itemName: r.item_name,
        category: r.item_category ?? "",
        units: Number(r.unit_count) || 0,
        gross: Number(r.gross_weight) || 0,
        tare: Number(r.tare_weight) || 0,
        net: Number(r.net_weight) || 0,
        inputKg: Number(r.line_input_kg) || 0,
    };
}

export function buildDailyProductionReportModel(rows: DailyProductionDetailRow[]): ReportModel {
    const batchMap = new Map<string, ReportBatch>();
    const dayOrder: string[] = [];

    for (const r of rows) {
        const dateKey = r.batch_date;
        const batchKey = `${dateKey}|${r.batch_no}`;
        if (!batchMap.has(batchKey)) {
            batchMap.set(batchKey, {
                batchNo: r.batch_no,
                process: formatProcessLabel(r.process_type),
                processType: r.process_type,
                batchInputKg: Number(r.batch_input_kg) || 0,
                lines: [],
                totals: emptyTotals(),
            });
            if (!dayOrder.includes(dateKey)) dayOrder.push(dateKey);
        }
        const batch = batchMap.get(batchKey)!;
        const line = mapDetailRow(r);
        batch.lines.push(line);
        addTotals(batch.totals, line);
    }

    const days: ReportDay[] = [];
    const grandTotals = emptyTotals();

    for (const date of dayOrder.sort()) {
        const dayTotals = emptyTotals();
        const batches: ReportBatch[] = [];

        for (const [key, batch] of batchMap) {
            if (!key.startsWith(`${date}|`)) continue;
            finalizeBatchTotalsWithInput(batch.totals, batch.batchInputKg);
            batches.push(batch);
            dayTotals.units += batch.totals.units;
            dayTotals.gross += batch.totals.gross;
            dayTotals.tare += batch.totals.tare;
            dayTotals.net += batch.totals.net;
            dayTotals.input += batch.totals.input;
            dayTotals.consumed += batch.totals.consumed;
        }

        batches.sort((a, b) => a.batchNo.localeCompare(b.batchNo));
        finalizeBatchTotals(dayTotals);
        days.push({ date, batches, totals: dayTotals });

        grandTotals.units += dayTotals.units;
        grandTotals.gross += dayTotals.gross;
        grandTotals.tare += dayTotals.tare;
        grandTotals.net += dayTotals.net;
        grandTotals.input += dayTotals.input;
        grandTotals.consumed += dayTotals.consumed;
    }

    finalizeBatchTotals(grandTotals);
    return { days, grandTotals };
}

export function buildDemoDailyProductionReportModel(): ReportModel {
    const rows: DailyProductionDetailRow[] = [
        {
            batch_date: "2026-05-07",
            batch_no: "PRD-0001",
            process_type: "enamel",
            line_no: 1,
            item_code: "FG-ENW-022",
            item_name: "Enamel Wire 22G",
            item_category: "Enameled",
            unit_count: 10,
            gross_weight: 0,
            tare_weight: 0,
            net_weight: 400,
            line_input_kg: 0,
            batch_input_kg: 390,
        },
        {
            batch_date: "2026-05-06",
            batch_no: "PRD-0002",
            process_type: "enamel",
            line_no: 1,
            item_code: "FG-ENW-020",
            item_name: "Enamel Wire 20G",
            item_category: "Enameled",
            unit_count: 8,
            gross_weight: 0,
            tare_weight: 0,
            net_weight: 350,
            line_input_kg: 0,
            batch_input_kg: 341,
        },
    ];
    return buildDailyProductionReportModel(rows);
}
