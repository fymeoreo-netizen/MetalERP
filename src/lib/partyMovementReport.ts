import {
    getCatalogItem,
    getInventorySection,
    getSectionLabel,
    type InventorySection,
} from "@/lib/itemCatalog";
import {
    getMovementDocDate,
    getMovements,
    type StockMovement,
    type StockMovementType,
} from "@/lib/inventoryStore";
import { getParty, getParties, resolvePartyName } from "@/lib/partyCatalog";
import { endOfMonth, format, startOfMonth } from "date-fns";

export type MaterialGroup =
    | "rm_scrap"
    | "rm_wire8"
    | "rm_rod"
    | "fg_enameled"
    | "fg_strip"
    | "fg_copper_wire"
    | "fg_all"
    | "all";

export type PartyReportTab = "received" | "sold" | "scrap_sent";

export interface PartyMovementFilters {
    dateFrom: string;
    dateTo: string;
    partyId?: string;
    materialGroup?: MaterialGroup;
}

export interface PartyMovementLine {
    id: string;
    date: string;
    partyId: string;
    partyName: string;
    docId: string;
    movementType: StockMovementType;
    itemCode: string;
    itemName: string;
    sizeSpec: string;
    materialGroup: InventorySection;
    materialLabel: string;
    qty: number;
    unit: string;
    purchaseMode?: "cash" | "premium";
    amount?: number;
}

export interface PartyMaterialSummary {
    partyId: string;
    partyName: string;
    materialGroup: InventorySection;
    materialLabel: string;
    totalQty: number;
    docCount: number;
    lastDate: string;
    lines: PartyMovementLine[];
}

export interface PeriodTotals {
    scrapReceived: number;
    wire8Received: number;
    rodReceived: number;
    fgEnameledSold: number;
    fgStripSold: number;
    scrapSent: number;
}

export function getDefaultMonthFilters(): PartyMovementFilters {
    const now = new Date();
    return {
        dateFrom: format(startOfMonth(now), "yyyy-MM-dd"),
        dateTo: format(endOfMonth(now), "yyyy-MM-dd"),
        materialGroup: "all",
    };
}

function movementTypesForTab(tab: PartyReportTab): StockMovementType[] {
    switch (tab) {
        case "received":
            return ["PURCHASE_INVOICE", "PURCHASE_RETURN"];
        case "sold":
            return ["SALES_INVOICE", "SALES_RETURN"];
        case "scrap_sent":
            return ["SCRAP_OUTWARD"];
    }
}

function sectionsForTab(tab: PartyReportTab): InventorySection[] | null {
    switch (tab) {
        case "received":
            return ["rm_scrap", "rm_wire8", "rm_rod"];
        case "sold":
            return ["fg_enameled", "fg_strip", "fg_copper_wire"];
        case "scrap_sent":
            return ["rm_scrap"];
    }
}

function matchesMaterialGroup(section: InventorySection, group: MaterialGroup): boolean {
    if (group === "all") return true;
    if (group === "fg_all") {
        return section === "fg_enameled" || section === "fg_strip" || section === "fg_copper_wire";
    }
    return section === group;
}

function signedQtyForDisplay(tab: PartyReportTab, movement: StockMovement): number {
    const { type, qty } = movement;
    if (tab === "received") {
        if (type === "PURCHASE_INVOICE") return qty;
        if (type === "PURCHASE_RETURN") return -qty;
    }
    if (tab === "sold") {
        if (type === "SALES_INVOICE") return qty;
        if (type === "SALES_RETURN") {
            const action = movement.metadata?.returnAction;
            if (action === "scrap") return 0;
            return -qty;
        }
    }
    if (tab === "scrap_sent" && type === "SCRAP_OUTWARD") return qty;
    return 0;
}

function movementToLine(tab: PartyReportTab, movement: StockMovement): PartyMovementLine | null {
    const item = getCatalogItem(movement.itemCode);
    if (!item) return null;
    const section = getInventorySection(item);
    const qty = signedQtyForDisplay(tab, movement);
    if (qty === 0) return null;

    const partyId = movement.partyId ?? "UNKNOWN";
    return {
        id: movement.id,
        date: getMovementDocDate(movement),
        partyId,
        partyName: movement.partyName ?? resolvePartyName(partyId, "Unknown party"),
        docId: movement.refDocId,
        movementType: movement.type,
        itemCode: movement.itemCode,
        itemName: item.name,
        sizeSpec: item.sizeSpec,
        materialGroup: section,
        materialLabel: getSectionLabel(section),
        qty,
        unit: movement.unit,
        purchaseMode: movement.purchaseMode,
        amount: movement.amount,
    };
}

