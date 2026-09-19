import { useMemo, useRef, useState } from "react";
import { ArrowUpDownIcon, BookMarkedIcon, CheckIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type AccountComboboxOption = {
    code: string;
    name: string;
    accountType?: string;
};

export interface AccountComboboxProps {
    value: string;
    onSelect: (code: string) => void;
    options: AccountComboboxOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    disabled?: boolean;
    className?: string;
}

/**
 * Searchable COA leaf picker for journal lines.
 */
export function AccountCombobox({
    value,
    onSelect,
    options,
    placeholder = "Search account…",
    searchPlaceholder = "Type code or name…",
    emptyMessage = "No account found.",
    disabled = false,
    className,
}: AccountComboboxProps) {
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const selected = useMemo(() => options.find((a) => a.code === value) ?? null, [options, value]);

    const grouped = useMemo(() => {
        const map = new Map<string, AccountComboboxOption[]>();
        for (const opt of options) {
            const key = opt.accountType || "Accounts";
            const bucket = map.get(key) ?? [];
            bucket.push(opt);
            map.set(key, bucket);
        }
        return Array.from(map.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, items]) => ({
                label,
                items: items.sort((a, b) => a.code.localeCompare(b.code)),
            }));
    }, [options]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        "h-9 w-full justify-between gap-2 border-0 bg-zinc-100/80 font-normal shadow-none ring-1 ring-zinc-200/70 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400/40",
                        className,
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                        {value ? <Icon icon={BookMarkedIcon} size={14} className="shrink-0 text-black" aria-hidden /> : null}
                        <span className={cn("truncate text-sm", !selected && "text-muted-foreground")}>
                            {selected ? `${selected.code} · ${selected.name}` : placeholder}
                        </span>
                    </span>
                    <Icon icon={ArrowUpDownIcon} size={16} className="shrink-0 opacity-40" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[min(420px,calc(100vw-2rem))] p-0"
                align="start"
                onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    requestAnimationFrame(() => inputRef.current?.focus());
                }}
            >
                <Command shouldFilter>
                    <CommandInput ref={inputRef} placeholder={searchPlaceholder} autoFocus />
                    <CommandList className="max-h-[min(320px,50vh)]">
                        <CommandEmpty>{emptyMessage}</CommandEmpty>
                        {grouped.map((group) => (
                            <CommandGroup key={group.label} heading={group.label}>
                                {group.items.map((account) => (
                                    <CommandItem
                                        key={account.code}
                                        value={`${account.code} ${account.name}`}
                                        onSelect={() => {
                                            onSelect(account.code);
                                            setOpen(false);
                                        }}
                                        className="gap-2"
                                    >
                                        <Icon
                                            icon={CheckIcon}
                                            size={16}
                                            className={cn(
                                                "shrink-0",
                                                value === account.code ? "opacity-100" : "opacity-0",
                                            )}
                                        />
                                        <span className="font-mono text-xs text-slate-500">{account.code}</span>
                                        <span className="truncate text-sm">{account.name}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
