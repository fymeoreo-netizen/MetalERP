import { useMemo, useRef, useState } from "react";
import { ArrowUpDownIcon, CheckIcon, UserCircle02Icon } from "@hugeicons/core-free-icons";
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

export type PartyComboboxOption = {
    id: string;
    name: string;
    city?: string;
};

export type PartyComboboxLeadingOption = {
    value: string;
    label: string;
};

export interface PartyComboboxProps {
    value: string;
    onValueChange: (value: string) => void;
    options: PartyComboboxOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    disabled?: boolean;
    className?: string;
    triggerClassName?: string;
    emptyMessage?: string;
    /** Show party code (e.g. CUST-001) beside name in list and when selected */
    showCode?: boolean;
    /** Amber ring when no value selected */
    highlightWhenEmpty?: boolean;
    /** e.g. "All parties" for report filters */
    leadingOptions?: PartyComboboxLeadingOption[];
}

export function PartyCombobox({
    value,
    onValueChange,
    options,
    placeholder = "Search party…",
    searchPlaceholder = "Type name or code…",
    disabled = false,
    className,
    triggerClassName,
    emptyMessage = "No party found.",
    showCode = true,
    highlightWhenEmpty = false,
    leadingOptions,
}: PartyComboboxProps) {
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const selectedLabel = useMemo(() => {
        const lead = leadingOptions?.find((o) => o.value === value);
        if (lead) return lead.label;
        const party = options.find((p) => p.id === value);
        if (!party) return null;
        return showCode ? `${party.name} (${party.id})` : party.name;
    }, [value, options, leadingOptions, showCode]);

    const sortedOptions = useMemo(
        () => [...options].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
        [options],
    );

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
                        "h-9 w-full justify-between gap-2 font-normal",
                        highlightWhenEmpty && !value && "ring-2 ring-amber-300/80",
                        triggerClassName,
                        className,
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                        {value ? (
                            <Icon icon={UserCircle02Icon} size={14} className="shrink-0 text-black" aria-hidden />
                        ) : null}
                        <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
                            {selectedLabel ?? placeholder}
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
                        {leadingOptions && leadingOptions.length > 0 ? (
                            <CommandGroup>
                                {leadingOptions.map((o) => (
                                    <CommandItem
                                        key={o.value}
                                        value={`${o.value} ${o.label}`}
                                        onSelect={() => {
                                            onValueChange(o.value);
                                            setOpen(false);
                                        }}
                                        className="gap-2"
                                    >
                                        <Icon
                                            icon={CheckIcon}
                                            size={16}
                                            className={cn(
                                                "shrink-0",
                                                value === o.value ? "opacity-100" : "opacity-0",
                                            )}
                                        />
                                        <span className="truncate font-medium">{o.label}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ) : null}
                        <CommandGroup heading={leadingOptions?.length ? "Parties" : undefined}>
                            {sortedOptions.map((p) => (
                                <CommandItem
                                    key={p.id}
                                    value={`${p.id} ${p.name} ${p.city ?? ""}`}
                                    onSelect={() => {
                                        onValueChange(p.id);
                                        setOpen(false);
                                    }}
                                    className="gap-2"
                                >
                                    <Icon
                                        icon={CheckIcon}
                                        size={16}
                                        className={cn(
                                            "shrink-0",
                                            value === p.id ? "opacity-100" : "opacity-0",
                                        )}
                                    />
                                    <Icon icon={UserCircle02Icon} size={14} className="shrink-0 text-black" />
                                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                    {showCode ? (
                                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                                            {p.id}
                                        </span>
                                    ) : null}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

/** Map party catalog records for combobox options */
export function toPartyComboboxOptions(
    parties: Array<{ id: string; name: string; city?: string }>,
): PartyComboboxOption[] {
    return parties.map((p) => ({ id: p.id, name: p.name, city: p.city }));
}
