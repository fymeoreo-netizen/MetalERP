import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { parseDocDate } from "@/lib/partyCatalog";
import { cn } from "@/lib/utils";

interface InvoiceDateInputProps {
    value: Date | undefined;
    onChange: (date: Date | undefined) => void;
    disabled?: boolean;
    className?: string;
    ariaLabel?: string;
}

function toDateInputValue(value: Date | undefined): string {
    if (!value || Number.isNaN(value.getTime())) return "";
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** Native date input keeps keyboard entry and calendar selection consistent across documents. */
export function InvoiceDateInput({
    value,
    onChange,
    disabled = false,
    className,
    ariaLabel = "Document date",
}: InvoiceDateInputProps) {
    return (
        <div className="relative">
            <CalendarIcon
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden
            />
            <Input
                type="date"
                aria-label={ariaLabel}
                value={toDateInputValue(value)}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next ? parseDocDate(next) : undefined);
                }}
                disabled={disabled}
                className={cn("pl-8 tabular-nums", className)}
            />
        </div>
    );
}
