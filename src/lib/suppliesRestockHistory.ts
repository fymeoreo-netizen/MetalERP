import { getCatalogItem, getItemsBySection } from "@/lib/itemCatalog";
import { getMovements, updateSuppliesRestockMovement } from "@/lib/inventoryStore";
import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { supabase } from "@/lib/supabase";
import {
    type SuppliesRestockKind,
    type SuppliesRestockRow,
} from "@/lib/suppliesRestock";

function mapLiveRestockRow(raw: Record<string, unknown>): SuppliesRestockRow | null {
    const items = raw.items as { code?: string; name?: string; inventory_group?: string } | null;
    const code = items?.code;
    if (!code) return null;
    const qtyKg = Number(raw.qty_in ?? 0);
    const unitCostPerKg = Number(raw.unit_cost ?? 0);
    const valueAmount = Number(raw.value_amount ?? qtyKg * unitCostPerKg);
    return {
        id: String(raw.id),
        itemCode: code,
        itemName: String(items?.name ?? code),
        postingDate: String(raw.posting_date ?? "").slice(0, 10),
        qtyKg,
        unitCostPerKg,
        totalValue: valueAmount,
        remarks: (raw.reference_no as string | null) ?? null,
    };
}

export async function getSuppliesRestockMovements(kind: SuppliesRestockKind): Promise<SuppliesRestockRow[]> {
    if (isSupabaseConfigured() && hasErpContext()) {
        const inventoryGroup = kind === "varnish" ? "chemicals" : "packing_material";
        const { data, error } = await supabase
            .schema("erp")
            .from("inventory_movements")
            .select(
                "id, posting_date, qty_in, unit_cost, value_amount, reference_no, items!inner(code, name, inventory_group)",
            )
            .eq("source_doc_type", "supplies_restock")
            .eq("movement_type", "adjustment_in")
            .eq("items.inventory_group", inventoryGroup)
            .order("posting_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) throw new Error(error.message);
        return (data ?? [])
            .map((row) => mapLiveRestockRow(row as Record<string, unknown>))
            .filter((row): row is SuppliesRestockRow => row != null);
    }

    const allowedCodes = new Set(getItemsBySection(kind === "varnish" ? "varnish" : "packing").map((i) => i.code));
    return getMovements({ limit: 2000 })
        .filter((m) => m.refDocType === "SUPPLIES_RESTOCK" && allowedCodes.has(m.itemCode))
        .map((m) => {
            const item = getCatalogItem(m.itemCode);
            const qtyKg = m.qty;
            const unitCostPerKg = m.rate ?? (m.amount != null && qtyKg > 0 ? m.amount / qtyKg : 0);
            return {
                id: m.id,
                itemCode: m.itemCode,
                itemName: item?.name ?? m.itemCode,
                postingDate: m.docDate?.slice(0, 10) ?? m.at.slice(0, 10),
                qtyKg,
                unitCostPerKg,
                totalValue: m.amount ?? qtyKg * unitCostPerKg,
                remarks: (m.metadata?.remarks as string | undefined) ?? null,
            };
        })
        .sort((a, b) => b.postingDate.localeCompare(a.postingDate));
}

export function updateDemoSuppliesRestock(
    movementId: string,
    itemCode: string,
    qty: number,
    unitCost: number,
    postingDate?: string,
    remarks?: string,
): void {
    updateSuppliesRestockMovement(movementId, {
        itemCode,
        qty,
        rate: unitCost,
        amount: Math.round(qty * unitCost * 1000) / 1000,
        docDate: postingDate,
        remarks,
    });
}