export function getPartyMovementLines(
    tab: PartyReportTab,
    filters: PartyMovementFilters
): PartyMovementLine[] {
    const types = movementTypesForTab(tab);
    const allowedSections = sectionsForTab(tab);
    const group = filters.materialGroup ?? "all";

    const movements = getMovements({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        partyId: filters.partyId,
        types,
    });

    const lines: PartyMovementLine[] = [];
    for (const m of movements) {
        const line = movementToLine(tab, m);
        if (!line) continue;
        if (allowedSections && !allowedSections.includes(line.materialGroup)) continue;
        if (!matchesMaterialGroup(line.materialGroup, group)) continue;
        lines.push(line);
    }

    return lines.sort((a, b) => b.date.localeCompare(a.date) || b.docId.localeCompare(a.docId));
}

type SummaryAcc = PartyMaterialSummary & { docIds: Set<string> };

export function getPartyMaterialSummaries(
    tab: PartyReportTab,
    filters: PartyMovementFilters
): PartyMaterialSummary[] {
    const lines = getPartyMovementLines(tab, filters);
    const map = new Map<string, SummaryAcc>();

    for (const line of lines) {
        const key = `${line.partyId}|${line.materialGroup}`;
        const existing = map.get(key);
        if (existing) {
            existing.totalQty += line.qty;
            existing.docIds.add(line.docId);
            existing.docCount = existing.docIds.size;
            if (line.date > existing.lastDate) existing.lastDate = line.date;
            existing.lines.push(line);
        } else {
            map.set(key, {
                partyId: line.partyId,
                partyName: line.partyName,
                materialGroup: line.materialGroup,
                materialLabel: line.materialLabel,
                totalQty: line.qty,
                docCount: 1,
                lastDate: line.date,
                lines: [line],
                docIds: new Set([line.docId]),
            });
        }
    }

    return Array.from(map.values())
        .map(({ docIds, ...row }) => row)
        .sort((a, b) => b.totalQty - a.totalQty);
}

export function getPeriodTotals(filters: PartyMovementFilters): PeriodTotals {
    const received = getPartyMovementLines("received", { ...filters, materialGroup: "all" });
    const sold = getPartyMovementLines("sold", { ...filters, materialGroup: "all" });
    const sent = getPartyMovementLines("scrap_sent", { ...filters, materialGroup: "all" });

    const sum = (lines: PartyMovementLine[], section: InventorySection) =>
        lines.filter((l) => l.materialGroup === section).reduce((s, l) => s + l.qty, 0);

    return {
        scrapReceived: sum(received, "rm_scrap"),
        wire8Received: sum(received, "rm_wire8"),
        rodReceived: sum(received, "rm_rod"),
        fgEnameledSold: sum(sold, "fg_enameled"),
        fgStripSold: sum(sold, "fg_strip"),
        scrapSent: sent.reduce((s, l) => s + l.qty, 0),
    };
}

export function getPartiesForReportTab(tab: PartyReportTab) {
    const all = getParties();
    if (tab === "received") return all.filter((p) => p.type === "Vendor" || p.type === "Both");
    if (tab === "sold") return all.filter((p) => p.type === "Customer" || p.type === "Both");
    return all.filter((p) => p.type === "Vendor" || p.type === "Both");
}

export function getPartyStockActivityForParty(
    partyId: string,
    filters?: Partial<PartyMovementFilters>
): {
    received: PartyMaterialSummary[];
    sold: PartyMaterialSummary[];
    scrapSent: PartyMaterialSummary[];
    totals: PeriodTotals;
} {
    const base = { ...getDefaultMonthFilters(), ...filters, partyId };
    return {
        received: getPartyMaterialSummaries("received", base),
        sold: getPartyMaterialSummaries("sold", base),
        scrapSent: getPartyMaterialSummaries("scrap_sent", base),
        totals: getPeriodTotals(base),
    };
}

