import { isErpLiveMode } from "@/lib/backendFlags";
import type {
    DrawingLaborSettings,
    DrawingPremiumLine,
    DrawingPremiumLineInput,
    DrawingPremiumRate,
    DrawingWeekWeights,
    DrawingWeeklyWageSheet,
    SaveDrawingWageSheetInput,
} from "@/lib/drawingLaborTypes";
import { supabase } from "@/lib/supabase";

const DEMO_STORAGE_KEY = "coppersync_drawing_labor_v1";

type DemoStore = {
    settings: DrawingLaborSettings;
    premiumRates: DrawingPremiumRate[];
    sheets: DrawingWeeklyWageSheet[];
};

function defaultDemoStore(): DemoStore {
    const base = 12;
    return {
        settings: { id: "demo-settings", baseRatePkr: base, effectiveFrom: new Date().toISOString().slice(0, 10) },
        premiumRates: [
            { id: "p33", gaugeSwg: 33, incrementPkr: 2, ratePkrOverride: null, effectiveFrom: "2026-01-01", effectiveRatePkr: 14 },
            { id: "p34", gaugeSwg: 34, incrementPkr: 3, ratePkrOverride: null, effectiveFrom: "2026-01-01", effectiveRatePkr: 15 },
            { id: "p36", gaugeSwg: 36, incrementPkr: 4, ratePkrOverride: null, effectiveFrom: "2026-01-01", effectiveRatePkr: 16 },
            { id: "p37", gaugeSwg: 37, incrementPkr: 5, ratePkrOverride: null, effectiveFrom: "2026-01-01", effectiveRatePkr: 17 },
            { id: "p38", gaugeSwg: 38, incrementPkr: 6, ratePkrOverride: null, effectiveFrom: "2026-01-01", effectiveRatePkr: 18 },
        ],
        sheets: [],
    };
}

function readDemoStore(): DemoStore {
    try {
        const raw = localStorage.getItem(DEMO_STORAGE_KEY);
        if (!raw) return defaultDemoStore();
        return { ...defaultDemoStore(), ...JSON.parse(raw) } as DemoStore;
    } catch {
        return defaultDemoStore();
    }
}

function writeDemoStore(store: DemoStore) {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
}

export function addCalendarDays(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

export function getSundayWeekBounds(ref = new Date()): { weekStart: string; weekEnd: string } {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    const weekStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { weekStart, weekEnd: addCalendarDays(weekStart, 6) };
}

function mapPremiumLine(row: any): DrawingPremiumLine {
    return {
        id: row.id as string,
        lineNo: Number(row.line_no ?? 0),
        gaugeSwg: Number(row.gauge_swg),
        weightKg: Number(row.weight_kg),
        ratePkrPerKg: Number(row.rate_pkr_per_kg),
        amountPkr: Number(row.amount_pkr),
    };
}

function mapSheet(row: any, lines: DrawingPremiumLine[] = []): DrawingWeeklyWageSheet {
    return {
        id: row.id as string,
        sheetNo: row.sheet_no as string,
        weekStart: row.week_start as string,
        weekEnd: row.week_end as string,
        status: row.status as "draft" | "posted",
        wire8ReceivedKg: Number(row.wire8_received_kg),
        wire8ScrapKg: Number(row.wire8_scrap_kg),
        wire8ReceivedOverride: row.wire8_received_override != null ? Number(row.wire8_received_override) : null,
        wire8ScrapOverride: row.wire8_scrap_override != null ? Number(row.wire8_scrap_override) : null,
        netWire8Kg: Number(row.net_wire8_kg),
        baseRatePkr: Number(row.base_rate_pkr),
        baseWagePkr: Number(row.base_wage_pkr),
        premiumWagePkr: Number(row.premium_wage_pkr),
        totalWagePkr: Number(row.total_wage_pkr),
        notes: (row.notes as string | null) ?? null,
        premiumLines: lines,
        postedAt: (row.posted_at as string | null) ?? null,
    };
}

function computeTotals(
    received: number,
    scrap: number,
    baseRate: number,
    premiumLines: DrawingPremiumLineInput[],
    premiumRates: DrawingPremiumRate[]
) {
    const net = Math.max(received - scrap, 0);
    const baseWage = Math.round(net * baseRate * 100) / 100;
    let premiumWage = 0;
    const lines: DrawingPremiumLine[] = premiumLines.map((l, i) => {
        const rateRow = premiumRates.find((r) => r.gaugeSwg === l.gaugeSwg);
        const rate = rateRow?.effectiveRatePkr ?? baseRate;
        const amount = Math.round(l.weightKg * rate * 100) / 100;
        premiumWage += amount;
        return {
            lineNo: i + 1,
            gaugeSwg: l.gaugeSwg,
            weightKg: l.weightKg,
            ratePkrPerKg: rate,
            amountPkr: amount,
        };
    });
    premiumWage = Math.round(premiumWage * 100) / 100;
    return { net, baseWage, premiumWage, total: baseWage + premiumWage, lines };
}

export async function fetchDrawingLaborSettings(): Promise<DrawingLaborSettings> {
    if (!isErpLiveMode()) {
        return readDemoStore().settings;
    }
    const { data } = await supabase
        .schema("erp")
        .from("drawing_labor_settings")
        .select("id,base_rate_pkr,effective_from")
        .eq("is_active", true)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data) return { id: "", baseRatePkr: 12, effectiveFrom: new Date().toISOString().slice(0, 10) };
    return {
        id: data.id as string,
        baseRatePkr: Number(data.base_rate_pkr),
        effectiveFrom: data.effective_from as string,
    };
}

