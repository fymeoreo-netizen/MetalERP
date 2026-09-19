export type SalesDispatchChallanLine = {
    lineNo: number;
    description: string;
    netWeightKg: number;
    rate: number;
    amount: number;
};

export type SalesDispatchChallanData = {
    invoiceNo: string;
    invoiceDate: string;
    partyName: string;
    vehicleNo?: string;
    driverName?: string;
    remarks?: string;
    lines: SalesDispatchChallanLine[];
    totalWeightKg: number;
    totalAmount: number;
};

function formatChallanDate(value: string | Date | undefined): string {
    if (!value) return "—";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function lineDescription(name: string, spec?: string | null, gauge?: string): string {
    const parts = [name];
    if (spec?.trim()) parts.push(spec.trim());
    else if (gauge?.trim()) parts.push(`SWG ${gauge.trim()}`);
    return parts.join(" · ");
}

export function mapSalesInvoiceDocToDispatchChallan(doc: Record<string, unknown>): SalesDispatchChallanData {
    const parties = doc.parties as { name?: string } | null | undefined;
    const invLines = (doc.sales_invoice_lines as Record<string, unknown>[] | undefined) ?? [];

    const lines: SalesDispatchChallanLine[] = invLines.map((l, idx) => {
        const items = l.items as { name?: string; code?: string; size_spec?: string } | null | undefined;
        const name = items?.name ?? items?.code ?? "Item";
        return {
            lineNo: Number(l.line_no ?? idx + 1),
            description: lineDescription(name, items?.size_spec),
            netWeightKg: Number(l.net_weight ?? 0),
            rate: Number(l.unit_price ?? 0),
            amount: Number(l.line_amount ?? 0),
        };
    });

    const totalWeightKg = lines.reduce((s, l) => s + l.netWeightKg, 0);
    const lineTotal = lines.reduce((s, l) => s + l.amount, 0);
    const totalAmount = Number(doc.grand_total ?? lineTotal);

    return {
        invoiceNo: String(doc.invoice_no ?? ""),
        invoiceDate: formatChallanDate(String(doc.invoice_date ?? "")),
        partyName: parties?.name?.trim() || "—",
        vehicleNo: doc.vehicle_no ? String(doc.vehicle_no) : undefined,
        driverName: doc.driver_name ? String(doc.driver_name) : undefined,
        remarks: doc.remarks ? String(doc.remarks) : undefined,
        lines,
        totalWeightKg,
        totalAmount,
    };
}

export function mapInvoiceFormToDispatchChallan(input: {
    invoiceId: string;
    date?: Date;
    customerName: string;
    vehicleNo?: string;
    driverName?: string;
    remarks?: string;
    lines: Array<{
        itemName: string;
        netWeight: number;
        rate: number;
        amount: number;
        gauge?: string;
    }>;
    totalAmount: number;
}): SalesDispatchChallanData {
    const lines: SalesDispatchChallanLine[] = input.lines
        .filter((l) => l.netWeight > 0)
        .map((l, idx) => ({
            lineNo: idx + 1,
            description: lineDescription(l.itemName, undefined, l.gauge),
            netWeightKg: Number(l.netWeight ?? 0),
            rate: Number(l.rate ?? 0),
            amount: Number(l.amount ?? 0),
        }));

    return {
        invoiceNo: input.invoiceId,
        invoiceDate: formatChallanDate(input.date),
        partyName: input.customerName.trim() || "—",
        vehicleNo: input.vehicleNo?.trim() || undefined,
        driverName: input.driverName?.trim() || undefined,
        remarks: input.remarks?.trim() || undefined,
        lines,
        totalWeightKg: lines.reduce((s, l) => s + l.netWeightKg, 0),
        totalAmount: Number(input.totalAmount ?? 0),
    };
}

export function buildDispatchChallanShareText(data: SalesDispatchChallanData): string {
    const itemLines = data.lines
        .map(
            (l) =>
                `${l.lineNo}. ${l.description}\n   ${l.netWeightKg.toLocaleString()} kg × ₨ ${l.rate.toLocaleString()} = ₨ ${l.amount.toLocaleString()}`,
        )
        .join("\n");

    const transport =
        data.vehicleNo || data.driverName
            ? `\nVehicle: ${data.vehicleNo || "—"}${data.driverName ? ` · Driver: ${data.driverName}` : ""}`
            : "";

    return [
        `*Dispatch Challan — ${data.invoiceNo}*`,
        `Date: ${data.invoiceDate}`,
        `Party: ${data.partyName}${transport}`,
        "",
        itemLines || "No line items",
        "",
        `*Total weight:* ${data.totalWeightKg.toLocaleString()} kg`,
        `*Total amount:* ₨ ${data.totalAmount.toLocaleString()}`,
        "",
        "_Goods dispatch note for party confirmation — not a tax invoice._",
    ].join("\n");
}
