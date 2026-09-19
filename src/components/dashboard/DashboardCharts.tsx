import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

function ChartFallback() {
    return <div className="h-full w-full animate-pulse bg-slate-50 rounded-lg" />;
}

/** Wait for a real layout size before mounting Recharts (avoids width/height -1 warnings). */
function ChartContainer({
    children,
    className,
}: {
    children: (size: { width: number; height: number }) => ReactNode;
    className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const update = () => {
            const { width, height } = el.getBoundingClientRect();
            if (width > 0 && height > 0) {
                setSize({ width: Math.floor(width), height: Math.floor(height) });
            }
        };

        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={ref} className={className}>
            {size.width > 0 && size.height > 0 ? children(size) : <ChartFallback />}
        </div>
    );
}

const LazyWeeklyProductionChart = lazy(() =>
    import("recharts").then((mod) => ({
        default: function WeeklyProductionChart({
            data,
        }: {
            data: { name: string; total: number }[];
        }) {
            const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
            return (
                <ChartContainer className="h-full w-full">
                    {({ width, height }) => (
                        <ResponsiveContainer width={width} height={height} minWidth={0}>
                            <BarChart data={data} barSize={28}>
                                <defs>
                                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.9} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}kg`} />
                                <Tooltip
                                    cursor={{ fill: "#f8fafc", radius: 6 }}
                                    contentStyle={{
                                        borderRadius: "10px",
                                        border: "1px solid #e2e8f0",
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                                        fontSize: 12,
                                    }}
                                />
                                <Bar dataKey="total" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </ChartContainer>
            );
        },
    })),
);

const LazyCopperTrendChart = lazy(() =>
    import("recharts").then((mod) => ({
        default: function CopperTrendChart({
            data,
        }: {
            data: { date: string; value: number }[];
        }) {
            const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
            return (
                <ChartContainer className="h-full w-full">
                    {({ width, height }) => (
                        <ResponsiveContainer width={width} height={height} minWidth={0}>
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="copperGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: "10px",
                                        border: "1px solid #e2e8f0",
                                        fontSize: 12,
                                    }}
                                />
                                <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="url(#copperGrad)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </ChartContainer>
            );
        },
    })),
);

export function WeeklyProductionChart(props: { data: { name: string; total: number }[] }) {
    return (
        <Suspense fallback={<ChartFallback />}>
            <LazyWeeklyProductionChart {...props} />
        </Suspense>
    );
}

export function CopperTrendChart(props: { data: { date: string; value: number }[] }) {
    return (
        <Suspense fallback={<ChartFallback />}>
            <LazyCopperTrendChart {...props} />
        </Suspense>
    );
}