export async function saveDrawingLaborSettings(baseRatePkr: number): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        store.settings = {
            id: "demo-settings",
            baseRatePkr,
            effectiveFrom: new Date().toISOString().slice(0, 10),
        };
        store.premiumRates = store.premiumRates.map((r) => ({
            ...r,
            effectiveRatePkr: r.ratePkrOverride ?? baseRatePkr + r.incrementPkr,
        }));
        writeDemoStore(store);
        return;
    }
    const { error } = await supabase.schema("erp").rpc("upsert_drawing_labor_settings", {
        p_base_rate_pkr: baseRatePkr,
        p_effective_from: new Date().toISOString().slice(0, 10),
    });
    if (error) throw new Error(error.message);
}

export async function fetchDrawingPremiumRates(): Promise<DrawingPremiumRate[]> {
    if (!isErpLiveMode()) {
        return readDemoStore().premiumRates;
    }
    const settings = await fetchDrawingLaborSettings();
    const { data, error } = await supabase
        .schema("erp")
        .from("drawing_labor_premium_rates")
        .select("id,gauge_swg,increment_pkr,rate_pkr_override,effective_from")
        .eq("is_active", true)
        .order("gauge_swg", { ascending: true });
    if (error || !data) return [];

    const rates: DrawingPremiumRate[] = [];
    for (const row of data) {
        const gauge = Number(row.gauge_swg);
        const { data: rateData } = await supabase.schema("erp").rpc("get_drawing_labor_rate", {
            p_gauge_swg: gauge,
            p_as_of: new Date().toISOString().slice(0, 10),
        });
        const effective = Array.isArray(rateData) ? rateData[0] : rateData;
        rates.push({
            id: row.id as string,
            gaugeSwg: gauge,
            incrementPkr: Number(row.increment_pkr),
            ratePkrOverride: row.rate_pkr_override != null ? Number(row.rate_pkr_override) : null,
            effectiveFrom: row.effective_from as string,
            effectiveRatePkr: Number(effective?.effective_rate_pkr ?? settings.baseRatePkr + Number(row.increment_pkr)),
        });
    }
    return rates;
}

export async function upsertDrawingPremiumRate(input: {
    gaugeSwg: number;
    incrementPkr: number;
    ratePkrOverride?: number | null;
}): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        const base = store.settings.baseRatePkr;
        const idx = store.premiumRates.findIndex((r) => r.gaugeSwg === input.gaugeSwg);
        const row: DrawingPremiumRate = {
            id: idx >= 0 ? store.premiumRates[idx].id : `p${input.gaugeSwg}`,
            gaugeSwg: input.gaugeSwg,
            incrementPkr: input.incrementPkr,
            ratePkrOverride: input.ratePkrOverride ?? null,
            effectiveFrom: new Date().toISOString().slice(0, 10),
            effectiveRatePkr: input.ratePkrOverride ?? base + input.incrementPkr,
        };
        if (idx >= 0) store.premiumRates[idx] = row;
        else store.premiumRates.push(row);
        store.premiumRates.sort((a, b) => a.gaugeSwg - b.gaugeSwg);
        writeDemoStore(store);
        return;
    }
    const { error } = await supabase.schema("erp").rpc("upsert_drawing_premium_rate", {
        p_gauge_swg: input.gaugeSwg,
        p_increment_pkr: input.incrementPkr,
        p_rate_pkr_override: input.ratePkrOverride ?? null,
        p_effective_from: new Date().toISOString().slice(0, 10),
    });
    if (error) throw new Error(error.message);
}

