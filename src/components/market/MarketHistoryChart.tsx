import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";

type Props = {
    data: { name: string; price: number }[];
    loading?: boolean;
    valuePrefix?: string;
    stroke?: string;
};

export function MarketHistoryChart({
    data,
    loading,
    valuePrefix = "$",
    stroke = "#10b981",
}: Props) {
    if (loading) {
        return (
            <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
                Loading chart…
            </div>
        );
    }
    if (!data.length) {
        return (
            <div className="h-[200px] flex items-center justify-center text-slate-400 bg-slate-50 rounded-lg border border-dashed text-sm">
                No history yet — run market sync
            </div>
        );
    }
    return (
        <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="marketAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={stroke} stopOpacity={0.15} />
                            <stop offset="95%" stopColor={stroke} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis hide domain={["auto", "auto"]} />
                    <Tooltip
                        contentStyle={{
                            borderRadius: 8,
                            border: "1px solid #e2e8f0",
                            fontSize: 11,
                        }}
                        formatter={(v) => [`${valuePrefix}${Number(v ?? 0).toLocaleString()}`, "Value"]}
                    />
                    <Area
                        type="monotone"
                        dataKey="price"
                        stroke={stroke}
                        strokeWidth={2}
                        fill="url(#marketAreaGrad)"
                        dot={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
