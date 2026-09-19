import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw } from "lucide-react";
import { StaggerGrid } from "@/components/motion/MotionPrimitives";

type TransactionPageShellProps = {
    searchQuery: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder?: string;
    onRefresh?: () => void;
    refreshing?: boolean;
    kpiCards: ReactNode;
    children: ReactNode;
};

/** Shared header strip for sales/purchase transaction list pages. */
export function TransactionPageShell({
    searchQuery,
    onSearchChange,
    searchPlaceholder = "Search documents…",
    onRefresh,
    refreshing = false,
    kpiCards,
    children,
}: TransactionPageShellProps) {
    return (
        <div className="space-y-6">
            <StaggerGrid className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{kpiCards}</StaggerGrid>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                        placeholder={searchPlaceholder}
                        className="pl-9"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                </div>
                {onRefresh ? (
                    <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                ) : null}
            </div>
            {children}
        </div>
    );
}
