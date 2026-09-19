import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronDown, Folder, FileText, Plus, Search, Anchor, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { AddAccountModal } from "@/components/masters/AddAccountModal";
import { Badge } from "@/components/ui/badge";
import {
    addStructuralAccount,
    deactivateOrDeleteAccount,
    getCoaTree,
    getNextAccountCode,
    initCoaCatalog,
    subscribeCoa,
    updateStructuralAccount,
    type CoaNode,
} from "@/lib/coaStore";
import { useToast } from "@/components/ui/use-toast";
import { isErpLiveMode } from "@/lib/backendFlags";
import { fetchCoaAccounts } from "@/lib/api/masters";

interface TreeNodeProps {
    node: CoaNode;
    level?: number;
    onEdit: (node: CoaNode) => void;
    onDelete: (node: CoaNode) => void;
}

const TreeNode = ({ node, level = 0, onEdit, onDelete }: TreeNodeProps) => {
    const [isOpen, setIsOpen] = useState(true);
    const hasChildren = node.children && node.children.length > 0;
    const editable = !node.isAnchor;

    return (
        <div className="select-none group">
            <div
                className={cn(
                    "flex items-center gap-2 py-2 px-2 rounded-md hover:bg-slate-50 cursor-pointer border-b border-transparent hover:border-slate-100 transition-colors",
                    level === 0 ? "font-bold text-slate-900 bg-slate-50/50" : "text-slate-700"
                )}
                style={{ paddingLeft: `${level * 20 + 8}px` }}
                onClick={() => hasChildren && setIsOpen(!isOpen)}
            >
                {hasChildren ? (
                    <span className="text-slate-400 p-0.5 rounded hover:bg-slate-200">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                ) : (
                    <span className="w-5" />
                )}

                {node.type === "group" ? (
                    <Folder className={cn("h-4 w-4", level === 0 ? "text-slate-800" : "text-blue-500")} />
                ) : (
                    <FileText className="h-4 w-4 text-slate-400" />
                )}

                <span className={cn("flex-1", node.type === "group" && level > 0 && "font-semibold text-slate-800")}>
                    <span className="font-mono text-slate-500 mr-2">{node.id}</span>
                    {node.name}
                </span>

                {node.isAnchor && (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 ml-2">
                        <Anchor className="h-3 w-3 mr-1" /> Anchor
                    </Badge>
                )}

                {node.type === "group" && (
                    <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 ml-2">
                        Group
                    </Badge>
                )}

                {node.type === "leaf" && node.isActive !== false && node.isPosting !== false && !node.isAnchor && (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 ml-2">
                        Postable
                    </Badge>
                )}

                {node.isActive === false && (
                    <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 ml-2">
                        Inactive
                    </Badge>
                )}

                {editable && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-blue-600"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(node);
                            }}
                            title="Edit account"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-rose-600"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(node);
                            }}
                            title="Delete or deactivate"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}
            </div>

            {isOpen && hasChildren && (
                <div>
                    {node.children?.map((child) => (
                        <TreeNode key={child.id} node={child} level={level + 1} onEdit={onEdit} onDelete={onDelete} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default function ChartOfAccounts() {
    const { toast } = useToast();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<CoaNode | null>(null);
    const [tick, setTick] = useState(0);
    const [query, setQuery] = useState("");
    const [flatDbCount, setFlatDbCount] = useState<number | null>(null);

    useEffect(() => {
        void initCoaCatalog().then(() => setTick((v) => v + 1));
        return subscribeCoa(() => setTick((v) => v + 1));
    }, []);

    useEffect(() => {
        if (!isErpLiveMode()) return;
        void fetchCoaAccounts().then((rows) => setFlatDbCount(rows.length));
    }, [tick]);
    const coaTree = useMemo(() => getCoaTree(), [tick]);

    const parentOptions = useMemo(() => {
        const out: { id: string; name: string }[] = [];
        const walk = (nodes: CoaNode[]) => {
            for (const n of nodes) {
                if (n.type === "group") out.push({ id: n.id, name: n.name });
                if (n.children?.length) walk(n.children);
            }
        };
        walk(coaTree);
        return out;
    }, [coaTree]);

    const coaStats = useMemo(() => {
        let total = 0;
        let leaves = 0;
        let postable = 0;
        let inactive = 0;
        const walk = (nodes: CoaNode[]) => {
            for (const n of nodes) {
                total++;
                if (n.type === "leaf") {
                    leaves++;
                    if (n.isActive === false) inactive++;
                    else if (n.isPosting !== false) postable++;
                }
                if (n.children?.length) walk(n.children);
            }
        };
        walk(coaTree);
        return { total, leaves, postable, inactive };
    }, [coaTree]);

    const filteredTree = useMemo(() => {
        if (!query.trim()) return coaTree;
        const q = query.toLowerCase();
        const filterNodes = (nodes: CoaNode[]): CoaNode[] => {
            const out: CoaNode[] = [];
            for (const node of nodes) {
                const children = node.children ? filterNodes(node.children) : [];
                const selfMatch = node.id.toLowerCase().includes(q) || node.name.toLowerCase().includes(q);
                if (selfMatch || children.length > 0) {
                    out.push({ ...node, children: node.children ? children : undefined });
                }
            }
            return out;
        };
        return filterNodes(coaTree);
    }, [coaTree, query]);

    const handleDelete = useCallback(
        async (node: CoaNode) => {
            if (!window.confirm(`Delete account ${node.id} - ${node.name}? Accounts with posting history will be deactivated instead.`)) return;
            try {
                const mode = await deactivateOrDeleteAccount(node.id);
                toast({
                    title: mode === "deleted" ? "Account deleted" : "Account deactivated",
                    description:
                        mode === "deleted"
                            ? `${node.id} removed.`
                            : `${node.id} kept for history but marked inactive.`,
                });
            } catch (e) {
                toast({
                    title: "Delete failed",
                    description: e instanceof Error ? e.message : "Unknown error",
                    variant: "destructive",
                });
            }
        },
        [toast]
    );

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Chart of Accounts</h1>
                        <p className="text-slate-500">
                            Manage financial heads and standard structural hierarchy.
                            {coaStats.total > 0 && (
                                <span className="block text-xs mt-1 text-slate-400">
                                    {coaStats.total} in tree
                                    {flatDbCount != null ? ` · ${flatDbCount} in database` : ""}
                                    {" · "}
                                    {coaStats.leaves} leaves · {coaStats.postable} postable
                                    {coaStats.inactive > 0 ? ` · ${coaStats.inactive} inactive` : ""}
                                </span>
                            )}
                        </p>
                    </div>
                    <Button onClick={() => setIsAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Structural Account
                    </Button>
                </div>

                <AddAccountModal
                    open={isAddOpen}
                    onOpenChange={setIsAddOpen}
                    parentOptions={parentOptions}
                    getPreviewCode={getNextAccountCode}
                    onCreate={({ parentId, name, levelType, accountType, accountNature, reportGroup }) => {
                        addStructuralAccount({ parentId, name, levelType, accountType, accountNature, reportGroup });
                    }}
                />

                <AddAccountModal
                    open={Boolean(editingAccount)}
                    onOpenChange={(open) => {
                        if (!open) setEditingAccount(null);
                    }}
                    mode="edit"
                    parentOptions={parentOptions}
                    getPreviewCode={getNextAccountCode}
                    initialAccount={editingAccount}
                    onUpdate={async ({ code, name, accountType, accountNature, reportGroup }) => {
                        await updateStructuralAccount({ code, name, accountType, accountNature, reportGroup });
                        setEditingAccount(null);
                    }}
                />

                {isErpLiveMode() && flatDbCount != null && flatDbCount < 50 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        Only <strong>{flatDbCount}</strong> accounts are in the database (expected ~90+ after industry COA).
                        In Supabase SQL Editor, run{" "}
                        <code className="text-xs bg-amber-100 px-1 rounded">37_industry_standard_coa.sql</code> then{" "}
                        <code className="text-xs bg-amber-100 px-1 rounded">116_report_names_journal_led_coa_reseed.sql</code>,
                        then refresh this page.
                    </div>
                )}

                <Card className="shadow-sm border-slate-200">
                    <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/50">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <CardTitle className="text-lg">Standard COA Hierarchy</CardTitle>
                            <div className="relative w-full sm:w-[300px]">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                                <Input
                                    className="pl-9 h-9 bg-white"
                                    placeholder="Search accounts..."
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="p-4">
                            {filteredTree.map((node) => (
                                <TreeNode
                                    key={node.id}
                                    node={node}
                                    onEdit={(n) => setEditingAccount(n)}
                                    onDelete={(n) => void handleDelete(n)}
                                />
                            ))}
                            {filteredTree.length === 0 && (
                                <div className="py-8 text-center text-sm text-slate-500">No accounts match your search.</div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
