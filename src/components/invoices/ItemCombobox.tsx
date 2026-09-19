import { forwardRef, useMemo, useRef, useState } from "react";
import { ArrowUpDownIcon, CheckIcon, Package01Icon } from "@hugeicons/core-free-icons";
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

export type ItemComboboxOption = {
    code: string;
    name: string;
    sizeSpec?: string;
};

export type ItemComboboxGroup = {
    label: string;
    items: ItemComboboxOption[];
};

export interface ItemComboboxProps {
    value: string;
    onSelect: (code: string) => void;
    groups: ItemComboboxGroup[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    disabled?: boolean;
    className?: string;
    hint?: string;
}

/**
 * Searchable item picker for invoice line entry. Forwards a ref to the trigger
 * button so the parent form can drive keyboard focus (e.g. return focus here
 * after a line is added).
 */
export const ItemCombobox = forwardRef<HTMLButtonElement, ItemComboboxProps>(function ItemCombobox(
    {
        value,
        onSelect,
        groups,
        placeholder = "Search item…",
        searchPlaceholder = "Type name or code…",
        emptyMessage = "No item found.",
        disabled = false,
        className,
    },
    ref,
) {
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const selected = useMemo(() => {
        for (const group of groups) {
            const found = group.items.find((i) => i.code === value);
            if (found) return found;
        }
        return null;
    }, [groups, value]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    ref={ref}
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
                        {value ? <Icon icon={Package01Icon} size={14} className="shrink-0 text-black" aria-hidden /> : null}
                        <span className={cn("truncate text-sm", !selected && "text-muted-foreground")}>
                            {selected ? `${selected.name}${selected.sizeSpec ? ` · ${selected.sizeSpec}` : ""}` : placeholder}
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
                        {groups.map((group) => (
                            <CommandGroup key={group.label} heading={group.label}>
                                {group.items.map((item) => (
                                    <CommandItem
                                        key={item.code}
                                        value={`${item.code} ${item.name} ${item.sizeSpec ?? ""}`}
                                        onSelect={() => {
                                            onSelect(item.code);
                                            setOpen(false);
                                        }}
                                        className="gap-2"
                                    >
                                        <Icon
                                            icon={CheckIcon}
                                            size={16}
                                            className={cn(
                                                "shrink-0",
                                                value === item.code ? "opacity-100" : "opacity-0",
                                            )}
                                        />
                                        <span className="min-w-0 flex-1 truncate">
                                            {item.name}
                                            {item.sizeSpec ? ` · ${item.sizeSpec}` : ""}
                                        </span>
                                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                                            {item.code}
                                        </span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
});
