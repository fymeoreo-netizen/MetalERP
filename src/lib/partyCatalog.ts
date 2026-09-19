import { format } from "date-fns";
import { isErpLiveMode } from "@/lib/backendFlags";
import { deactivatePartyRpc, postPartyOpeningBalanceRpc, syncPartyOpeningScrapReceivablesRpc, type OpeningScrapLineInput } from "@/lib/api/posting";
import { supabase } from "@/lib/supabase";

export type PartyType = "Customer" | "Vendor" | "Both";
export type PartyRole = "customer" | "supplier" | "vendor";

export type { OpeningScrapLineInput } from "@/lib/api/posting";

export interface PartyRecord {
    id: string;
    name: string;
    type: PartyType;
    city?: string;
    phone?: string;
    taxRegNo?: string;
    creditLimit?: number;
    openingFinBalance?: number;
    openingMetalBalance?: number;
    openingScrapKg?: number;
    openingScrapRefRate?: number;
    openingScrapLines?: OpeningScrapLineInput[];
}

export const seedParties: PartyRecord[] = [
    { id: "CUST-001", name: "Gateway Motors", type: "Customer", city: "Lahore", phone: "+92 300 1234567" },
    { id: "CUST-002", name: "Alpha Wire Supply", type: "Customer", city: "Gujranwala", phone: "+92 301 1234567" },
    { id: "CUST-003", name: "Pak Fans Ltd", type: "Both", city: "Lahore", phone: "+92 302 1234567" },
    { id: "sup-001", name: "New Age Copper", type: "Vendor", city: "Lahore", phone: "+92 303 1234567" },
    { id: "sup-002", name: "Metal Exchange", type: "Vendor", city: "Karachi", phone: "+92 304 1234567" },
    { id: "sup-003", name: "Global Rods", type: "Vendor", city: "Gujranwala", phone: "+92 305 1234567" },
    { id: "VEND-101", name: "Gamma Scrap Traders", type: "Vendor", city: "Sialkot", phone: "+92 306 1234567" },
    { id: "VEND-102", name: "Delta Copper", type: "Vendor", city: "Karachi", phone: "+92 307 1234567" },
    { id: "WALK-IN", name: "Walk-In", type: "Customer" },
];

const STORAGE_KEY = "coppersync_party_catalog_v1";
const listeners = new Set<() => void>();

function loadParties(): PartyRecord[] {
    if (isErpLiveMode()) {
        return [];
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as PartyRecord[];
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {
        /* seed */
    }
    return [...seedParties];
}

let partyState: PartyRecord[] = loadParties();

function saveParties() {
    if (isErpLiveMode()) {
        listeners.forEach((fn) => fn());
        return;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(partyState));
    } catch {
        /* ignore */
    }
    listeners.forEach((fn) => fn());
}