export async function deleteDrawingPremiumRate(id: string): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        store.premiumRates = store.premiumRates.filter((r) => r.id !== id);
        writeDemoStore(store);
        return;
    }
    const { error } = await supabase.schema("erp").rpc("delete_drawing_premium_rate", { p_id: id });
    if (error) throw new Error(error.message);
}

export async function fetchWeekWire8Weights(weekStart: string, weekEnd: string): Promise<DrawingWeekWeights> {
    if (!isErpLiveMode()) {
        return { receivedKg: 1250, scrapKg: 45, issuedKg: 980 };
    }
    const { data, error } = await supabase.schema("erp").rpc("fn_drawing_week_wire8_weights", {
        p_week_start: weekStart,
        p_week_end: weekEnd,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
        receivedKg: Number(row?.received_kg ?? 0),
        scrapKg: Number(row?.scrap_kg ?? 0),
        issuedKg: Number(row?.issued_kg ?? 0),
    };
}

export async function listDrawingWeeklyWageSheets(): Promise<DrawingWeeklyWageSheet[]> {
    if (!isErpLiveMode()) {
        return readDemoStore().sheets.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    }
    const { data, error } = await supabase
        .schema("erp")
        .from("drawing_weekly_wage_sheets")
        .select("*")
        .order("week_start", { ascending: false });
    if (error || !data) return [];

    const sheets: DrawingWeeklyWageSheet[] = [];
    for (const row of data) {
        const { data: lines } = await supabase
            .schema("erp")
            .from("drawing_weekly_wage_premium_lines")
            .select("*")
            .eq("sheet_id", row.id)
            .order("line_no", { ascending: true });
        sheets.push(mapSheet(row, (lines ?? []).map(mapPremiumLine)));
    }
    return sheets;
}

export async function fetchDrawingWeeklyWageSheet(sheetId: string): Promise<DrawingWeeklyWageSheet | null> {
    if (!isErpLiveMode()) {
        return readDemoStore().sheets.find((s) => s.id === sheetId) ?? null;
    }
    const { data, error } = await supabase
        .schema("erp")
        .from("drawing_weekly_wage_sheets")
        .select("*")
        .eq("id", sheetId)
        .maybeSingle();
    if (error || !data) return null;
    const { data: lines } = await supabase
        .schema("erp")
        .from("drawing_weekly_wage_premium_lines")
        .select("*")
        .eq("sheet_id", sheetId)
        .order("line_no", { ascending: true });
    return mapSheet(data, (lines ?? []).map(mapPremiumLine));
}

export async function createDrawingWeeklyWageSheet(weekStart: string): Promise<string> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        if (store.sheets.some((s) => s.weekStart === weekStart)) {
            throw new Error("A wage sheet already exists for this week");
        }
        const { weekEnd } = getSundayWeekBounds(new Date(weekStart));
        const weights = await fetchWeekWire8Weights(weekStart, weekEnd);
        const totals = computeTotals(weights.receivedKg, weights.scrapKg, store.settings.baseRatePkr, [], store.premiumRates);
        const sheet: DrawingWeeklyWageSheet = {
            id: `demo-${weekStart}`,
            sheetNo: `DW-${weekStart}`,
            weekStart,
            weekEnd,
            status: "draft",
            wire8ReceivedKg: weights.receivedKg,
            wire8ScrapKg: weights.scrapKg,
            wire8ReceivedOverride: null,
            wire8ScrapOverride: null,
            netWire8Kg: totals.net,
            baseRatePkr: store.settings.baseRatePkr,
            baseWagePkr: totals.baseWage,
            premiumWagePkr: totals.premiumWage,
            totalWagePkr: totals.total,
            notes: null,
            premiumLines: [],
            postedAt: null,
        };
        store.sheets.unshift(sheet);
        writeDemoStore(store);
        return sheet.id;
    }
    const { data, error } = await supabase.schema("erp").rpc("create_drawing_weekly_wage_sheet", {
        p_week_start: weekStart,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

export async function saveDrawingWeeklyWageSheet(input: SaveDrawingWageSheetInput): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        const idx = store.sheets.findIndex((s) => s.id === input.sheetId);
        if (idx < 0) throw new Error("Sheet not found");
        const sheet = store.sheets[idx];
        if (sheet.status === "posted") throw new Error("Posted sheets cannot be edited");
        const received = input.wire8ReceivedOverride ?? sheet.wire8ReceivedKg;
        const scrap = input.wire8ScrapOverride ?? sheet.wire8ScrapKg;
        const totals = computeTotals(received, scrap, sheet.baseRatePkr, input.premiumLines, store.premiumRates);
        store.sheets[idx] = {
            ...sheet,
            wire8ReceivedOverride: input.wire8ReceivedOverride ?? null,
            wire8ScrapOverride: input.wire8ScrapOverride ?? null,
            notes: input.notes ?? sheet.notes,
            netWire8Kg: totals.net,
            baseWagePkr: totals.baseWage,
            premiumWagePkr: totals.premiumWage,
            totalWagePkr: totals.total,
            premiumLines: totals.lines,
        };
        writeDemoStore(store);
        return;
    }
    const payload: Record<string, unknown> = {
        sheet_id: input.sheetId,
        notes: input.notes ?? "",
        premium_lines: input.premiumLines.map((l) => ({
            gauge_swg: l.gaugeSwg,
            weight_kg: l.weightKg,
        })),
        wire8_received_override: input.wire8ReceivedOverride ?? null,
        wire8_scrap_override: input.wire8ScrapOverride ?? null,
    };

    const { error } = await supabase.schema("erp").rpc("save_drawing_weekly_wage_sheet", { p_payload: payload });
    if (error) throw new Error(error.message);
}

