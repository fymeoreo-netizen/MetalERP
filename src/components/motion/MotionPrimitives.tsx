import { type ReactNode } from "react";
import {
    AnimatePresence,
    motion,
    useReducedMotion,
    type Transition,
    type Variants,
} from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Motion presets — tween-based (no spring overshoot).
 * Springs with damping ratio < 1 visibly bounce on entrance/exit, which reads
 * as "shaking" in dense forms and lists. easeOut tweens settle exactly.
 */
export const springs = {
    entrance: { duration: 0.28, ease: "easeOut" } as Transition,
    press: { duration: 0.15, ease: "easeIn" } as Transition,
};

const STAGGER_STEP = 0.035;
const STAGGER_MAX_INDEX = 12;

/** Opacity-only entrance — avoids fighting CSS transform on hover. */
const itemVariants: Variants = {
    hidden: { opacity: 0 },
    visible: (index: number) => ({
        opacity: 1,
        transition: { ...springs.entrance, delay: Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP },
    }),
};

/** Parent/child variants for staggered entrances (dashboard KPI rows). */
const staggerContainerVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.05 } },
};

const staggerChildVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.3, ease: "easeOut" },
    },
};

type StaggerContainerProps = {
    children: ReactNode;
    className?: string;
};

/** Wrap a grid of cards; each direct StaggerItem child enters with a spring stagger. */
export function StaggerContainer({ children, className }: StaggerContainerProps) {
    const reduceMotion = useReducedMotion();

    if (reduceMotion) {
        return <div className={className}>{children}</div>;
    }

    return (
        <motion.div className={className} variants={staggerContainerVariants} initial="hidden" animate="visible">
            {children}
        </motion.div>
    );
}

export function StaggerItem({ children, className }: StaggerContainerProps) {
    const reduceMotion = useReducedMotion();

    if (reduceMotion) {
        return <div className={className}>{children}</div>;
    }

    return (
        <motion.div className={className} variants={staggerChildVariants}>
            {children}
        </motion.div>
    );
}

type StaggerGridProps = {
    children: ReactNode;
    className?: string;
};

export function StaggerGrid({ children, className }: StaggerGridProps) {
    const reduceMotion = useReducedMotion();

    if (reduceMotion) {
        return <div className={className}>{children}</div>;
    }

    return (
        <div className={className}>
            <AnimatePresence initial={false}>{children}</AnimatePresence>
        </div>
    );
}

type MotionCardProps = {
    children: ReactNode;
    className?: string;
    index?: number;
};

/**
 * List card wrapper: CSS hover lift (always works) + optional Framer entrance fade.
 * Hover is NOT gated on reduced-motion — only the entrance fade is skipped.
 */
export function MotionCard({ children, className, index = 0 }: MotionCardProps) {
    const reduceMotion = useReducedMotion();
    const liftClass = cn("motion-card-lift h-full rounded-xl", className);

    if (reduceMotion) {
        return <div className={liftClass}>{children}</div>;
    }

    return (
        <motion.div
            custom={index}
            variants={itemVariants}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, transition: springs.press }}
            className={liftClass}
        >
            {children}
        </motion.div>
    );
}

type ListSectionCardProps = {
    children: ReactNode;
    className?: string;
    title?: string;
    description?: ReactNode;
    headerExtra?: ReactNode;
};

export function ListSectionCard({ children, className, title, description, headerExtra }: ListSectionCardProps) {
    return (
        <Card className={cn("shadow-soft border-slate-100", className)}>
            {title ? (
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div className="space-y-1">
                        <CardTitle>{title}</CardTitle>
                        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
                    </div>
                    {headerExtra}
                </CardHeader>
            ) : null}
            <CardContent className={title ? undefined : "pt-6"}>{children}</CardContent>
        </Card>
    );
}

type MotionKpiCardProps = {
    children: ReactNode;
    className?: string;
};

export function MotionKpiCard({ children, className }: MotionKpiCardProps) {
    return (
        <div className="motion-kpi-lift rounded-xl">
            <Card className={cn("shadow-soft border-slate-100 bg-white h-full", className)}>{children}</Card>
        </div>
    );
}

type MotionPanelCardProps = {
    children: ReactNode;
    className?: string;
};

export function MotionPanelCard({ children, className }: MotionPanelCardProps) {
    return (
        <div className="motion-panel-lift rounded-xl">
            <Card className={cn("shadow-soft border-slate-100 h-full", className)}>{children}</Card>
        </div>
    );
}

type TabContentMotionProps = {
    children: ReactNode;
    className?: string;
};

export function TabContentMotion({ children, className }: TabContentMotionProps) {
    const reduceMotion = useReducedMotion();

    if (reduceMotion) {
        return <div className={className}>{children}</div>;
    }

    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.entrance}
        >
            {children}
        </motion.div>
    );
}
