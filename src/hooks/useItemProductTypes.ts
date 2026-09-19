import { useCallback, useEffect, useState } from "react";
import { fetchItemProductTypes } from "@/lib/api/itemProductTypes";
import { FALLBACK_ITEM_PRODUCT_TYPES, type ItemProductTypeRow } from "@/lib/itemProductTypes";
import type { TopCategory } from "@/lib/itemFormSchema";

let cachedTypes: ItemProductTypeRow[] | null = null;
let loadPromise: Promise<ItemProductTypeRow[]> | null = null;

async function loadAllProductTypes(): Promise<ItemProductTypeRow[]> {
    if (cachedTypes) return cachedTypes;
    if (!loadPromise) {
        loadPromise = fetchItemProductTypes().then((rows) => {
            cachedTypes = rows.length ? rows : FALLBACK_ITEM_PRODUCT_TYPES;
            return cachedTypes;
        });
    }
    return loadPromise;
}

export function invalidateItemProductTypesCache() {
    cachedTypes = null;
    loadPromise = null;
}

export function useItemProductTypes(topCategory?: TopCategory, activeOnly = true) {
    const [types, setTypes] = useState<ItemProductTypeRow[]>(FALLBACK_ITEM_PRODUCT_TYPES);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        invalidateItemProductTypesCache();
        setLoading(true);
        try {
            const rows = await loadAllProductTypes();
            setTypes(rows);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const filtered = types.filter((t) => {
        if (topCategory && t.topCategory !== topCategory) return false;
        if (activeOnly && !t.isActive) return false;
        return true;
    });

    return { types: filtered, allTypes: types, loading, refresh };
}
