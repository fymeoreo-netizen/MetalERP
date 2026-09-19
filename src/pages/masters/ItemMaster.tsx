import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Plus, Filter, Pencil, Trash2, Upload, Replace } from "lucide-react";
import { useState } from "react";
import { AddItemModal } from "@/components/masters/AddItemModal";
import { ReclassifyItemModal } from "@/components/masters/ReclassifyItemModal";
import { OpeningStockImportDialog } from "@/components/masters/OpeningStockImportDialog";
import { getDisplayCategory, getDisplaySpec, getDisplayType, buildItemDisplayName } from "@/lib/itemFormSchema";
import { getInventorySection, getSectionLabel, getWarehouseLabel, getWarehouseType, removeCatalogItem, type ItemMasterRecord } from "@/lib/itemCatalog";
import { useInventory } from "@/contexts/InventoryContext";
import { removeItemFromInventoryState } from "@/lib/inventoryStore";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { useToast } from "@/components/ui/use-toast";

export default function ItemMaster() {
    const { catalog, getBalance, refresh } = useInventory();
    const { toast } = useToast();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ItemMasterRecord | null>(null);
    const [reclassifyItem, setReclassifyItem] = useState<ItemMasterRecord | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const getCategoryColor = (cat: string) => {
        switch (cat) {
            case "Raw Material":
                return "bg-slate-100 text-slate-700";
            case "Enameled":
            case "Finished Goods":
                return "bg-emerald-100 text-emerald-700";
            case "Strip":
                return "bg-emerald-100 text-emerald-700";
            case "Copper Wire":
                return "bg-orange-100 text-orange-800";
            case "Chemicals":
            case "Chemical":
                return "bg-purple-100 text-purple-700";
            case "Packing Material":
            case "Consumable":
                return "bg-amber-100 text-amber-700";
            case "Scrap":
                return "bg-rose-100 text-rose-700";
            default:
                return "bg-slate-100 text-slate-700";
        }
    };

    const handleDeleteItem = async (item: ItemMasterRecord) => {
        const onHand = getBalance(item.code);
        const stockNote =
            onHand > 0.001
                ? `\n\nOn-hand stock (${onHand.toLocaleString()} ${item.unit}) will be written off.`
                : "";
        const confirmed = window.confirm(
            `Remove item ${item.code} from the catalog?\n\n${buildItemDisplayName(item)}${stockNote}\n\nIt will be hidden from pickers. Historical transactions are kept.`,
        );
        if (!confirmed) return;
        try {
            await removeCatalogItem(item.code);
            removeItemFromInventoryState(item.code);
            await refresh();
            toast({
                title: "Item removed",
                description:
                    onHand > 0.001
                        ? `${item.code} deactivated and ${onHand.toLocaleString()} ${item.unit} written off.`
                        : `${item.code} has been deactivated.`,
            });
        } catch (e) {
            toast({
                title: "Delete failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    const filteredItems = catalog.filter((item) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const displayCat = getDisplayCategory(item);
        const displayType = getDisplayType(item);
        const displaySpec = getDisplaySpec(item);
        const label = buildItemDisplayName(item);
        return (
            item.code.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q) ||
            displayCat.toLowerCase().includes(q) ||
            displayType.toLowerCase().includes(q) ||
            displaySpec.toLowerCase().includes(q) ||
            item.itemType.toLowerCase().includes(q) ||
            item.sizeSpec.toLowerCase().includes(q)
        );
    });

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Item Master</h1>
                        <p className="text-slate-500">Manage catalog items, categories, and warehouse placement.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="shadow-sm w-full sm:w-auto" onClick={() => setIsImportOpen(true)}>
                            <Upload className="h-4 w-4 mr-2" />
                            Import Opening Stock
                        </Button>
                        <Button variant="outline" className="shadow-sm w-full sm:w-auto">
                            <Filter className="h-4 w-4 mr-2" />
                            Filter
                        </Button>
                        <Button onClick={() => setIsAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto">
                            <Plus className="h-4 w-4 mr-2" />
                            Add Item
                        </Button>
                    </div>
                </div>

                <AddItemModal open={isAddOpen} onOpenChange={setIsAddOpen} mode="add" />
                <OpeningStockImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
                <AddItemModal
                    open={Boolean(editingItem)}
                    onOpenChange={(next) => {
                        if (!next) setEditingItem(null);
                    }}
                    mode="edit"
                    initialItem={editingItem}
                    onDone={() => setEditingItem(null)}
                />
                <ReclassifyItemModal
                    open={Boolean(reclassifyItem)}
                    onOpenChange={(next) => {
                        if (!next) setReclassifyItem(null);
                    }}
                    item={reclassifyItem}
                    onDone={async () => {
                        setReclassifyItem(null);
                        await refresh();
                    }}
                />

                <Card className="shadow-soft border-slate-100">
                    <CardHeader className="pb-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <CardTitle>Item List ({filteredItems.length})</CardTitle>
                            <div className="relative w-full sm:w-[300px]">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                                <Input
                                    className="pl-9"
                                    placeholder="Search by code, type, size..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <TableScroller>
                        <Table noWrapper className="min-w-[960px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Category</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Spec</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Warehouse</TableHead>
                                    <TableHead>Section</TableHead>
                                    <TableHead>UOM</TableHead>
                                    <TableHead>Std Cost</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredItems.map((item) => {
                                    const displayCat = getDisplayCategory(item);
                                    return (
                                        <TableRow key={item.code} className="hover:bg-slate-50 cursor-pointer">
                                            <TableCell>
                                                <Badge variant="secondary" className={getCategoryColor(displayCat)}>
                                                    {displayCat}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{getDisplayType(item)}</TableCell>
                                            <TableCell className="text-slate-600">{getDisplaySpec(item)}</TableCell>
                                            <TableCell className="font-medium">{buildItemDisplayName(item)}</TableCell>
                                            <TableCell className="font-mono text-xs text-slate-500">{item.code}</TableCell>
                                            <TableCell className="text-xs text-slate-600">
                                                {getWarehouseLabel(getWarehouseType(item))}
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-600">
                                                {getSectionLabel(getInventorySection(item))}
                                            </TableCell>
                                            <TableCell>{item.unit}</TableCell>
                                            <TableCell>{item.stdCost}</TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setEditingItem(item)}
                                                    title="Edit item"
                                                >
                                                    <Pencil className="h-4 w-4 text-slate-500" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setReclassifyItem(item)}
                                                    title="Reclassify product type"
                                                >
                                                    <Replace className="h-4 w-4 text-slate-500" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleDeleteItem(item);
                                                    }}
                                                    title="Delete item"
                                                >
                                                    <Trash2 className="h-4 w-4 text-rose-500" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        </TableScroller>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
