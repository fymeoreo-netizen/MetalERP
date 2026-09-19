import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import {
    FALLBACK_ITEM_PRODUCT_TYPES,
    mapDbProductTypeRow,
    type ItemFormTemplate,
    type InventoryGroupDb,
    type ItemProductTypeRow,
} from "@/lib/itemProductTypes";
import type { TopCategory } from "@/lib/itemFormSchema";
import { supabase } from "@/lib/supabase";
import { formatDbError } from "@/lib/api/core";

function slugify(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 48);
}

export async function fetchItemProductTypes(
    topCategory?: TopCategory,
    activeOnly = false,
): Promise<ItemProductTypeRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        const list = [...FALLBACK_ITEM_PRODUCT_TYPES];
        return list.filter((t) => {
            if (topCategory && t.topCategory !== topCategory) return false;
            if (activeOnly && !t.isActive) return false;
            return true;
        });
    }

    let query = supabase
        .schema("erp")
        .from("item_product_types")
        .select("*")
        .order("sort_order")
        .order("label");

    if (topCategory) query = query.eq("top_category", topCategory);
    if (activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) {
        console.warn("[ERP] fetchItemProductTypes", error);
        return FALLBACK_ITEM_PRODUCT_TYPES.filter((t) => !topCategory || t.topCategory === topCategory);
    }
    return (data ?? []).map((row) => mapDbProductTypeRow(row as Record<string, unknown>));
}

export type UpsertItemProductTypeInput = {
    id?: string;
    topCategory: TopCategory;
    label: string;
    slug?: string;
    inventoryGroup: InventoryGroupDb;
    itemType: string;
    codePrefix: string;
    formTemplate: ItemFormTemplate;
    sortOrder?: number;
    isActive?: boolean;
};

export async function upsertItemProductType(
    input: UpsertItemProductTypeInput,
): Promise<{ ok: true; row: ItemProductTypeRow } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: false, error: "Live ERP mode required to manage product types." };
    }

    const slug = (input.slug?.trim() || slugify(input.label)).toLowerCase();
    const payload = {
        top_category: input.topCategory,
        label: input.label.trim(),
        slug,
        inventory_group: input.inventoryGroup,
        item_type: input.itemType.trim(),
        code_prefix: input.codePrefix.trim().toUpperCase(),
        form_template: input.formTemplate,
        sort_order: input.sortOrder ?? 100,
        is_active: input.isActive !== false,
        updated_at: new Date().toISOString(),
    };

    if (input.id) {
        const { data, error } = await supabase
            .schema("erp")
            .from("item_product_types")
            .update(payload)
            .eq("id", input.id)
            .select("*")
            .single();
        if (error) return { ok: false, error: formatDbError(error, "Failed to update product type.") };
        return { ok: true, row: mapDbProductTypeRow(data as Record<string, unknown>) };
    }

    const { data, error } = await supabase
        .schema("erp")
        .from("item_product_types")
        .insert({ ...payload, is_system: false })
        .select("*")
        .single();
    if (error) return { ok: false, error: formatDbError(error, "Failed to create product type.") };
    return { ok: true, row: mapDbProductTypeRow(data as Record<string, unknown>) };
}

export async function deactivateItemProductType(
    id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: false, error: "Live ERP mode required." };
    }
    const { error } = await supabase
        .schema("erp")
        .from("item_product_types")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("is_system", false);
    if (error) return { ok: false, error: formatDbError(error, "Failed to deactivate product type.") };
    return { ok: true };
}

export async function deleteItemProductType(
    id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: false, error: "Live ERP mode required." };
    }
    const { error } = await supabase
        .schema("erp")
        .from("item_product_types")
        .delete()
        .eq("id", id)
        .eq("is_system", false);
    if (error) return { ok: false, error: formatDbError(error, "Failed to delete product type.") };
    return { ok: true };
}