export async function postDrawingWeeklyWageSheet(sheetId: string): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        const idx = store.sheets.findIndex((s) => s.id === sheetId);
        if (idx < 0) throw new Error("Sheet not found");
        store.sheets[idx] = { ...store.sheets[idx], status: "posted", postedAt: new Date().toISOString() };
        writeDemoStore(store);
        return;
    }
    const { error } = await supabase.schema("erp").rpc("post_drawing_weekly_wage_sheet", { p_sheet_id: sheetId });
    if (error) throw new Error(error.message);
}

export async function refreshDrawingWeeklyWageSheetWeights(sheetId: string): Promise<DrawingWeekWeights> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        const idx = store.sheets.findIndex((s) => s.id === sheetId);
        if (idx < 0) throw new Error("Sheet not found");
        const sheet = store.sheets[idx];
        if (sheet.status === "posted") throw new Error("Only draft sheets can refresh weights");
        const weights = await fetchWeekWire8Weights(sheet.weekStart, sheet.weekEnd);
        const received = sheet.wire8ReceivedOverride ?? weights.receivedKg;
        const scrap = sheet.wire8ScrapOverride ?? weights.scrapKg;
        const totals = computeTotals(received, scrap, sheet.baseRatePkr, sheet.premiumLines, store.premiumRates);
        store.sheets[idx] = {
            ...sheet,
            wire8ReceivedKg: weights.receivedKg,
            wire8ScrapKg: weights.scrapKg,
            netWire8Kg: totals.net,
            baseWagePkr: totals.baseWage,
            premiumWagePkr: totals.premiumWage,
            totalWagePkr: totals.total,
        };
        writeDemoStore(store);
        return weights;
    }
    const { error } = await supabase.schema("erp").rpc("refresh_drawing_weekly_wage_sheet_weights", {
        p_sheet_id: sheetId,
    });
    if (error) throw new Error(error.message);
    const sheet = await fetchDrawingWeeklyWageSheet(sheetId);
    if (!sheet) throw new Error("Sheet not found");
    return fetchWeekWire8Weights(sheet.weekStart, sheet.weekEnd);
}

export async function deleteDrawingWeeklyWageSheet(sheetId: string): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        const sheet = store.sheets.find((s) => s.id === sheetId);
        if (!sheet) throw new Error("Sheet not found");
        if (sheet.status === "posted") throw new Error("Only draft sheets can be deleted");
        store.sheets = store.sheets.filter((s) => s.id !== sheetId);
        writeDemoStore(store);
        return;
    }
    const { error } = await supabase.schema("erp").rpc("delete_drawing_weekly_wage_sheet", { p_sheet_id: sheetId });
    if (error) throw new Error(error.message);
}

export async function reopenDrawingWeeklyWageSheet(sheetId: string): Promise<void> {
    if (!isErpLiveMode()) {
        const store = readDemoStore();
        const idx = store.sheets.findIndex((s) => s.id === sheetId);
        if (idx < 0) throw new Error("Sheet not found");
        if (store.sheets[idx].status !== "posted") throw new Error("Only posted sheets can be reopened");
        store.sheets[idx] = { ...store.sheets[idx], status: "draft", postedAt: null };
        writeDemoStore(store);
        return;
    }
    const { error } = await supabase.schema("erp").rpc("reopen_drawing_weekly_wage_sheet", { p_sheet_id: sheetId });
    if (error) throw new Error(error.message);
}
