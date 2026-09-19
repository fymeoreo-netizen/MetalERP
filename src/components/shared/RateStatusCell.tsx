import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RateStatus } from "@/lib/ratePending";

type RateStatusCellProps = {
    value: RateStatus;
    onChange: (status: RateStatus) => void;
    disabled?: boolean;
    compact?: boolean;
};

export function RateStatusCell({ value, onChange, disabled, compact }: RateStatusCellProps) {
    if (disabled) {
        return value === "pending" ? (
            <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                Pending
            </Badge>
        ) : null;
    }

    return (
        <div className={compact ? "min-w-[110px]" : "min-w-[130px]"}>
            <Select value={value} onValueChange={(v) => onChange(v as RateStatus)}>
                <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="fixed">Fixed rate</SelectItem>
                    <SelectItem value="pending">Rate pending</SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
}
