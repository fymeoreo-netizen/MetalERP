import { getCatalogItem, getInventorySection, type ItemMasterRecord } from "@/lib/itemCatalog";
import type { PendingReason } from "@/lib/ratePending";

export type ScrapTradeStatus = "draft" | "posted";

export type ScrapTradeFormPayload = {
    id: string;
    source: string;
    destination: string;
    sourceId: string;
    destinationId: string;
    date: string;
    item: string;
    itemCode: string;
    biltyNo: string;
    vehicleNo: string;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    rateValue: number;
    rate: string;
    amount: string;
    status: string;
    /** Premium enamel: scrap receivable from a posted sales invoice (legacy single) */
    obligationId?: string;
    salesInvoiceNo?: string;
    /** Multi-invoice premium scrap allocation (toll-drop) */
    obligationAllocations?: {
        obligationId: string;
        allocatedKg: number;
        salesInvoiceNo: string;
        refScrapRate: number;
    }[];
    /** Unlinked trades: defer AP/AR until fixed in Rate Management */
    rateStatus?: "fixed" | "pending";
    pendingReason?: PendingReason;
    /** Advance scrap credits consumed on this toll-drop */
    creditAllocations?: {
        scrapCreditId: string;
        allocatedKg: number;
        tradeNo: string;
    }[];
    /** Settlement mode: triangle (default, AR + scrap_payable_lot) or cash (Dr Cash, no lot, no metal). */
    settlementMode?: "triangle" | "cash";
    /** Optional override for the cash GL account (defaults to posting_account_map scrap_trade/cash). */
    bankAccountCode?: string;
};

export type ScrapTradeListItem = {
    dbId?: string;
    id: string;
    date: string;
    dateLabel: string;
    sourceId: string;
    destinationId: string;
    source: string;
    destination: string;
    itemCode?: string;
    itemName?: string;
    biltyNo: string;
    vehicleNo: string;
    grossWeight: number;
    tareWeight: number;
    netWeight: string;
    netWeightKg: number;
    rateValue: number;
    rate: string;
    amount: string;
    amountValue: number;
    status: "Recorded" | "Posted";
    /** Per-invoice premium scrap lines when linked on toll-drop */
    premiumLines?: ScrapTradePremiumLine[];
    rateStatus?: "fixed" | "pending";
    financialStatus?: "complete" | "partial" | "pending";
    settlementMode?: "triangle" | "cash";
};

export type ScrapTradePremiumLine = {
    salesInvoiceNo: string;
    allocatedKg: number;
    refScrapRate: number;
    lineSeq: number;
};

export type ScrapTradeApiRow = {
    id: string;
    trade_no: string;
    trade_date: string;
    gross_weight?: number;
    tare_weight?: number;
    net_weight?: number;
    unit_rate?: number;
    amount?: number;
    status?: string;
    rate_status?: string;
    financial_status?: string;
    settlement_mode?: string;
    bank_account_code?: string | null;
    bilty_no?: string;
    vehicle_no?: string;
    source?: { code?: string; name?: string } | null;
    dest?: { code?: string; name?: string } | null;
    item?: { code?: string; name?: string } | null;
};

export type ScrapWastageRow = {
    source: string;
    posting_date: string;
    item_code: string;
    scrap_kg: number;
    batch_no?: string;
};

export type ScrapTradeRegisterRow = {
    trade_no: string;
    trade_date: string;
    source_name: string;
    dest_name: string;
    item_code: string;
    bilty_no: string | null;
    vehicle_no: string | null;
    net_weight: number;
    unit_rate: number;
    amount: number;
    source_ap_amount?: number;
    dest_ar_amount?: number;
    settlement_mode?: "triangle" | "cash" | string;
};

export type ScrapPartySummaryRow = {
    party_code: string;
    party_name: string;
    direction: "sent" | "received";
    scrap_kg: number;
    scrap_amount: number;
    trade_count: number;
};

/** Posted scrap trade totals by party role (source = gave us scrap, destination = we delivered to). */
export type ScrapTollDropPartyRow = {
    party_code: string;
    party_name: string;
    party_role: "source" | "destination";
    scrap_kg: number;
    avg_rate: number;
    scrap_amount: number;
    trade_count: number;
};

