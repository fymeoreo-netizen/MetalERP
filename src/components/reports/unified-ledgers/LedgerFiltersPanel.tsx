import { Search } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { isErpLiveMode } from "@/lib/backendFlags";
import { fetchParchis } from "@/lib/repositories/reportsRepo";
import { formatLedgerAccountLabel } from "./ledgerRowMappers";
import { MOCK_PARCHIS, type AccountTypeFilter, type LedgerAccountOption, type LedgerAccountTab } from "./types";

export type LedgerFiltersPanelProps = {
    surfaceCard: string;
    accountType: AccountTypeFilter;
    onAccountTypeChange: (value: AccountTypeFilter) => void;
    selectedAccountId: string;
    onSelectedAccountIdChange: (id: string) => void;
    accountPickerOpen: boolean;
    onAccountPickerOpenChange: (open: boolean) => void;
    selectedAccountMeta?: LedgerAccountOption;
    selectedIsParty: boolean;
    ledgerViewMode: string;
    onLedgerViewModeChange: (value: string) => void;
    showParchiInfo: boolean;
    onShowParchiInfoChange: (checked: boolean) => void;
    onOpenParchisChange: (rows: Record<string, unknown>[]) => void;
    dateFrom: string;
    dateTo: string;
    onDateFromChange: (value: string) => void;
    onDateToChange: (value: string) => void;
    onLoadLedger: () => void;
    isFiltering: boolean;
    permittedTabs: LedgerAccountTab[];
    allowedAccountTabs?: readonly LedgerAccountTab[];
    availableAccounts: LedgerAccountOption[];
};

export function LedgerFiltersPanel({
    surfaceCard,
    accountType,
    onAccountTypeChange,
    selectedAccountId,
    onSelectedAccountIdChange,
    accountPickerOpen,
    onAccountPickerOpenChange,
    selectedAccountMeta,
    selectedIsParty,
    ledgerViewMode,
    onLedgerViewModeChange,
    showParchiInfo,
    onShowParchiInfoChange,
    onOpenParchisChange,
    dateFrom,
    dateTo,
    onDateFromChange,
    onDateToChange,
    onLoadLedger,
    isFiltering,
    permittedTabs,
    allowedAccountTabs,
    availableAccounts,
}: LedgerFiltersPanelProps) {
    return (
        <Card className={`${surfaceCard} print:hidden`}>
            <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Search className="h-4 w-4" /> Filters
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                    <div className="space-y-2">
                        <Label className="text-xs">Account Type</Label>
                        <Select
                            value={accountType}
                            onValueChange={(v: AccountTypeFilter) => {
                                onAccountTypeChange(v);
                                onSelectedAccountIdChange("Select");
                                onAccountPickerOpenChange(false);
                            }}
                        >
                            <SelectTrigger className="bg-white h-10 rounded-lg border-slate-200">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                {(!allowedAccountTabs?.length || permittedTabs.length > 1) && (
                                    <SelectItem value="All">All</SelectItem>
                                )}
                                {permittedTabs.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {type}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                        <Label className="text-xs">Select Account</Label>
                        <Popover open={accountPickerOpen} onOpenChange={onAccountPickerOpenChange}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={accountPickerOpen}
                                    className="h-10 w-full justify-between rounded-lg border-slate-200 bg-white font-normal"
                                >
                                    <span className="truncate">
                                        {selectedAccountMeta
                                            ? formatLedgerAccountLabel(selectedAccountMeta, accountType === "All")
                                            : "Search account..."}
                                    </span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(420px,calc(100vw-2rem))] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Search by name, code, or type..." />
                                    <CommandList>
                                        <CommandEmpty>No account found.</CommandEmpty>
                                        <CommandGroup>
                                            {availableAccounts.map((acc) => (
                                                <CommandItem
                                                    key={`${acc.tab}-${acc.id}`}
                                                    value={`${acc.id} ${acc.name} ${acc.tab}`}
                                                    onSelect={() => {
                                                        onSelectedAccountIdChange(acc.id);
                                                        onAccountPickerOpenChange(false);
                                                    }}
                                                >
                                                    <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            selectedAccountId === acc.id ? "opacity-100" : "opacity-0",
                                                        )}
                                                    />
                                                    {formatLedgerAccountLabel(acc, accountType === "All")}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {selectedIsParty && (
                        <div className="space-y-2">
                            <Label className="text-xs">Ledger View</Label>
                            <Select value={ledgerViewMode} onValueChange={onLedgerViewModeChange}>
                                <SelectTrigger className="bg-white h-10 rounded-lg border-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Both">Combined Statement</SelectItem>
                                    <SelectItem value="Financial">Financial Statement Only</SelectItem>
                                    <SelectItem value="Material">Material Statement Only</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {selectedIsParty && (
                        <div className="space-y-2 md:col-span-2">
                            <Label className="text-xs">Parchi Register</Label>
                            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 cursor-pointer">
                                <Checkbox
                                    checked={showParchiInfo}
                                    onCheckedChange={(v) => {
                                        const checked = v === true;
                                        onShowParchiInfoChange(checked);
                                        if (!selectedIsParty || selectedAccountId === "Select") return;
                                        if (!checked) {
                                            onOpenParchisChange([]);
                                            return;
                                        }
                                        if (!isErpLiveMode()) {
                                            onOpenParchisChange(MOCK_PARCHIS[selectedAccountId] ?? []);
                                            return;
                                        }
                                        void fetchParchis({ partyCode: selectedAccountId }).then((parchis) => {
                                            onOpenParchisChange(
                                                parchis.filter((p: { status?: string }) => p.status !== "void"),
                                            );
                                        });
                                    }}
                                />
                                <span className="text-sm text-slate-700">Include parchi table in ledger</span>
                            </label>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className="text-xs">Date Range</Label>
                        <div className="flex items-center gap-1">
                            <Input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => onDateFromChange(e.target.value)}
                                className="h-10 w-1/2 rounded-lg border-slate-200 p-1 text-xs"
                            />
                            <Input
                                type="date"
                                value={dateTo}
                                onChange={(e) => onDateToChange(e.target.value)}
                                className="h-10 w-1/2 rounded-lg border-slate-200 p-1 text-xs"
                            />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={onLoadLedger}
                            className="w-full h-10 rounded-lg bg-blue-600 px-2 text-xs shadow-sm hover:bg-blue-700"
                            disabled={selectedAccountId === "Select" || isFiltering}
                        >
                            {isFiltering ? "Loading..." : "Load Ledger"}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
