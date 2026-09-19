import { z } from "zod";
import { lineRateFields } from "@/lib/ratePending";

const rateStatusSchema = z.enum(["fixed", "pending"]).optional();
const num = z.coerce.number();
const optionalUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional();

function lineItemCode(line: { itemCode?: string; item?: string }): string {
    return (line.itemCode ?? line.item ?? "").trim();
}

export const invoiceLinePayloadSchema = z
    .object({
        itemCode: z.string().optional(),
        item: z.string().optional(),
        itemName: z.string().optional(),
        netWeight: num.nonnegative().optional(),
        qty: num.nonnegative().optional(),
        gross: num.nonnegative().optional(),
        tare: num.nonnegative().optional(),
        rate: num.nonnegative().optional(),
        amount: num.nonnegative().optional(),
        rateStatus: rateStatusSchema,
        wattaRate: num.optional(),
        salesOrderLineId: optionalUuid,
        purchaseOrderLineId: optionalUuid,
    })
    .passthrough();

export const salesInvoicePayloadSchema = z
    .object({
        dbId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
        header: z
            .object({
                invoiceId: z.string().min(1),
                date: z.union([z.coerce.date(), z.string()]).optional(),
                customerId: z.string().min(1),
                saleMode: z.enum(["direct", "premium"]).optional(),
                vehicleNo: z.string().optional(),
                driverName: z.string().optional(),
                refScrapRate: z.union([z.string(), num]).nullable().optional(),
                remarks: z.string().optional(),
                linkedOrderId: z.union([z.string(), z.null()]).optional(),
            })
            .passthrough(),
        items: z
            .array(invoiceLinePayloadSchema)
            .min(1)
            .refine(
                (items) =>
                    items.some((l) => lineItemCode(l) && Number(l.netWeight ?? l.qty ?? 0) > 0),
                { message: "At least one line with an item and net weight is required" },
            ),
        totals: z
            .object({
                subtotal: num.optional(),
                discount: num.optional(),
                taxRate: num.optional(),
                taxAmount: num.optional(),
                finalTotal: num.optional(),
                totalNetWeight: num.optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export const purchaseInvoicePayloadSchema = z
    .object({
        dbId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
        header: z
            .object({
                invoiceId: z.string().min(1),
                date: z.union([z.coerce.date(), z.string()]).optional(),
                supplier: z.string().min(1),
                purchaseMode: z.string().optional(),
                settlementMode: z.string().nullable().optional(),
                warehouse: z.string().optional(),
                remarks: z.string().optional(),
                linkedPOId: z.union([z.string(), z.null()]).optional(),
            })
            .passthrough(),
        items: z
            .array(invoiceLinePayloadSchema)
            .min(1)
            .refine(
                (items) =>
                    items.some((l) => lineItemCode(l) && Number(l.netWeight ?? l.qty ?? 0) > 0),
                { message: "At least one line with an item and net weight is required" },
            ),
        totals: z
            .object({
                subtotal: num.optional(),
                additionalCosts: num.optional(),
                laborCost: num.optional(),
                netPayable: num.optional(),
                finalTotal: num.optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export const returnLinePayloadSchema = z
    .object({
        itemCode: z.string().min(1),
        item: z.string().optional(),
        netWeight: num.nonnegative().optional(),
        weight: num.nonnegative().optional(),
        qty: num.nonnegative().optional(),
        rate: num.nonnegative().optional(),
        amount: num.nonnegative().optional(),
        creditAmount: num.nonnegative().optional(),
        rateStatus: rateStatusSchema,
    })
    .passthrough();

export const salesReturnPayloadSchema = z
    .object({
        header: z
            .object({
                returnId: z.string().min(1),
                date: z.union([z.coerce.date(), z.string()]).optional(),
                customerId: z.string().min(1),
                originalInv: z.string().optional(),
                returnAction: z.enum(["restock", "scrap"]).optional(),
                remarks: z.string().optional(),
            })
            .passthrough(),
        items: z.array(returnLinePayloadSchema).min(1),
        totalCreditAmount: num.optional(),
        totals: z.object({ grandTotal: num.optional() }).passthrough().optional(),
    })
    .passthrough();

export const purchaseReturnPayloadSchema = z
    .object({
        header: z
            .object({
                returnId: z.string().min(1),
                date: z.union([z.coerce.date(), z.string()]).optional(),
                supplier: z.string().optional(),
                supplierId: z.string().optional(),
                returnAction: z.string().optional(),
                remarks: z.string().optional(),
            })
            .passthrough(),
        items: z.array(returnLinePayloadSchema).min(1),
        totalDebit: num.optional(),
        totals: z.object({ grandTotal: num.optional() }).passthrough().optional(),
    })
    .passthrough();

export type SalesInvoicePayload = z.infer<typeof salesInvoicePayloadSchema>;
export type InvoiceLinePayload = z.infer<typeof invoiceLinePayloadSchema>;
export type PurchaseInvoicePayload = z.infer<typeof purchaseInvoicePayloadSchema>;
export type SalesReturnPayload = z.infer<typeof salesReturnPayloadSchema>;
export type PurchaseReturnPayload = z.infer<typeof purchaseReturnPayloadSchema>;

export function validateDocumentPayload<T>(
    schema: z.ZodType<T>,
    payload: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
        const msg =
            parsed.error.issues
                .map((i) => `${i.path.join(".") || "payload"}: ${i.message}`)
                .join("; ") || "Invalid document payload";
        return { ok: false, error: msg };
    }
    return { ok: true, data: parsed.data };
}

/** Map validated UI line to DB insert fields including rate_status. */
export function mapLinePayloadToDb(line: z.infer<typeof invoiceLinePayloadSchema>) {
    const rate = lineRateFields(line);
    return {
        ...rate,
        qty: line.netWeight ?? line.qty ?? 0,
    };
}