const ITEM_LABEL_TO_CODE: Record<string, string> = {
    "Copper Scrap": "RM-SCP-001",
    "Silver Scrap": "RM-SCP-001",
};

export function resolveScrapItemCode(itemLabelOrCode: string, fallback = "RM-SCP-001"): string {
    const trimmed = itemLabelOrCode.trim();
    if (!trimmed) return fallback;
    if (getCatalogItem(trimmed)) return trimmed;
    if (ITEM_LABEL_TO_CODE[trimmed]) return ITEM_LABEL_TO_CODE[trimmed];
    const item = getCatalogItem(fallback);
    return item?.code ?? fallback;
}

export function listScrapCatalogItems(): ItemMasterRecord[] {
    const seen = new Set<string>();
    const items: ItemMasterRecord[] = [];
    for (const item of [getCatalogItem("RM-SCP-001"), getCatalogItem("RM-SCRAP-001")].filter(Boolean) as ItemMasterRecord[]) {
        if (!seen.has(item.code)) {
            seen.add(item.code);
            items.push(item);
        }
    }
    if (!items.length && getCatalogItem("RM-SCP-001")) {
        items.push(getCatalogItem("RM-SCP-001")!);
    }
    return items;
}

export function scrapItemLabel(item: ItemMasterRecord): string {
    return item.name;
}

export function mapScrapTradeApiRow(r: ScrapTradeApiRow): ScrapTradeListItem {
    const netKg = Number(r.net_weight ?? 0);
    const rate = Number(r.unit_rate ?? 0);
    const amountVal = Number(r.amount ?? 0);
    return {
        dbId: r.id,
        id: r.trade_no,
        date: r.trade_date,
        dateLabel: r.trade_date ? new Date(r.trade_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "",
        sourceId: r.source?.code ?? "",
        destinationId: r.dest?.code ?? "",
        source: r.source?.name ?? "",
        destination: r.dest?.name ?? "",
        itemCode: r.item?.code,
        itemName: r.item?.name,
        biltyNo: r.bilty_no ?? "",
        vehicleNo: r.vehicle_no ?? "",
        grossWeight: Number(r.gross_weight ?? 0),
        tareWeight: Number(r.tare_weight ?? 0),
        netWeight: `${netKg.toLocaleString()} kg`,
        netWeightKg: netKg,
        rateValue: rate,
        rate: `${rate} PKR/kg`,
        amount: `${amountVal.toLocaleString()} PKR`,
        amountValue: amountVal,
        status: r.status === "posted" ? "Posted" : "Recorded",
        rateStatus: r.rate_status === "pending" ? "pending" : "fixed",
        settlementMode: r.settlement_mode === "cash" ? "cash" : "triangle",
        financialStatus:
            r.financial_status === "pending" || r.financial_status === "partial"
                ? (r.financial_status as "pending" | "partial")
                : "complete",
    };
}

export function isScrapCatalogItem(item: ItemMasterRecord): boolean {
    return getInventorySection(item) === "rm_scrap";
}

export function applyPremiumLinesToListItem(
    item: ScrapTradeListItem,
    lines: ScrapTradePremiumLine[] | undefined,
): ScrapTradeListItem {
    if (!lines?.length) return item;
    const sorted = [...lines].sort((a, b) => a.lineSeq - b.lineSeq);
    const amountFromLines = sorted.reduce((s, l) => s + l.allocatedKg * l.refScrapRate, 0);
    const rateLabel =
        sorted.length === 1
            ? `${sorted[0].refScrapRate.toLocaleString()} PKR/kg (${sorted[0].salesInvoiceNo})`
            : sorted
                  .map(
                      (l) =>
                          `${l.salesInvoiceNo}: ${l.allocatedKg.toLocaleString()} kg @ ${l.refScrapRate.toLocaleString()}`,
                  )
                  .join(" · ");
    return {
        ...item,
        premiumLines: sorted,
        rate: rateLabel,
        rateValue: sorted.length === 1 ? sorted[0].refScrapRate : item.rateValue,
        amountValue: amountFromLines > 0 ? amountFromLines : item.amountValue,
        amount: `${(amountFromLines > 0 ? amountFromLines : item.amountValue).toLocaleString()} PKR`,
    };
}
