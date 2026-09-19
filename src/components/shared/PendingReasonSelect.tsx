import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PendingReason } from "@/lib/ratePending";
import { pendingReasonLabel } from "@/lib/ratePending";

type PendingReasonSelectProps = {
    value: PendingReason;
    onChange: (reason: PendingReason) => void;
    disabled?: boolean;
};

export function PendingReasonSelect({ value, onChange, disabled }: PendingReasonSelectProps) {
    if (disabled) {
        return (
            <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                {pendingReasonLabel(value)}
            </Badge>
        );
    }

    return (
        <Select value={value} onValueChange={(v) => onChange(v as PendingReason)}>
            <SelectTrigger className="h-8 text-xs min-w-[160px]">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="rate">Rate not fixed</SelectItem>
                <SelectItem value="tare">Tare not given</SelectItem>
                <SelectItem value="rate_and_tare">Rate & tare pending</SelectItem>
            </SelectContent>
        </Select>
    );
}

export function PendingReasonBadge({ reason }: { reason?: string | null }) {
    const label = pendingReasonLabel(reason);
    const variant =
        reason === "rate_and_tare" ? "destructive" : reason === "tare" ? "secondary" : "outline";
    return (
        <Badge variant={variant} className="text-[10px] font-medium">
            {label}
        </Badge>
    );
}
