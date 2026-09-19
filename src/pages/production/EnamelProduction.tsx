import { useState, useEffect, useCallback, useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Edit, History, Factory, Search, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { applyStockMovement, InsufficientStockError } from "@/lib/inventoryStore";
import { initItemCatalog } from "@/lib/itemCatalog";
import {
    allocateNextProductionBatchNo,
    createProductionBatch,
    deleteProductionBatch,
    fetchProductionBatchesWithLines,
    postProductionBatchDocument,
    replaceProductionBatch,
} from "@/lib/repositories/productionRepo";
import {
    evaluateProductionAlerts,
    fetchProductionMachines,
    fetchProductionStandards,
    productionStandardNum,
    productionStandardText,
    type ProductionStandardRow,
} from "@/lib/api/production";
import { notifyProductionUpdated } from "@/lib/queryClient";
import {
    buildEnamelBatchLinesFromSections,
    DEFAULT_ENAMEL_VARNISH_PCT,
    DEFAULT_VARNISH_BLACK_ITEM_CODE,
    DEFAULT_VARNISH_ITEM_CODE,
    formatEnamelItemLabel,
    mapProductionBatchesToHistoryBatches,
    receiptLinesToEntryInputs,
    summarizeEnamelBatchDeductions,
    type EnamelBatchHistory,
    type EnamelProductionSection,
    isEnamelWireItemCode,
    isStripItemCode,
} from "@/lib/enamelProduction";
import {
    resolveWire8ItemCode,
    validateWire8ItemSettings,
    resolveRodItemCode,
    validateRodItemSettings,
} from "@/lib/productionWire8Settings";
import { agentDebugLog } from "@/lib/agentDebugLog";
import EnamelBatchEditor, { type EnamelProductionEntry } from "@/components/production/EnamelBatchEditor";
import {
    formatOutboundStockErrors,
    validateOutboundStock,
    aggregateOutboundDemand,
} from "@/lib/outboundStockValidation";
import { useInventory } from "@/contexts/InventoryContext";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { TabsScroller, TableScroller } from "@/components/ui/responsive-primitives";

const LAST_MACHINE_STORAGE_KEY = "erp.enamel.last_machine_id";

function readLastMachineId(): string {
    try {
        return sessionStorage.getItem(LAST_MACHINE_STORAGE_KEY) ?? "";
    } catch {
        return "";
    }
}

function persistLastMachineId(id: string) {
    try {
        if (id) sessionStorage.setItem(LAST_MACHINE_STORAGE_KEY, id);
    } catch {
        // ignore storage errors
    }
}

function entriesToApiLines(
    entries: EnamelProductionEntry[],
    options?: {
        varnishPct?: number;
        varnishGoldenCode?: string;
        varnishBlackCode?: string;
        goatPacking?: {
            thresholdMidLoKg?: number;
            thresholdMidHiKg?: number;
            goat5kgItemCode?: string;
            goat10kgItemCode?: string;
        };
        wireInputItemCode?: string;
        rodInputItemCode?: string;
    },
) {
    // Group entries by machine (preserving first-occurrence order) so each
    // machine section's Wire 8 / varnish / goat issues are attributed correctly.
    const order: string[] = [];
    const byMachine = new Map<string, EnamelProductionEntry[]>();
    for (const e of entries) {
        const key = e.machineId || "";
        if (!byMachine.has(key)) {
            order.push(key);
            byMachine.set(key, []);
        }
        byMachine.get(key)!.push(e);
    }
    const sections: EnamelProductionSection[] = order.map((key) => ({
        machineId: key || null,
        entries: byMachine.get(key)!.map((e) => ({
            lineId: e.lineId,
            itemCode: e.item,
            unitCount: e.unitCount,
            grossWeight: e.grossWeight,
            tareWeight: e.tareWeight,
            netWeight: e.netWeight,
            machineId: key || null,
        })),
    }));
    return buildEnamelBatchLinesFromSections(sections, options);
}

export default function EnamelProduction() {
    const liveMode = useBackendLiveMode();
    const { refreshBalances, getBalance, getUnitBalance } = useInventory();
    const [searchParams, setSearchParams] = useSearchParams();
    const editBatchId = searchParams.get("edit");

    const [activeTab, setActiveTab] = useState("new");
    const [catalogTick, setCatalogTick] = useState(0);

    const [previewBatchNo, setPreviewBatchNo] = useState("PRD-1000");
    const [editBatchNo, setEditBatchNo] = useState("");
    const [pendingEntries, setPendingEntries] = useState<EnamelProductionEntry[]>([]);
    const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

    const [batchHistory, setBatchHistory] = useState<EnamelBatchHistory[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [historySaving, setHistorySaving] = useState(false);
    const [batchSaving, setBatchSaving] = useState(false);
    const [itemPickerFocusToken, setItemPickerFocusToken] = useState(0);
    const [loadingEdit, setLoadingEdit] = useState(false);
    // Snapshot of the entries loaded for edit, used to credit back the batch's
    // already-posted issue quantities during the pre-save stock check so editing
    // a posted batch doesn't double-count consumption it already booked.
    const [editBaselineEntries, setEditBaselineEntries] = useState<EnamelProductionEntry[] | null>(null);
    const [machineId, setMachineId] = useState("");
    const [enamelMachines, setEnamelMachines] = useState<Awaited<ReturnType<typeof fetchProductionMachines>>>([]);
    const [varnishPct, setVarnishPct] = useState(DEFAULT_ENAMEL_VARNISH_PCT);
    const [varnishGoldenCode, setVarnishGoldenCode] = useState(DEFAULT_VARNISH_ITEM_CODE);
    const [varnishBlackCode, setVarnishBlackCode] = useState(DEFAULT_VARNISH_BLACK_ITEM_CODE);
    const [goatMidLoKg, setGoatMidLoKg] = useState(8);
    const [goatMidHiKg, setGoatMidHiKg] = useState(13);
    const [goat5kgCode, setGoat5kgCode] = useState("CON-GOT-001");
    const [goat10kgCode, setGoat10kgCode] = useState("CON-GOT-002");
    const [productionStandards, setProductionStandards] = useState<ProductionStandardRow[]>([]);

    const isEditMode = Boolean(editBatchId);

    const refreshPreviewBatchNo = useCallback(async () => {
        if (liveMode) {
            const next = await allocateNextProductionBatchNo();
            setPreviewBatchNo(next);
            return;
        }
        const lastId = localStorage.getItem("lastEnamelProductionId") || "1000";
        setPreviewBatchNo(`PRD-${String(lastId).padStart(4, "0")}`);
    }, [liveMode]);

    const fetchProductionScreenBatches = useCallback(async () => {
        const [enamelRows, workshopRows] = await Promise.all([
            fetchProductionBatchesWithLines("enamel"),
            fetchProductionBatchesWithLines("workshop"),
        ]);
        const byId = new Map<string, any>();
        for (const row of [...enamelRows, ...workshopRows]) {
            if (row?.id) byId.set(String(row.id), row);
        }
        return Array.from(byId.values()).sort((a, b) => {
            const dateDiff = String(b.batch_date ?? "").localeCompare(String(a.batch_date ?? ""));
            if (dateDiff !== 0) return dateDiff;
            return String(b.batch_no ?? "").localeCompare(String(a.batch_no ?? ""));
        });
    }, []);

    const loadHistory = useCallback(async () => {
        if (liveMode) {
            const rows = await fetchProductionScreenBatches();
            setBatchHistory(mapProductionBatchesToHistoryBatches(rows));
            return;
        }
        const savedHistory = localStorage.getItem("enamelProductionHistory");
        if (!savedHistory) {
            setBatchHistory([]);
            return;
        }
        try {
            const parsed = JSON.parse(savedHistory) as Array<{
                productionId: string;
                date: string;
                item: string;
                unitCount: string;
                grossWeight?: string;
                tareWeight?: string;
                netWeight: string;
            }>;
            const byBatch = new Map<string, EnamelBatchHistory>();
            for (const row of parsed) {
                const key = row.productionId;
                if (!byBatch.has(key)) {
                    byBatch.set(key, {
                        batchDbId: key,
                        productionId: key,
                        date: row.date,
                        posted: false,
                        status: "local",
                        lineCount: 0,
                        totalNetKg: 0,
                        totalUnits: 0,
                        itemSummary: "",
                        lineMachineIds: [],
                        isMultiMachine: false,
                        lines: [],
                    });
                }
                const batch = byBatch.get(key)!;
                batch.lines.push({
                    entryId: Math.random().toString(36).slice(2, 11),
                    productionId: key,
                    batchDbId: key,
                    date: row.date,
                    itemCode: row.item,
                    itemName: row.item,
                    unitCount: row.unitCount,
                    grossWeight: row.grossWeight,
                    tareWeight: row.tareWeight,
                    netWeight: row.netWeight,
                    status: "local",
                    posted: false,
                });
            }
            for (const batch of byBatch.values()) {
                batch.lineCount = batch.lines.length;
                batch.totalNetKg = batch.lines.reduce((s, l) => s + (Number(l.netWeight) || 0), 0);
                batch.totalUnits = batch.lines.reduce((s, l) => s + (Number(l.unitCount) || 0), 0);
                const first = batch.lines[0];
                batch.itemSummary =
                    batch.lines.length === 1 && first
                        ? formatEnamelItemLabel(first.itemCode)
                        : first
                          ? `${formatEnamelItemLabel(first.itemCode)} +${batch.lines.length - 1}`
                          : `${batch.lines.length} items`;
            }
            setBatchHistory(Array.from(byBatch.values()));
        } catch {
            setBatchHistory([]);
        }
    }, [fetchProductionScreenBatches, liveMode]);

    const loadBatchForEdit = useCallback(
        async (batchId: string) => {
            setLoadingEdit(true);
            try {
                if (liveMode) {
                    const rows = await fetchProductionScreenBatches();
                    const batch = rows.find((b: { id: string }) => b.id === batchId);
                    if (!batch) {
                        toast.error("Production batch not found.");
                        setSearchParams({});
                        return;
                    }
                    const history = mapProductionBatchesToHistoryBatches([batch])[0];
                    setEditBatchNo(batch.batch_no);
                    setDate(batch.batch_date);
                    const firstLineMachine = history.lines.find((l) => l.machineId)?.machineId ?? null;
                    const formMachine = String(firstLineMachine ?? batch.machine_id ?? "");
                    setMachineId(formMachine);
                    if (formMachine) persistLastMachineId(formMachine);
                    setPendingEntries(
                        receiptLinesToEntryInputs(history.lines).map((input, i) => ({
                            entryId: history.lines[i]?.entryId ?? String(i),
                            lineId: input.lineId,
                            item: input.itemCode,
                            unitCount: String(input.unitCount ?? ""),
                            grossWeight: input.grossWeight ? String(input.grossWeight) : undefined,
                            tareWeight: input.tareWeight ? String(input.tareWeight) : undefined,
                            netWeight: String(input.netWeight),
                            machineId: String(history.lines[i]?.machineId ?? batch.machine_id ?? ""),
                        })),
                    );
                    setEditBaselineEntries(
                        receiptLinesToEntryInputs(history.lines).map((input, i) => ({
                            entryId: history.lines[i]?.entryId ?? String(i),
                            lineId: input.lineId,
                            item: input.itemCode,
                            unitCount: String(input.unitCount ?? ""),
                            grossWeight: input.grossWeight ? String(input.grossWeight) : undefined,
                            tareWeight: input.tareWeight ? String(input.tareWeight) : undefined,
                            netWeight: String(input.netWeight),
                            machineId: String(history.lines[i]?.machineId ?? batch.machine_id ?? ""),
                        })),
                    );
                    return;
                }
                const batch = batchHistory.find((b) => b.batchDbId === batchId || b.productionId === batchId);
                if (!batch) {
                    toast.error("Production batch not found.");
                    setSearchParams({});
                    return;
                }
                setEditBatchNo(batch.productionId);
                setDate(batch.date);
                setPendingEntries(
                    receiptLinesToEntryInputs(batch.lines).map((input, i) => ({
                        entryId: batch.lines[i]?.entryId ?? String(i),
                        lineId: input.lineId,
                        item: input.itemCode,
                        unitCount: String(input.unitCount ?? ""),
                        grossWeight: input.grossWeight ? String(input.grossWeight) : undefined,
                        tareWeight: input.tareWeight ? String(input.tareWeight) : undefined,
                        netWeight: String(input.netWeight),
                        machineId: String(batch.lines[i]?.machineId ?? ""),
                    })),
                );
                setEditBaselineEntries(
                    receiptLinesToEntryInputs(batch.lines).map((input, i) => ({
                        entryId: batch.lines[i]?.entryId ?? String(i),
                        lineId: input.lineId,
                        item: input.itemCode,
                        unitCount: String(input.unitCount ?? ""),
                        grossWeight: input.grossWeight ? String(input.grossWeight) : undefined,
                        tareWeight: input.tareWeight ? String(input.tareWeight) : undefined,
                        netWeight: String(input.netWeight),
                        machineId: String(batch.lines[i]?.machineId ?? ""),
                    })),
                );
            } finally {
                setLoadingEdit(false);
            }
        },
        [fetchProductionScreenBatches, liveMode, batchHistory, setSearchParams],
    );

    useEffect(() => {
        void initItemCatalog().then(() => setCatalogTick((t) => t + 1));
    }, []);

    useEffect(() => {
        if (!liveMode) return;
        void Promise.all([
            fetchProductionMachines("enamel"),
            fetchProductionMachines("workshop"),
            fetchProductionStandards(),
        ]).then(([enamelMach, workshopMach, std]) => {
                setProductionStandards(std);
                const mach = [...enamelMach, ...workshopMach];
                setEnamelMachines(mach);
                setVarnishPct(productionStandardNum(std, "enamel_varnish_pct", DEFAULT_ENAMEL_VARNISH_PCT));
                setVarnishGoldenCode(
                    productionStandardText(std, "varnish_golden_item_code", DEFAULT_VARNISH_ITEM_CODE)
                        || productionStandardText(std, "varnish_item_code", DEFAULT_VARNISH_ITEM_CODE),
                );
                setVarnishBlackCode(
                    productionStandardText(std, "varnish_black_item_code", DEFAULT_VARNISH_BLACK_ITEM_CODE),
                );
                setGoatMidLoKg(productionStandardNum(std, "goat_packing_threshold_mid_lo_kg", 8));
                setGoatMidHiKg(productionStandardNum(std, "goat_packing_threshold_mid_hi_kg", 13));
                setGoat5kgCode(productionStandardText(std, "goat_packing_5kg_item_code", "CON-GOT-001"));
                setGoat10kgCode(productionStandardText(std, "goat_packing_10kg_item_code", "CON-GOT-002"));
                const firstActiveMachine = mach.find((m) => m.is_active);
                const lastUsed = readLastMachineId();
                const lastStillValid = lastUsed && mach.some((m) => m.id === lastUsed);
                setMachineId((prev) => {
                    if (prev) return prev;
                    if (lastStillValid) return lastUsed;
                    return firstActiveMachine?.id ?? "";
                });
            });
    }, [liveMode]);

    const entryInputs = useMemo(
        () =>
            pendingEntries.map((e) => ({
                itemCode: e.item,
                unitCount: e.unitCount,
                grossWeight: e.grossWeight,
                tareWeight: e.tareWeight,
                netWeight: e.netWeight,
                machineId: e.machineId,
            })),
        [pendingEntries],
    );

    const hasEnamelWireLines = pendingEntries.some((e) => isEnamelWireItemCode(e.item));
    const hasStripLines = pendingEntries.some((e) => isStripItemCode(e.item));

    const distinctMachineIds = useMemo(() => {
        const ids = new Set<string>();
        for (const e of pendingEntries) if (e.machineId) ids.add(e.machineId);
        return [...ids];
    }, [pendingEntries]);
    const machineCount = distinctMachineIds.length;
    // Header machine: single distinct line machine, else null (multi-machine).
    const headerMachineId = distinctMachineIds.length === 1 ? distinctMachineIds[0] : null;

    /** Batch process_type from line machines: all workshop → workshop; else enamel. */
    const resolvedProcessType = useMemo((): "enamel" | "workshop" => {
        if (distinctMachineIds.length === 0) return "enamel";
        const depts = new Set(
            distinctMachineIds.map(
                (id) => enamelMachines.find((m) => m.id === id)?.department ?? "enamel",
            ),
        );
        if (depts.size === 1 && depts.has("workshop")) return "workshop";
        return "enamel";
    }, [distinctMachineIds, enamelMachines]);

    const machineOptions = useMemo(
        () =>
            enamelMachines
                .filter((m) => m.is_active || m.id === machineId)
                .map((m) => ({ id: m.id, code: m.machine_code, name: m.name })),
        [enamelMachines, machineId],
    );

    const wireInputItemCode = useMemo(
        () => resolveWire8ItemCode(productionStandards),
        [productionStandards],
    );
    const wire8ConfigError = useMemo(
        () => (hasEnamelWireLines ? validateWire8ItemSettings(productionStandards) : null),
        [productionStandards, hasEnamelWireLines],
    );

    const rodInputItemCode = useMemo(
        () => resolveRodItemCode(productionStandards),
        [productionStandards],
    );
    const rodConfigError = useMemo(
        () => (hasStripLines ? validateRodItemSettings(productionStandards) : null),
        [productionStandards, hasStripLines],
    );

    const batchOptions = useMemo(
        () => ({
            varnishPct,
            varnishGoldenCode,
            varnishBlackCode,
            wireInputItemCode,
            rodInputItemCode,
            goatPacking: {
                thresholdMidLoKg: goatMidLoKg,
                thresholdMidHiKg: goatMidHiKg,
                goat5kgItemCode: goat5kgCode,
                goat10kgItemCode: goat10kgCode,
            },
        }),
        [
            varnishPct,
            varnishGoldenCode,
            varnishBlackCode,
            wireInputItemCode,
            rodInputItemCode,
            goatMidLoKg,
            goatMidHiKg,
            goat5kgCode,
            goat10kgCode,
        ],
    );

    const deductions = useMemo(
        () => summarizeEnamelBatchDeductions(entryInputs, batchOptions),
        [entryInputs, batchOptions],
    );

    const setMachineIdAndPersist = useCallback((id: string) => {
        setMachineId(id);
        persistLastMachineId(id);
    }, []);

    const totalOutputKg = pendingEntries.reduce((s, e) => s + (Number(e.netWeight) || 0), 0);

    useEffect(() => {
        void refreshPreviewBatchNo();
        void loadHistory();
    }, [liveMode, refreshPreviewBatchNo, loadHistory]);

    useEffect(() => {
        if (editBatchId) {
            setActiveTab("new");
            void loadBatchForEdit(editBatchId);
        } else {
            setEditBatchNo("");
            setPendingEntries([]);
            setEditBaselineEntries(null);
        }
    }, [editBatchId, loadBatchForEdit]);

    const handleSaveBatch = async (mode: "post" | "draft" = "post") => {
        if (pendingEntries.length === 0) {
            toast.error("Add at least one production line before saving.");
            return;
        }
        setBatchSaving(true);

        try {
            const lines = entriesToApiLines(pendingEntries, batchOptions);
            if (!lines.length) {
                toast.error("No valid production lines to save.");
                return;
            }
            if (liveMode) {
                const missingMachine = pendingEntries.find((e) => !e.machineId);
                if (missingMachine) {
                    toast.error("Every line needs a machine. Pick a machine before adding items.");
                    return;
                }
            }

            const needsWireIssue = lines.some(
                (l) => l.lineType === "issue" && l.warehouseType === "raw_material" && l.itemCode === wireInputItemCode,
            );
            if (needsWireIssue) {
                const wireErr = validateWire8ItemSettings(productionStandards);
                if (wireErr) {
                    toast.error(wireErr);
                    return;
                }
            }

            const needsRodIssue = lines.some(
                (l) => l.lineType === "issue" && l.warehouseType === "raw_material" && l.itemCode === rodInputItemCode,
            );
            if (needsRodIssue) {
                const rodErr = validateRodItemSettings(productionStandards);
                if (rodErr) {
                    toast.error(rodErr);
                    return;
                }
            }

            // Packing/goats are ledgered in qty (rolls), not units_in/units_out — never
            // gate them on getUnitBalance (always 0 for CON-GOT-*).
            const issueLines = lines
                .filter(
                    (l) =>
                        l.lineType === "issue" &&
                        (l.netWeight > 0 || (l.warehouseType === "packing_material" && Number(l.unitCount ?? 0) > 0)),
                )
                .map((l) => ({
                    itemCode: l.itemCode,
                    netWeight: l.netWeight,
                    unitCount: Number(l.unitCount ?? 0),
                    tracksUnits: false,
                }));
            // Drafts bypass the stock gate; it is enforced server-side on post.
            if (mode === "post") {
                // When editing a posted batch, current balances already reflect the
                // batch's existing issue quantities. Credit those back so we validate
                // only the incremental demand (otherwise every edit fails stock check).
                let availability: { getKg: (code: string) => number; getUnits: (code: string) => number } = {
                    getKg: getBalance,
                    getUnits: getUnitBalance,
                };
                if (isEditMode && editBaselineEntries) {
                    const baselineIssue = entriesToApiLines(editBaselineEntries, batchOptions)
                        .filter(
                            (l) =>
                                l.lineType === "issue" &&
                                (l.netWeight > 0 ||
                                    (l.warehouseType === "packing_material" && Number(l.unitCount ?? 0) > 0)),
                        )
                        .map((l) => ({
                            itemCode: l.itemCode,
                            netWeight: l.netWeight,
                            unitCount: Number(l.unitCount ?? 0),
                            tracksUnits: false,
                        }));
                    const { kgByItem, unitsByItem } = aggregateOutboundDemand(baselineIssue);
                    availability = {
                        getKg: (code) => getBalance(code) + (kgByItem[code] ?? 0),
                        getUnits: (code) => getUnitBalance(code) + (unitsByItem[code] ?? 0),
                    };
                }
                const stockCheck = validateOutboundStock({
                    lines: issueLines,
                    availability,
                });
                if (!stockCheck.ok) {
                    toast.error(formatOutboundStockErrors(stockCheck.errors));
                    return;
                }
            }

            const totalIn = lines
                .filter((l) => l.lineType === "issue" && l.warehouseType !== "packing_material")
                .reduce((s, l) => s + l.netWeight, 0);
            const totalOut = lines
                .filter((l) => l.lineType === "receipt")
                .reduce((s, l) => s + l.netWeight, 0);
            const totalScrap = 0;

            if (isEditMode && editBatchId) {
                if (liveMode) {
                    const result = await replaceProductionBatch({
                        batchId: editBatchId,
                        batchDate: date,
                        machineId: headerMachineId,
                        processType: resolvedProcessType,
                        inputKg: totalIn,
                        outputKg: totalOut,
                        scrapKg: totalScrap,
                        lines,
                        post: mode === "post",
                    });
                    if (!result.ok) {
                        toast.error(result.error);
                        return;
                    }
                    persistLastMachineId(machineId);
                    toast.success(
                        mode === "post"
                            ? `Production ${editBatchNo} updated across ${machineCount} machine${machineCount === 1 ? "" : "s"}.`
                            : `Production ${editBatchNo} saved as draft.`,
                    );
                    setSearchParams({});
                    setPendingEntries([]);
                    setEditBaselineEntries(null);
                    setActiveTab("history");
                    await loadHistory();
                    void refreshBalances();
                    setItemPickerFocusToken((token) => token + 1);
                    return;
                }
                const updated = batchHistory.map((b) =>
                    b.batchDbId === editBatchId
                        ? {
                              ...b,
                              date,
                              lines: pendingEntries.map((e) => ({
                                  entryId: e.entryId,
                                  productionId: editBatchNo,
                                  batchDbId: editBatchId,
                                  date,
                                  itemCode: e.item,
                                  itemName: e.item,
                                  unitCount: e.unitCount,
                                  grossWeight: e.grossWeight,
                                  tareWeight: e.tareWeight,
                                  netWeight: e.netWeight,
                                  status: "local",
                                  posted: false,
                              })),
                          }
                        : b,
                );
                setBatchHistory(updated);
                const flat = updated.flatMap((b) =>
                    b.lines.map((l) => ({
                        productionId: b.productionId,
                        date: b.date,
                        item: l.itemCode,
                        unitCount: l.unitCount,
                        grossWeight: l.grossWeight,
                        tareWeight: l.tareWeight,
                        netWeight: l.netWeight,
                    })),
                );
                localStorage.setItem("enamelProductionHistory", JSON.stringify(flat));
                toast.success(`Production ${editBatchNo} updated.`);
                setSearchParams({});
                setPendingEntries([]);
                setEditBaselineEntries(null);
                setActiveTab("history");
                setItemPickerFocusToken((token) => token + 1);
                return;
            }

            if (liveMode) {
                const batchNo = await allocateNextProductionBatchNo();
                agentDebugLog("EnamelProduction:save", "create batch", { batchNo, lineCount: lines.length });
                const created = await createProductionBatch({
                    batchNo,
                    processType: resolvedProcessType,
                    batchDate: date,
                    machineId: headerMachineId,
                    inputKg: totalIn,
                    outputKg: totalOut,
                    scrapKg: totalScrap,
                    lines,
                });
                if (!created.ok) {
                    agentDebugLog("EnamelProduction:save", "create failed", { error: created.error?.slice(0, 160) });
                    toast.error(created.error);
                    return;
                }
                if (mode === "post") {
                    const posted = await postProductionBatchDocument(created.data.id);
                    if (!posted.ok) {
                        agentDebugLog("EnamelProduction:save", "post failed", { error: posted.error?.slice(0, 160) });
                        toast.error(posted.error ?? "Posting failed");
                        return;
                    }
                }
                const alertRes = mode === "post" ? await evaluateProductionAlerts() : { ok: true as const, data: 0 };
                if (mode === "post") notifyProductionUpdated();
                if (mode === "post") {
                    for (const line of lines) {
                        try {
                            if (line.lineType === "issue") {
                                applyStockMovement({
                                    type: "PRODUCTION_ISSUE",
                                    itemCode: line.itemCode,
                                    qty: line.netWeight,
                                    refDocId: batchNo,
                                    refDocType: "ENAMEL_PRODUCTION",
                                    docDate: date,
                                });
                            } else if (line.lineType === "receipt") {
                                applyStockMovement({
                                    type: "PRODUCTION_RECEIPT",
                                    itemCode: line.itemCode,
                                    qty: line.netWeight,
                                    refDocId: batchNo,
                                    refDocType: "ENAMEL_PRODUCTION",
                                    docDate: date,
                                });
                            }
                        } catch {
                            /* background refresh reconciles */
                        }
                    }
                }
                setPendingEntries([]);
                persistLastMachineId(machineId);
                const alertNote =
                    mode === "post" && alertRes.ok && alertRes.data > 0
                        ? ` ${alertRes.data} production alert(s) created or updated.`
                        : "";
                toast.success(
                    mode === "post"
                        ? `Production ${batchNo} posted to ERP across ${machineCount} machine${machineCount === 1 ? "" : "s"}.${alertNote}`
                        : `Production ${batchNo} saved as draft.`,
                );
                void refreshBalances();
                await loadHistory();
                if (mode === "post") void refreshPreviewBatchNo();
                setItemPickerFocusToken((token) => token + 1);
                return;
            }

            const batchId = previewBatchNo;
            try {
                for (const line of lines) {
                    const qty = line.netWeight;
                    if (qty <= 0) continue;
                    if (line.lineType === "issue") {
                        applyStockMovement({
                            type: "PRODUCTION_ISSUE",
                            itemCode: line.itemCode,
                            qty,
                            refDocId: batchId,
                            refDocType: "ENAMEL_PRODUCTION",
                            docDate: date,
                        });
                    } else if (line.lineType === "receipt") {
                        applyStockMovement({
                            type: "PRODUCTION_RECEIPT",
                            itemCode: line.itemCode,
                            qty,
                            refDocId: batchId,
                            refDocType: "ENAMEL_PRODUCTION",
                            docDate: date,
                        });
                    }
                }
            } catch (e) {
                toast.error(e instanceof InsufficientStockError ? e.message : "Stock update failed");
                return;
            }
            const flat = [
                ...batchHistory.flatMap((b) =>
                    b.lines.map((l) => ({
                        productionId: b.productionId,
                        date: b.date,
                        item: l.itemCode,
                        unitCount: l.unitCount,
                        grossWeight: l.grossWeight,
                        tareWeight: l.tareWeight,
                        netWeight: l.netWeight,
                    })),
                ),
                ...pendingEntries.map((e) => ({
                    productionId: batchId,
                    date,
                    item: e.item,
                    unitCount: e.unitCount,
                    grossWeight: e.grossWeight,
                    tareWeight: e.tareWeight,
                    netWeight: e.netWeight,
                })),
            ];
            localStorage.setItem("enamelProductionHistory", JSON.stringify(flat));
            const nextNum = parseInt(batchId.replace(/\D/g, ""), 10) + 1;
            localStorage.setItem("lastEnamelProductionId", String(nextNum));
            setPreviewBatchNo(`PRD-${String(nextNum).padStart(4, "0")}`);
        setPendingEntries([]);
            await loadHistory();
            toast.success(`Production ${batchId} saved — inventory updated.`);
            setItemPickerFocusToken((token) => token + 1);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to save production batch.";
            toast.error(msg);
        } finally {
            setBatchSaving(false);
        }
    };

    const handleSaveDraft = () => void handleSaveBatch("draft");

    const handlePostDraft = async (batch: EnamelBatchHistory) => {
        if (!batch.batchDbId) return;
        setHistorySaving(true);
        try {
            const posted = await postProductionBatchDocument(batch.batchDbId);
            if (!posted.ok) {
                toast.error(posted.error ?? "Posting failed");
                return;
            }
            toast.success(`Production ${batch.productionId} posted.`);
            await loadHistory();
            void refreshBalances();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to post production batch.");
        } finally {
            setHistorySaving(false);
        }
    };

    const handleDeleteBatch = async (batch: EnamelBatchHistory) => {
        const isPosted = batch.posted || batch.status === "posted";
        const verb = isPosted ? "void" : "delete";
        if (!confirm(`Are you sure you want to ${verb} batch ${batch.productionId}? ${isPosted ? "Inventory and GL will be reversed; the batch is preserved as voided." : "Inventory will be reversed."}`)) return;
        setHistorySaving(true);
        try {
            if (liveMode) {
                const result = await deleteProductionBatch(batch.batchDbId);
                if (!result.ok) {
                    toast.error(result.error);
                    return;
                }
                if (editBatchId === batch.batchDbId) setSearchParams({});
                toast.success(`Production ${batch.productionId} ${isPosted ? "voided." : "deleted."}`);
                await loadHistory();
                void refreshBalances();
                return;
            }
            const updated = batchHistory.filter((b) => b.productionId !== batch.productionId);
            setBatchHistory(updated);
            const flat = updated.flatMap((b) =>
                b.lines.map((l) => ({
                    productionId: b.productionId,
                    date: b.date,
                    item: l.itemCode,
                    unitCount: l.unitCount,
                    grossWeight: l.grossWeight,
                    tareWeight: l.tareWeight,
                    netWeight: l.netWeight,
                })),
            );
            localStorage.setItem("enamelProductionHistory", JSON.stringify(flat));
            toast.success("Batch deleted");
        } finally {
            setHistorySaving(false);
        }
    };

    const handleEditBatch = (batch: EnamelBatchHistory) => {
        setSearchParams({ edit: batch.batchDbId });
        setActiveTab("new");
    };

    const formatHistoryDate = (dateStr: string) => {
        try {
            return format(parseISO(dateStr), "dd MMM yyyy");
        } catch {
            return dateStr;
        }
    };

    const filteredHistory = batchHistory.filter((b) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            b.productionId.toLowerCase().includes(q) ||
            b.date.includes(q) ||
            b.itemSummary.toLowerCase().includes(q) ||
            (b.machineCode ?? "").toLowerCase().includes(q) ||
            (b.machineName ?? "").toLowerCase().includes(q) ||
            b.lines.some(
                (l) =>
                    l.itemCode.toLowerCase().includes(q) ||
                    formatEnamelItemLabel(l.itemCode).toLowerCase().includes(q),
            )
        );
    });

    const batchLabel = isEditMode ? editBatchNo : previewBatchNo;

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-7xl mx-auto">
                <div className="flex items-center gap-4">
                    <Link to="/production">
                        <Button variant="ghost" size="icon" className="hover:bg-slate-100">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                            {isEditMode ? `Edit Production ${editBatchNo}` : "Production"}
                        </h1>
                        <p className="text-slate-500">
                            {isEditMode
                                ? "Update all lines in this batch, then save."
                                : "Record enamel wire and copper strip batches."}
                        </p>
                    </div>
                    {isEditMode && (
                        <Button
                            variant="outline"
                            className="ml-auto"
                            onClick={() => {
                                setSearchParams({});
                                setPendingEntries([]);
                                setEditBaselineEntries(null);
                            }}
                        >
                            Cancel edit
                        </Button>
                    )}
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsScroller>
                    <TabsList className="grid w-full sm:w-[400px] grid-cols-2">
                        <TabsTrigger value="new" className="flex items-center gap-2">
                                <Factory className="h-4 w-4" />{" "}
                                {isEditMode ? "Edit Batch" : "New Production"}
                        </TabsTrigger>
                        <TabsTrigger value="history" className="flex items-center gap-2">
                                <History className="h-4 w-4" /> History
                        </TabsTrigger>
                    </TabsList>
                    </TabsScroller>

                    <TabsContent value="new" className="mt-6 space-y-6">
                        {loadingEdit ? (
                            <div className="py-16 text-center text-slate-500">Loading batch…</div>
                        ) : (
                            <>
                                {liveMode && (
                                    <Card className="border-slate-200">
                                        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Machines in batch</Label>
                                                <Input
                                                    readOnly
                                                    className="font-mono bg-slate-50"
                                                    value={
                                                        machineCount === 0
                                                            ? "—"
                                                            : `${machineCount} machine${machineCount === 1 ? "" : "s"}`
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Batch output (kg)</Label>
                                                <Input
                                                    readOnly
                                                    className="font-mono bg-slate-50"
                                                    value={totalOutputKg.toLocaleString()}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Varnish standard</Label>
                                                <Input readOnly className="font-mono bg-slate-50" value={`${varnishPct}% of output`} />
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}
                                {wire8ConfigError && (
                                    <Card className="border-amber-200 bg-amber-50">
                                        <CardContent className="pt-4 pb-4 text-sm text-amber-900">
                                            {wire8ConfigError}{" "}
                                            <Link to="/admin/production-settings" className="underline font-medium">
                                                Production Settings → Wire No 8
                                            </Link>
                                        </CardContent>
                                    </Card>
                                )}
                                {hasEnamelWireLines && pendingEntries.length > 0 && !wire8ConfigError && wireInputItemCode && (
                                    <Card className="border-slate-200 bg-slate-50/50">
                                        <CardContent className="pt-4 pb-4 text-sm text-slate-600">
                                            Wire No 8 input:{" "}
                                            <span className="font-mono font-medium text-slate-800">{wireInputItemCode}</span>
                                </CardContent>
                            </Card>
                                )}
                                {rodConfigError && (
                                    <Card className="border-amber-200 bg-amber-50">
                                        <CardContent className="pt-4 pb-4 text-sm text-amber-900">
                                            {rodConfigError}{" "}
                                            <Link to="/admin/production-settings" className="underline font-medium">
                                                Production Settings → Rod input item
                                            </Link>
                                        </CardContent>
                                    </Card>
                                )}
                                {hasStripLines && pendingEntries.length > 0 && !rodConfigError && rodInputItemCode && (
                                    <Card className="border-slate-200 bg-slate-50/50">
                                        <CardContent className="pt-4 pb-4 text-sm text-slate-600">
                                            Copper rod input:{" "}
                                            <span className="font-mono font-medium text-slate-800">{rodInputItemCode}</span>
                                        </CardContent>
                                    </Card>
                                )}
                                {hasEnamelWireLines && pendingEntries.length > 0 && (
                                    <Card className="border-blue-100 bg-blue-50/40">
                                        <CardContent className="pt-4 pb-4">
                                            <p className="text-sm font-medium text-slate-800 mb-2">Auto deductions on save</p>
                                            <ul className="text-sm text-slate-600 space-y-1">
                                                <li>
                                                    Machines:{" "}
                                                    <span className="font-mono font-medium text-slate-800">
                                                        {machineCount === 0
                                                            ? "—"
                                                            : `${machineCount} machine${machineCount === 1 ? "" : "s"}`}
                                        </span>
                                                </li>
                                                {Object.entries(deductions.varnishByCode).map(([code, kg]) => (
                                                    <li key={code}>
                                                        Varnish {formatEnamelItemLabel(code)}:{" "}
                                                        <span className="font-mono font-medium">{kg.toLocaleString()} kg</span>
                                                    </li>
                                                ))}
                                                {Object.entries(deductions.goatsByCode).map(([code, rolls]) => (
                                                    <li key={code}>
                                                        Packing {formatEnamelItemLabel(code)}:{" "}
                                                        <span className="font-mono font-medium">{rolls.toLocaleString()} roll(s)</span>
                                                    </li>
                                                ))}
                                                {deductions.totalVarnishKg === 0 && deductions.totalGoatRolls === 0 ? (
                                                    <li className="text-slate-500">
                                                        Add enamel wire lines with units (goats) for varnish and packing deductions.
                                                    </li>
                                                ) : null}
                                            </ul>
                                            <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                                                Golden/black varnish follows each FG item colour at {varnishPct}%. Goats: if avg
                                                output ÷ units is under {goatMidLoKg} kg use 5 kg goats; from {goatMidLoKg} kg up to{" "}
                                                {goatMidHiKg} kg use 10 kg goats (one roll per unit).
                                            </p>
                                </CardContent>
                            </Card>
                                )}
                            <EnamelBatchEditor
                                batchLabel={batchLabel}
                                batchDate={date}
                                onBatchDateChange={setDate}
                                entries={pendingEntries}
                                onEntriesChange={setPendingEntries}
                                onSave={() => void handleSaveBatch()}
                                saveLabel={isEditMode ? "Update Production Batch" : "Save Production Batch"}
                                saving={batchSaving}
                                onSaveDraft={() => void handleSaveDraft()}
                                catalogTick={catalogTick}
                                focusItemPickerToken={itemPickerFocusToken}
                                machines={machineOptions}
                                machineId={machineId}
                                onMachineChange={setMachineIdAndPersist}
                            />
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="history" className="mt-6">
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader className="bg-white border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-lg font-semibold text-slate-800">
                                        Production History
                                    </CardTitle>
                                    <CardDescription>
                                        One row per batch — edit opens the full production form.
                                    </CardDescription>
                                </div>
                                <div className="relative w-full sm:w-72">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Search batch, item, date…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-9"
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="p-0 overflow-hidden">
                                <TableScroller>
                                    <Table noWrapper className="min-w-[800px]">
                                    <TableHeader>
                                        <TableRow className="bg-slate-50">
                                            <TableHead className="w-[120px]">Prod ID</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Machine</TableHead>
                                                <TableHead>Items</TableHead>
                                                <TableHead className="text-right">Total net (kg)</TableHead>
                                                <TableHead className="w-[100px]">Status</TableHead>
                                            <TableHead className="w-[100px] text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                            {filteredHistory.length === 0 && (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={7}
                                                        className="py-10 text-center text-sm text-slate-500"
                                                    >
                                                        {batchHistory.length === 0
                                                            ? "No production history yet."
                                                            : "No records match your search."}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                            {filteredHistory.map((batch) => (
                                                <TableRow key={batch.batchDbId}>
                                                    <TableCell className="font-mono font-medium text-blue-600">
                                                        {batch.productionId}
                                                    </TableCell>
                                                    <TableCell className="text-slate-700">
                                                        {formatHistoryDate(batch.date)}
                                                    </TableCell>
                                                    <TableCell className="text-slate-700 text-sm font-mono">
                                                        {batch.isMultiMachine
                                                            ? "Multiple machines"
                                                            : (batch.machineCode ?? "—")}
                                                        {!batch.isMultiMachine && batch.machineName ? (
                                                            <span className="block text-xs text-slate-400 font-sans">
                                                                {batch.machineName}
                                                            </span>
                                                        ) : null}
                                                    </TableCell>
                                                    <TableCell className="text-slate-700 text-sm max-w-[280px]">
                                                        {batch.itemSummary}
                                                        <span className="text-xs text-slate-400 ml-1">
                                                            ({batch.lineCount} line
                                                            {batch.lineCount === 1 ? "" : "s"})
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-emerald-600">
                                                        {batch.totalNetKg.toLocaleString()} kg
                                                    </TableCell>
                                                <TableCell>
                                                        {batch.posted ? (
                                                            <Badge variant="secondary" className="text-xs">
                                                                Posted
                                                            </Badge>
                                                        ) : batch.status === "draft" && liveMode ? (
                                                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                                                                Draft
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="text-xs">
                                                                Local
                                                            </Badge>
                                                        )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                        {liveMode && !batch.posted && batch.status === "draft" ? (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={historySaving}
                                                                onClick={() => void handlePostDraft(batch)}
                                                                className="text-emerald-700 hover:bg-emerald-50"
                                                            >
                                                                Post
                                                            </Button>
                                                        ) : null}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            disabled={historySaving}
                                                            onClick={() => handleEditBatch(batch)}
                                                        >
                                                        <Edit className="h-4 w-4 text-blue-600" />
                                                    </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            disabled={historySaving}
                                                            onClick={() => void handleDeleteBatch(batch)}
                                                        >
                                                        <Trash2 className="h-4 w-4 text-rose-500" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </TableScroller>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
