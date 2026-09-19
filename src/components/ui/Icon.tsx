import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper around Hugeicons' renderer so the app uses a single, consistent
 * icon API. Color is driven by `currentColor` (prefer black / slate-900).
 */
export type IconProps = {
    icon: IconSvgElement;
    /** Pixel size; falls back to the SVG's default when omitted. */
    size?: number | string;
    className?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    "aria-hidden"?: boolean;
};

export function Icon({
    icon,
    size,
    className,
    strokeWidth = 1.75,
    absoluteStrokeWidth,
    "aria-hidden": ariaHidden,
}: IconProps) {
    return (
        <HugeiconsIcon
            icon={icon}
            size={size}
            strokeWidth={strokeWidth}
            absoluteStrokeWidth={absoluteStrokeWidth}
            color="currentColor"
            className={cn(className)}
            aria-hidden={ariaHidden}
        />
    );
}

export type { IconSvgElement } from "@hugeicons/react";