export function formatQty(qty: number, unit = "KG"): string {
    return `${qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
}

export function getPartyDisplayName(partyId: string): string {
    return getParty(partyId)?.name ?? resolvePartyName(partyId);
}

export interface CustomerDispatchSummary {
    partyId: string;
    partyName: string;
    totalKg: number;
    enameledKg: number;
    stripKg: number;
    docCount: number;
    lastDate: string;
    lines: PartyMovementLine[];
}

/** Finished goods dispatched to each customer (sales invoices minus restock returns). */
export function getCustomerDispatchSummaries(
    filters: PartyMovementFilters
): CustomerDispatchSummary[] {
    return summarizeCustomerDispatch(getPartyMovementLines("sold", { ...filters, materialGroup: "fg_all" }));
}

function summarizeCustomerDispatch(lines: PartyMovementLine[]): CustomerDispatchSummary[] {
    const map = new Map<string, CustomerDispatchSummary & { docIds: Set<string> }>();

    for (const line of lines) {
        const existing = map.get(line.partyId);
        const isEnameled = line.materialGroup === "fg_enameled";
        if (existing) {
            existing.totalKg += line.qty;
            if (isEnameled) existing.enameledKg += line.qty;
            else existing.stripKg += line.qty;
            existing.docIds.add(line.docId);
            existing.docCount = existing.docIds.size;
            if (line.date > existing.lastDate) existing.lastDate = line.date;
            existing.lines.push(line);
        } else {
            map.set(line.partyId, {
                partyId: line.partyId,
                partyName: line.partyName,
                totalKg: line.qty,
                enameledKg: isEnameled ? line.qty : 0,
                stripKg: isEnameled ? 0 : line.qty,
                docCount: 1,
                lastDate: line.date,
                lines: [line],
                docIds: new Set([line.docId]),
            });
        }
    }

    return Array.from(map.values())
        .map(({ docIds, ...row }) => row)
        .sort((a, b) => b.totalKg - a.totalKg);
}

export function getLiveCustomerDispatchSummaries(
    rows: LivePartyStockRow[],
    filters: PartyMovementFilters
): CustomerDispatchSummary[] {
    const lines = getLivePartyMovementLines("sold", rows, { ...filters, materialGroup: "fg_all" });
    return summarizeCustomerDispatch(lines);
}

function summarizeSupplierReceipt(lines: PartyMovementLine[]): SupplierReceiptSummary[] {
    const map = new Map<string, SupplierReceiptSummary & { docIds: Set<string> }>();

    for (const line of lines) {
        const existing = map.get(line.partyId);
        const scrap = line.materialGroup === "rm_scrap" ? line.qty : 0;
        const wire8 = line.materialGroup === "rm_wire8" ? line.qty : 0;
        const rod = line.materialGroup === "rm_rod" ? line.qty : 0;

        if (existing) {
            existing.totalKg += line.qty;
            existing.scrapKg += scrap;
            existing.wire8Kg += wire8;
            existing.rodKg += rod;
            existing.docIds.add(line.docId);
            existing.docCount = existing.docIds.size;
            if (line.date > existing.lastDate) existing.lastDate = line.date;
            existing.lines.push(line);
        } else {
            map.set(line.partyId, {
                partyId: line.partyId,
                partyName: line.partyName,
                totalKg: line.qty,
                scrapKg: scrap,
                wire8Kg: wire8,
                rodKg: rod,
                docCount: 1,
                lastDate: line.date,
                lines: [line],
                docIds: new Set([line.docId]),
            });
        }
    }

    return Array.from(map.values())
        .map(({ docIds, ...row }) => row)
        .sort((a, b) => b.totalKg - a.totalKg);
}

export function getLiveSupplierReceiptSummaries(
    rows: LivePartyStockRow[],
    filters: PartyMovementFilters
): SupplierReceiptSummary[] {
    const lines = getLivePartyMovementLines("received", rows, { ...filters, materialGroup: "all" });
    return summarizeSupplierReceipt(lines);
}

export interface SupplierReceiptSummary {
    partyId: string;
    partyName: string;
    totalKg: number;
    scrapKg: number;
    wire8Kg: number;
    rodKg: number;
    docCount: number;
    lastDate: string;
    lines: PartyMovementLine[];
}

/** Raw material received from each supplier (purchase invoices minus stock returns). */
export function getSupplierReceiptSummaries(
    filters: PartyMovementFilters
): SupplierReceiptSummary[] {
    const lines = getPartyMovementLines("received", { ...filters, materialGroup: "all" });
    return summarizeSupplierReceipt(lines);
}

export type LivePartyStockRow = {
    party_code: string;
    party_name: string;
    movement_type: string;
    posting_date: string;
    item_code: string;
    inventory_group?: string | null;
    item_type?: string | null;
    source_doc_no?: string | null;
    qty_in: number;
    qty_out: number;
};

/** DB movement_type values on erp.inventory_movements */
const RECEIVED_MOVEMENT_TYPES = new Set(["purchase_in", "purchase_return_out", "scrap_in"]);
const SOLD_MOVEMENT_TYPES = new Set(["sales_out", "sales_return_in"]);
const SCRAP_SENT_MOVEMENT_TYPES = new Set(["scrap_out"]);

function liveMovementMatchesTab(tab: PartyReportTab, movementType: string): boolean {
    const mt = movementType.toLowerCase();
    if (tab === "received") return RECEIVED_MOVEMENT_TYPES.has(mt);
    if (tab === "sold") return SOLD_MOVEMENT_TYPES.has(mt);
    return SCRAP_SENT_MOVEMENT_TYPES.has(mt);
}

function resolveLiveInventorySection(row: LivePartyStockRow): InventorySection {
    const item = getCatalogItem(row.item_code);
    if (item) return getInventorySection(item);

    const group = (row.inventory_group ?? "").toLowerCase().replace(/\s+/g, "_");
    const type = (row.item_type ?? "").toLowerCase();
    const code = row.item_code;

    if (group === "enameled") return "fg_enameled";
    if (group === "strip") return "fg_strip";
    if (group === "copper_wire") return "fg_copper_wire";
    if (group === "raw_material" || group === "raw material") {
        if (type.includes("scrap") || /scrap|scp/i.test(type) || /^1210[1-4]/.test(code)) return "rm_scrap";
        if (type.includes("wire") || /^12102/.test(code)) return "rm_wire8";
        if (type.includes("rod") || /^12103/.test(code)) return "rm_rod";
        return "rm_scrap";
    }
    if (/^1230[12]|^41/.test(code)) return code.startsWith("41") ? "fg_enameled" : "fg_strip";
    if (/^FG-ENW/i.test(code)) return "fg_enameled";
    if (/^FG-STR/i.test(code)) return "fg_strip";
    if (/^FG-CUW/i.test(code)) return "fg_copper_wire";
    if (/^RM-SCP|scrap/i.test(code)) return "rm_scrap";
    if (/^RM-W8|wire/i.test(code)) return "rm_wire8";
    if (/^RM-CR|rod/i.test(code)) return "rm_rod";
    return "rm_scrap";
}

function liveSignedQty(tab: PartyReportTab, row: LivePartyStockRow): number {
    const mt = row.movement_type.toLowerCase();
    const qtyIn = Number(row.qty_in ?? 0);
    const qtyOut = Number(row.qty_out ?? 0);

    if (tab === "received") {
        if (mt === "purchase_in" || mt === "scrap_in") return qtyIn;
        if (mt === "purchase_return_out") return -qtyOut;
    }
    if (tab === "sold") {
        if (mt === "sales_out") return qtyOut;
        if (mt === "sales_return_in") return -qtyIn;
    }
    if (tab === "scrap_sent" && mt === "scrap_out") return qtyOut;
    return 0;
}

function liveMovementTypeLabel(mt: string): StockMovementType {
    switch (mt.toLowerCase()) {
        case "purchase_in":
            return "PURCHASE_INVOICE";
        case "purchase_return_out":
            return "PURCHASE_RETURN";
        case "sales_out":
            return "SALES_INVOICE";
        case "sales_return_in":
            return "SALES_RETURN";
        case "scrap_out":
            return "SCRAP_OUTWARD";
        case "scrap_in":
            return "PURCHASE_INVOICE";
        default:
            return "PURCHASE_INVOICE";
    }
}

function liveRowToLine(tab: PartyReportTab, row: LivePartyStockRow): PartyMovementLine | null {
    const item = getCatalogItem(row.item_code);
    const section = resolveLiveInventorySection(row);
    const allowedSections = sectionsForTab(tab);
    if (allowedSections && !allowedSections.includes(section)) return null;

    const qty = liveSignedQty(tab, row);
    if (qty === 0) return null;

    return {
        id: `${row.party_code}-${row.posting_date}-${row.item_code}-${row.movement_type}-${row.source_doc_no ?? ""}`,
        date: row.posting_date,
        partyId: row.party_code,
        partyName: row.party_name || resolvePartyName(row.party_code, "Unknown party"),
        docId: row.source_doc_no?.trim() || row.movement_type.toUpperCase(),
        movementType: liveMovementTypeLabel(row.movement_type),
        itemCode: row.item_code,
        itemName: item?.name ?? row.item_code,
        sizeSpec: item?.sizeSpec ?? "—",
        materialGroup: section,
        materialLabel: getSectionLabel(section),
        qty,
        unit: "KG",
    };
}

export function getLivePartyMovementLines(
    tab: PartyReportTab,
    rows: LivePartyStockRow[],
    filters: PartyMovementFilters
): PartyMovementLine[] {
    const group = filters.materialGroup ?? "all";
    return rows
        .filter((row) => liveMovementMatchesTab(tab, row.movement_type))
        .filter((row) => !filters.partyId || row.party_code === filters.partyId)
        .map((row) => liveRowToLine(tab, row))
        .filter((line): line is PartyMovementLine => !!line)
        .filter((line) => matchesMaterialGroup(line.materialGroup, group))
        .sort((a, b) => b.date.localeCompare(a.date));
}

export function getLivePartyMaterialSummaries(
    tab: PartyReportTab,
    rows: LivePartyStockRow[],
    filters: PartyMovementFilters
): PartyMaterialSummary[] {
    const lines = getLivePartyMovementLines(tab, rows, filters);
    const map = new Map<string, SummaryAcc>();

    for (const line of lines) {
        const key = `${line.partyId}|${line.materialGroup}`;
        const existing = map.get(key);
        if (existing) {
            existing.totalQty += line.qty;
            existing.docIds.add(line.docId);
            existing.docCount = existing.docIds.size;
            if (line.date > existing.lastDate) existing.lastDate = line.date;
            existing.lines.push(line);
        } else {
            map.set(key, {
                partyId: line.partyId,
                partyName: line.partyName,
                materialGroup: line.materialGroup,
                materialLabel: line.materialLabel,
                totalQty: line.qty,
                docCount: 1,
                lastDate: line.date,
                lines: [line],
                docIds: new Set([line.docId]),
            });
        }
    }

    return Array.from(map.values())
        .map(({ docIds, ...row }) => row)
        .sort((a, b) => b.totalQty - a.totalQty);
}

export function getLivePeriodTotals(rows: LivePartyStockRow[], filters: PartyMovementFilters): PeriodTotals {
    const received = getLivePartyMovementLines("received", rows, { ...filters, materialGroup: "all" });
    const sold = getLivePartyMovementLines("sold", rows, { ...filters, materialGroup: "all" });
    const sent = getLivePartyMovementLines("scrap_sent", rows, { ...filters, materialGroup: "all" });
    const sum = (lines: PartyMovementLine[], section: InventorySection) =>
        lines.filter((l) => l.materialGroup === section).reduce((s, l) => s + l.qty, 0);

    return {
        scrapReceived: sum(received, "rm_scrap"),
        wire8Received: sum(received, "rm_wire8"),
        rodReceived: sum(received, "rm_rod"),
        fgEnameledSold: sum(sold, "fg_enameled"),
        fgStripSold: sum(sold, "fg_strip"),
        scrapSent: sent.reduce((s, l) => s + l.qty, 0),
    };
}

export function mapPartyStockMovementRows(rows: Record<string, unknown>[]): LivePartyStockRow[] {
    return rows.map((r) => ({
        party_code: String(r.party_code ?? ""),
        party_name: String(r.party_name ?? ""),
        movement_type: String(r.movement_type ?? ""),
        posting_date: String(r.posting_date ?? ""),
        item_code: String(r.item_code ?? ""),
        inventory_group: r.inventory_group != null ? String(r.inventory_group) : null,
        item_type: r.item_type != null ? String(r.item_type) : null,
        source_doc_no: r.source_doc_no != null ? String(r.source_doc_no) : null,
        qty_in: Number(r.qty_in ?? 0),
        qty_out: Number(r.qty_out ?? 0),
    }));
}

export function getLivePartiesForReportTab(tab: PartyReportTab, rows: LivePartyStockRow[]) {
    const codes = new Set<string>();
    rows.forEach((row) => {
        if (liveMovementMatchesTab(tab, row.movement_type)) codes.add(row.party_code);
    });
    const allowedTypes =
        tab === "received"
            ? new Set(["Vendor", "Both"])
            : tab === "sold"
              ? new Set(["Customer", "Both"])
              : new Set(["Vendor", "Both"]);
    return Array.from(codes)
        .map((id) => ({
            id,
            name: rows.find((r) => r.party_code === id)?.party_name ?? resolvePartyName(id),
        }))
        .filter((p) => {
            const party = getParty(p.id);
            if (!party) return true;
            return allowedTypes.has(party.type);
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}
