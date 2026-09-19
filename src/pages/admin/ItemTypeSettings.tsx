import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Save, Tags } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useBackendLiveMode } from "@/lib/backendFlags";
import {
    deactivateItemProductType,
    deleteItemProductType,
    upsertItemProductType,
} from "@/lib/api/itemProductTypes";
import {
    FORM_TEMPLATE_LABELS,
    INVENTORY_GROUP_OPTIONS,
    type ItemFormTemplate,
    type ItemProductTypeRow,
} from "@/lib/itemProductTypes";
import { TOP_CATEGORIES, type TopCategory } from "@/lib/itemFormSchema";
import { useItemProductTypes, invalidateItemProductTypesCache } from "@/hooks/useItemProductTypes";
import { TabsScroller, TableScroller } from "@/components/ui/responsive-primitives";

type FormDraft = {
    id?: string;
    label: string;
    slug: string;
    inventoryGroup: string;
    itemType: string;
    codePrefix: string;
    formTemplate: ItemFormTemplate;
    sortOrder: string;
    isActive: boolean;
};

const EMPTY_DRAFT = (topCategory: TopCategory): FormDraft => ({
    label: "",
    slug: "",
    inventoryGroup: INVENTORY_GROUP_OPTIONS[topCategory][0],
    itemType: "",
    codePrefix: "",
    formTemplate: "free_text",
    sortOrder: "100",
    isActive: true,
});