export function subscribeParties(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

let initPartyPromise: Promise<void> | null = null;

export async function initPartyCatalog(): Promise<void> {
    if (!isErpLiveMode()) return;
    if (initPartyPromise) return initPartyPromise;
    initPartyPromise = (async () => {
    const { data, error } = await supabase
        .schema("erp")
        .from("parties")
        .select("code,name,party_type,city,phone,tax_reg_no,credit_limit,opening_fin_balance,opening_metal_balance,opening_scrap_kg,opening_scrap_ref_rate,is_active")
        .eq("is_active", true)
        .order("name");

    if (error || !data) return;

    const mapped: PartyRecord[] = data.map((row) => ({
        id: row.code,
        name: row.name,
        type:
            row.party_type === "customer"
                ? "Customer"
                : row.party_type === "vendor"
                  ? "Vendor"
                  : "Both",
        city: row.city ?? undefined,
        phone: row.phone ?? undefined,
        taxRegNo: row.tax_reg_no ?? undefined,
        creditLimit: Number(row.credit_limit ?? 0),
        openingFinBalance: Number(row.opening_fin_balance ?? 0),
        openingMetalBalance: Number(row.opening_metal_balance ?? 0),
        openingScrapKg: Number(row.opening_scrap_kg ?? 0),
        openingScrapRefRate: Number(row.opening_scrap_ref_rate ?? 0),
    }));

    partyState = mapped;
    saveParties();
    })();
    try {
        await initPartyPromise;
    } catch {
        initPartyPromise = null;
        throw new Error("Failed to load party catalog");
    }
}

export function getParties(): PartyRecord[] {
    return [...partyState];
}

/** True when live party catalog has been loaded at least once. */
export function isPartyCatalogHydrated(): boolean {
    return partyState.length > 0;
}

function sumOpeningScrapKg(lines: OpeningScrapLineInput[] | undefined): number {
    return (lines ?? []).reduce((sum, line) => sum + Number(line.expectedKg ?? 0), 0);
}

function primaryOpeningScrapRate(lines: OpeningScrapLineInput[] | undefined): number {
    const active = (lines ?? []).filter((line) => Number(line.expectedKg) > 0);
    return active.length ? Number(active[active.length - 1].refRate ?? 0) : 0;
}

function validateOpeningScrapLines(lines: OpeningScrapLineInput[] | undefined): void {
    for (const line of lines ?? []) {
        const kg = Number(line.expectedKg ?? 0);
        const rate = Number(line.refRate ?? 0);
        if ((kg > 0) !== (rate > 0)) {
            throw new Error("Each opening scrap line requires both expected kg and ref scrap rate.");
        }
    }
}

async function syncOpeningScrapLines(partyId: string, type: PartyType, lines: OpeningScrapLineInput[] | undefined): Promise<void> {
    const isCustomer = type === "Customer" || type === "Both";
    validateOpeningScrapLines(lines);
    const payload = isCustomer ? (lines ?? []).filter((line) => Number(line.expectedKg) > 0) : [];
    const scrapRes = await syncPartyOpeningScrapReceivablesRpc(partyId, payload);
    if (!scrapRes.ok) {
        throw new Error(scrapRes.error ?? "Opening scrap receivable sync failed.");
    }
}

export async function addParty(input: {
    name: string;
    type: PartyType;
    city?: string;
    phone?: string;
    taxRegNo?: string;
    creditLimit?: number;
    openingFinBalance?: number;
    openingMetalBalance?: number;
    openingScrapKg?: number;
    openingScrapRefRate?: number;
    openingScrapLines?: OpeningScrapLineInput[];
    idPrefix?: "CUST" | "VEND" | "PARTY";
}): Promise<PartyRecord> {
    const normalizedName = input.name.trim();
    if (!normalizedName) throw new Error("Party name is required");

    const duplicate = partyState.find((p) => p.name.toLowerCase() === normalizedName.toLowerCase());
    if (duplicate) throw new Error(`Party already exists: ${duplicate.name}`);

    const prefix = input.idPrefix ?? (input.type === "Vendor" ? "VEND" : "CUST");
    const samePrefix = partyState
        .map((p) => p.id)
        .filter((id) => id.toUpperCase().startsWith(prefix))
        .map((id) => Number(id.replace(/[^\d]/g, "")))
        .filter((n) => !Number.isNaN(n));
    let next = (samePrefix.length ? Math.max(...samePrefix) : 0) + 1;
    if (isErpLiveMode()) {
        const { data } = await supabase
            .schema("erp")
            .from("parties")
            .select("code")
            .ilike("code", `${prefix}-%`);
        const remoteMax = (data ?? [])
            .map((row) => Number(String(row.code ?? "").replace(/[^\d]/g, "")))
            .filter((n) => !Number.isNaN(n))
            .reduce((max, n) => Math.max(max, n), 0);
        next = Math.max(next, remoteMax + 1);
    }
    const nextId = `${prefix}-${String(next).padStart(3, "0")}`;

    const scrapLines = input.openingScrapLines ?? [];
    const row: PartyRecord = {
        id: nextId,
        name: normalizedName,
        type: input.type,
        city: input.city?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        taxRegNo: input.taxRegNo?.trim() || undefined,
        creditLimit: Number(input.creditLimit ?? 0),
        openingFinBalance: Number(input.openingFinBalance ?? 0),
        openingMetalBalance: Number(input.openingMetalBalance ?? 0),
        openingScrapKg: sumOpeningScrapKg(scrapLines),
        openingScrapRefRate: primaryOpeningScrapRate(scrapLines),
        openingScrapLines: scrapLines,
    };

    if (isErpLiveMode()) {
        const partyType =
            input.type === "Customer"
                ? "customer"
                : input.type === "Vendor"
                  ? "vendor"
                  : "both";

        const { data: inserted, error } = await supabase
            .schema("erp")
            .from("parties")
            .insert({
                code: row.id,
                name: row.name,
                party_type: partyType,
                city: row.city ?? null,
                phone: row.phone ?? null,
                tax_reg_no: row.taxRegNo ?? null,
                credit_limit: row.creditLimit ?? 0,
                opening_fin_balance: row.openingFinBalance ?? 0,
                opening_metal_balance: row.openingMetalBalance ?? 0,
                opening_scrap_kg: row.openingScrapKg ?? 0,
                opening_scrap_ref_rate: row.openingScrapRefRate ?? 0,
                is_active: true,
            })
            .select("id")
            .single();

        if (error) throw new Error(error.message);

        const fin = Number(row.openingFinBalance ?? 0);
        const metal = Number(row.openingMetalBalance ?? 0);
        if (inserted?.id && (fin !== 0 || metal !== 0)) {
            const res = await postPartyOpeningBalanceRpc(inserted.id, fin, metal);
            if (!res.ok) {
                throw new Error(res.error ?? "Opening balance posting failed.");
            }
        }

        if (inserted?.id) {
            await syncOpeningScrapLines(inserted.id, input.type, scrapLines);
        }
    }

    partyState = [...partyState, row];
    saveParties();
    return row;
}

function mapPartyTypeToDb(type: PartyType): "customer" | "vendor" | "both" {
    if (type === "Customer") return "customer";
    if (type === "Vendor") return "vendor";
    return "both";
}

export async function updateParty(
    code: string,
    patch: {
        name?: string;
        type?: PartyType;
        city?: string;
        phone?: string;
        taxRegNo?: string;
        creditLimit?: number;
        openingFinBalance?: number;
        openingMetalBalance?: number;
        openingScrapKg?: number;
        openingScrapRefRate?: number;
        openingScrapLines?: OpeningScrapLineInput[];
    }
): Promise<PartyRecord> {
    const idx = partyState.findIndex((p) => p.id === code);
    if (idx < 0) throw new Error(`Party not found: ${code}`);

    const current = partyState[idx];
    const nextName = patch.name?.trim() || current.name;
    if (!nextName) throw new Error("Party name is required");

    const duplicate = partyState.find(
        (p) => p.id !== code && p.name.toLowerCase() === nextName.toLowerCase()
    );
    if (duplicate) throw new Error(`Party already exists: ${duplicate.name}`);

    const nextScrapLines = patch.openingScrapLines ?? current.openingScrapLines ?? [];
    const next: PartyRecord = {
        ...current,
        name: nextName,
        type: patch.type ?? current.type,
        city: patch.city !== undefined ? patch.city.trim() || undefined : current.city,
        phone: patch.phone !== undefined ? patch.phone.trim() || undefined : current.phone,
        taxRegNo: patch.taxRegNo !== undefined ? patch.taxRegNo.trim() || undefined : current.taxRegNo,
        creditLimit: patch.creditLimit !== undefined ? Number(patch.creditLimit) : current.creditLimit,
        openingFinBalance: patch.openingFinBalance !== undefined ? Number(patch.openingFinBalance) : current.openingFinBalance,
        openingMetalBalance: patch.openingMetalBalance !== undefined ? Number(patch.openingMetalBalance) : current.openingMetalBalance,
        openingScrapLines: nextScrapLines,
        openingScrapKg: sumOpeningScrapKg(nextScrapLines),
        openingScrapRefRate: primaryOpeningScrapRate(nextScrapLines),
    };

    if (isErpLiveMode()) {
        const { data: updated, error } = await supabase
            .schema("erp")
            .from("parties")
            .update({
                name: next.name,
                party_type: mapPartyTypeToDb(next.type),
                city: next.city ?? null,
                phone: next.phone ?? null,
                tax_reg_no: next.taxRegNo ?? null,
                credit_limit: next.creditLimit ?? 0,
                opening_fin_balance: next.openingFinBalance ?? 0,
                opening_metal_balance: next.openingMetalBalance ?? 0,
                opening_scrap_kg: next.openingScrapKg ?? 0,
                opening_scrap_ref_rate: next.openingScrapRefRate ?? 0,
            })
            .eq("code", code)
            .select("id")
            .single();
        if (error) throw new Error(error.message);

        const finChanged = (current.openingFinBalance ?? 0) !== (next.openingFinBalance ?? 0);
        const metalChanged = (current.openingMetalBalance ?? 0) !== (next.openingMetalBalance ?? 0);
        if (updated?.id && (finChanged || metalChanged)) {
            const res = await postPartyOpeningBalanceRpc(
                updated.id,
                Number(next.openingFinBalance ?? 0),
                Number(next.openingMetalBalance ?? 0),
            );
            if (!res.ok) {
                throw new Error(res.error ?? "Opening balance posting failed.");
            }
        }

        const scrapChanged =
            patch.openingScrapLines !== undefined ||
            current.type !== next.type;
        if (updated?.id && scrapChanged) {
            await syncOpeningScrapLines(updated.id, next.type, nextScrapLines);
        }
    }

    partyState = partyState.map((p) => (p.id === code ? next : p));
    saveParties();
    return next;
}

export async function removeParty(code: string): Promise<void> {
    const exists = partyState.some((p) => p.id === code);
    if (!exists) throw new Error(`Party not found: ${code}`);

    if (isErpLiveMode()) {
        const res = await deactivatePartyRpc(code);
        if (!res.ok) throw new Error(res.error);
    }

    partyState = partyState.filter((p) => p.id !== code);
    saveParties();
}

export function getParty(id: string | undefined | null): PartyRecord | undefined {
    if (!id) return undefined;
    return partyState.find((p) => p.id === id);
}

export function resolvePartyName(id: string | undefined | null, fallback = "Unknown"): string {
    return getParty(id)?.name ?? fallback;
}

export function getPartiesByRole(role: PartyRole): PartyRecord[] {
    return partyState.filter((p) => {
        if (role === "customer") return p.type === "Customer" || p.type === "Both";
        if (role === "supplier") return p.type === "Vendor" || p.type === "Both";
        if (role === "vendor") return p.type === "Vendor" || p.type === "Both";
        return true;
    });
}

export function getCustomers(): PartyRecord[] {
    return getPartiesByRole("customer");
}

export function getSuppliers(): PartyRecord[] {
    return getPartiesByRole("supplier");
}

export function getVendors(): PartyRecord[] {
    return getPartiesByRole("vendor");
}

/** Parse YYYY-MM-DD (or ISO prefix) as a local calendar date — avoids UTC day-shift in UTC+ timezones. */
export function parseDocDate(value: Date | string | undefined | null): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value == null || value === "") return new Date();
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** ISO date (YYYY-MM-DD) in local calendar — never use toISOString() for user-picked dates. */
export function toDocDateISO(value: Date | string | undefined | null): string {
    if (!value) return format(new Date(), "yyyy-MM-dd");
    if (typeof value === "string") {
        const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
    }
    const d = value instanceof Date ? value : parseDocDate(value);
    return format(d, "yyyy-MM-dd");
}
