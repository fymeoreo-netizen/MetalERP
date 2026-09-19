import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

interface MultiSelectOption {
  value: string;
  label: string;
  [key: string]: any;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const MultiSelect = React.forwardRef<
  HTMLButtonElement,
  MultiSelectProps
>(
  (
    {
      options,
      selected,
      onChange,
      placeholder = "Select options...",
      className,
      disabled = false,
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");

    const handleSelect = (value: string) => {
      if (selected.includes(value)) {
        onChange(selected.filter((item) => item !== value));
      } else {
        onChange([...selected, value]);
      }
    };

    const handleClear = () => {
      onChange([]);
    };

    const handleSelectAll = () => {
      if (selected.length === options.length) {
        onChange([]);
      } else {
        onChange(options.map((option) => option.value));
      }
    };

    const selectedLabels = selected
      .map((value) => options.find((option) => option.value === value)?.label)
      .filter(Boolean) as string[];

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between min-h-10 h-auto",
              className
            )}
            disabled={disabled}
          >
            <div className="flex flex-wrap gap-1">
              {selected.length === 0 && (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
              {selected.length > 0 && (
                <>
                  {selectedLabels.slice(0, 2).map((label, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="rounded-sm px-1 font-normal"
                    >
                      {label}
                    </Badge>
                  ))}
                  {selectedLabels.length > 2 && (
                    <Badge
                      variant="secondary"
                      className="rounded-sm px-1 font-normal"
                    >
                      +{selectedLabels.length - 2} more
                    </Badge>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {selected.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <Separator
                orientation="vertical"
                className="mx-1 h-4"
              />
              <ChevronDown className="h-4 w-4 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No option found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={handleSelectAll}
                  className="cursor-pointer"
                >
                  <Checkbox
                    checked={selected.length === options.length && options.length > 0}
                    className="mr-2"
                  />
                  Select All
                </CommandItem>
              </CommandGroup>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    onSelect={() => handleSelect(option.value)}
                    className="cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.includes(option.value)}
                      className="mr-2"
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
);

MultiSelect.displayName = "MultiSelect";