export default function ItemTypeSettings() {
    const liveMode = useBackendLiveMode();
    const { toast } = useToast();
    const { allTypes, refresh } = useItemProductTypes(undefined, false);
    const [tab, setTab] = useState<TopCategory>("Finished Goods");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [draft, setDraft] = useState<FormDraft>(() => EMPTY_DRAFT("Finished Goods"));
    const [saving, setSaving] = useState(false);

    const rows = allTypes.filter((t) => t.topCategory === tab);

    const openCreate = () => {
        setDraft(EMPTY_DRAFT(tab));
        setDialogOpen(true);
    };

    const openEdit = (row: ItemProductTypeRow) => {
        setDraft({
            id: row.id,
            label: row.label,
            slug: row.slug,
            inventoryGroup: row.inventoryGroup,
            itemType: row.itemType,
            codePrefix: row.codePrefix,
            formTemplate: row.formTemplate,
            sortOrder: String(row.sortOrder),
            isActive: row.isActive,
        });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!liveMode) {
            toast({ title: "Live mode required", variant: "destructive" });
            return;
        }
        if (!draft.label.trim() || !draft.itemType.trim() || !draft.codePrefix.trim()) {
            toast({ title: "Fill required fields", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            const result = await upsertItemProductType({
                id: draft.id,
                topCategory: tab,
                label: draft.label,
                slug: draft.slug || undefined,
                inventoryGroup: draft.inventoryGroup as FormDraft["inventoryGroup"] & import("@/lib/itemProductTypes").InventoryGroupDb,
                itemType: draft.itemType,
                codePrefix: draft.codePrefix,
                formTemplate: draft.formTemplate,
                sortOrder: Number(draft.sortOrder) || 100,
                isActive: draft.isActive,
            });
            if (!result.ok) {
                toast({ title: "Save failed", description: result.error, variant: "destructive" });
                return;
            }
            invalidateItemProductTypesCache();
            await refresh();
            setDialogOpen(false);
            toast({ title: "Product type saved", description: result.row.label });
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (row: ItemProductTypeRow) => {
        if (row.isSystem) return;
        if (!window.confirm(`Deactivate "${row.label}"? It will no longer appear in Add Item.`)) return;
        const result = await deactivateItemProductType(row.id);
        if (!result.ok) {
            toast({ title: "Failed", description: result.error, variant: "destructive" });
            return;
        }
        invalidateItemProductTypesCache();
        await refresh();
        toast({ title: "Deactivated", description: row.label });
    };

    const handleDelete = async (row: ItemProductTypeRow) => {
        if (row.isSystem) return;
        if (!window.confirm(`Delete "${row.label}" permanently?`)) return;
        const result = await deleteItemProductType(row.id);
        if (!result.ok) {
            toast({ title: "Failed", description: result.error, variant: "destructive" });
            return;
        }
        invalidateItemProductTypesCache();
        await refresh();
        toast({ title: "Deleted", description: row.label });
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                            <Tags className="h-8 w-8 text-blue-600" />
                            Item Product Types
                        </h1>
                        <p className="text-slate-500">
                            Configure product types shown in Item Master. System types can be edited but not deleted.
                        </p>
                    </div>
                    <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Add type
                    </Button>
                </div>

                <Card className="shadow-soft border-slate-100">
                    <CardHeader>
                        <CardTitle>Types by category</CardTitle>
                        <CardDescription>
                            Each type picks a field template that controls the Add Item form.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Tabs value={tab} onValueChange={(v) => setTab(v as TopCategory)}>
                            <TabsScroller className="sm:flex-1">
                            <TabsList className="mb-4">
                                {TOP_CATEGORIES.map((c) => (
                                    <TabsTrigger key={c} value={c}>
                                        {c}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                            </TabsScroller>
                            {TOP_CATEGORIES.map((c) => (
                                <TabsContent key={c} value={c}>
                                    <TableScroller>
                                        <Table noWrapper>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Label</TableHead>
                                                    <TableHead>Template</TableHead>
                                                    <TableHead>Prefix</TableHead>
                                                    <TableHead>Inventory group</TableHead>
                                                    <TableHead>Active</TableHead>
                                                    <TableHead className="text-right">Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {rows.map((row) => (
                                                    <TableRow key={row.id}>
                                                        <TableCell className="font-medium">
                                                            {row.label}
                                                            {row.isSystem ? (
                                                                <Badge variant="secondary" className="ml-2 text-[10px]">
                                                                    System
                                                                </Badge>
                                                            ) : null}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-slate-600">
                                                            {FORM_TEMPLATE_LABELS[row.formTemplate]}
                                                        </TableCell>
                                                        <TableCell className="font-mono text-sm">{row.codePrefix}</TableCell>
                                                        <TableCell className="text-sm">{row.inventoryGroup}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={row.isActive ? "default" : "outline"}>
                                                                {row.isActive ? "Yes" : "No"}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right space-x-2">
                                                            <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                                                                Edit
                                                            </Button>
                                                            {!row.isSystem && (
                                                                <>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        onClick={() => void handleDeactivate(row)}
                                                                    >
                                                                        Deactivate
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="text-rose-600"
                                                                        onClick={() => void handleDelete(row)}
                                                                    >
                                                                        Delete
                                                                    </Button>
                                                                </>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableScroller>
                                </TabsContent>
                            ))}
                        </Tabs>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{draft.id ? "Edit product type" : "Add product type"}</DialogTitle>
                        <DialogDescription>Category: {tab}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label>Label</Label>
                            <Input
                                value={draft.label}
                                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                                placeholder="e.g. Copper Wire"
                            />
                        </div>
                        {!draft.id && (
                            <div className="grid gap-2">
                                <Label>Slug (optional)</Label>
                                <Input
                                    value={draft.slug}
                                    onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                                    placeholder="auto from label"
                                />
                            </div>
                        )}
                        <div className="grid gap-2">
                            <Label>Item type (stored in DB)</Label>
                            <Input
                                value={draft.itemType}
                                onChange={(e) => setDraft((d) => ({ ...d, itemType: e.target.value }))}
                                placeholder="e.g. Copper Wire"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Code prefix</Label>
                            <Input
                                value={draft.codePrefix}
                                onChange={(e) => setDraft((d) => ({ ...d, codePrefix: e.target.value.toUpperCase() }))}
                                placeholder="e.g. FG-CUW"
                                className="font-mono"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Inventory group</Label>
                            <Select
                                value={draft.inventoryGroup}
                                onValueChange={(v) => setDraft((d) => ({ ...d, inventoryGroup: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {INVENTORY_GROUP_OPTIONS[tab].map((g) => (
                                        <SelectItem key={g} value={g}>
                                            {g}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Field template</Label>
                            <Select
                                value={draft.formTemplate}
                                onValueChange={(v) =>
                                    setDraft((d) => ({ ...d, formTemplate: v as ItemFormTemplate }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(FORM_TEMPLATE_LABELS) as ItemFormTemplate[]).map((k) => (
                                        <SelectItem key={k} value={k}>
                                            {FORM_TEMPLATE_LABELS[k]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Sort order</Label>
                            <Input
                                type="number"
                                value={draft.sortOrder}
                                onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label>Active</Label>
                            <Switch
                                checked={draft.isActive}
                                onCheckedChange={(c) => setDraft((d) => ({ ...d, isActive: c }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void handleSave()} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                            <Save className="h-4 w-4 mr-2" />
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
}
