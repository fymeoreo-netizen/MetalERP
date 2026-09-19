import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useErpAssistant } from "@/hooks/useErpAssistant";
import { fetchAssistantAllowedTools } from "@/lib/ai/assistantApi";
import type { AssistantContext } from "@/lib/ai/tools";
import { ASSISTANT_TOOL_LABELS, filterExamplesForTools } from "@/lib/ai/tools";

type AssistantPanelProps = {
    context?: AssistantContext;
    compact?: boolean;
    className?: string;
};

function candidateLabel(c: { kind?: string; name?: string; code?: string }): string {
    return c.name ?? c.code ?? "Unknown";
}

function buildClarifyQuestion(c: { kind?: string; name?: string; code?: string }): string {
    if (c.kind === "party" && c.code) {
        return `Use party ${c.code} (${c.name ?? c.code}) — show balance and payable`;
    }
    if (c.kind === "payment" && c.code) {
        return `Show cashbook payment ${c.code}`;
    }
    if (c.kind === "scrap_trade" && c.code) {
        return `Show scrap trade ${c.code}`;
    }
    if (c.kind === "sales_invoice" && c.code) {
        return `Lookup sales invoice ${c.code}`;
    }
    if (c.kind === "purchase_invoice" && c.code) {
        return `Lookup purchase invoice ${c.code}`;
    }
    return `Use ${c.kind ?? "entity"} ${c.code ?? c.name ?? ""}`;
}

export function AssistantPanel({ context, compact = false, className }: AssistantPanelProps) {
    const { messages, loading, error, ask, clear } = useErpAssistant(context);
    const [input, setInput] = useState("");
    const [examples, setExamples] = useState<string[]>(() =>
        filterExamplesForTools([]).slice(0, compact ? 3 : 6),
    );

    useEffect(() => {
        let cancelled = false;
        void fetchAssistantAllowedTools().then((tools) => {
            if (cancelled) return;
            const filtered = filterExamplesForTools(tools);
            setExamples(filtered.slice(0, compact ? 3 : 6));
        });
        return () => {
            cancelled = true;
        };
    }, [compact]);

    const submit = async () => {
        if (!input.trim() || loading) return;
        const q = input;
        setInput("");
        await ask(q, context);
    };

    const pickCandidate = async (c: { kind?: string; name?: string; code?: string }) => {
        if (loading) return;
        await ask(buildClarifyQuestion(c), context);
    };

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            {!compact && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span>Read-only answers from live ERP data. Numbers come from reports, not guesses.</span>
                </div>
            )}

            {context?.party_code || context?.doc_no ? (
                <div className="flex flex-wrap gap-1.5">
                    {context.party_code ? (
                        <Badge variant="secondary">Party: {context.party_code}</Badge>
                    ) : null}
                    {context.doc_no ? <Badge variant="secondary">Doc: {context.doc_no}</Badge> : null}
                </div>
            ) : null}

            <ScrollArea className={cn("rounded-lg border bg-muted/30 p-3", compact ? "h-48" : "h-72")}>
                {messages.length === 0 ? (
                    <div className="space-y-2 text-sm text-muted-foreground">
                        <p className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" />
                            Ask about parties, invoices, cashbook, scrap, attribution, or pending rates.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {examples.map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    className="rounded-md border bg-background px-2 py-1 text-left text-xs hover:bg-accent"
                                    onClick={() => setInput(q)}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 pr-2">
                        {messages.map((m) => (
                            <div
                                key={m.id}
                                className={cn(
                                    "rounded-lg px-3 py-2 text-sm",
                                    m.role === "user" ? "bg-primary/10 ml-6" : "bg-background border mr-6",
                                )}
                            >
                                {m.role === "assistant" ? (
                                    <div className="whitespace-pre-wrap">{m.content}</div>
                                ) : (
                                    <p>{m.content}</p>
                                )}
                                {m.candidates?.length ? (
                                    <div className="mt-2 space-y-1.5">
                                        <p className="text-[10px] text-muted-foreground">Did you mean:</p>
                                        <div className="flex flex-wrap gap-1">
                                            {m.candidates.map((c, i) => (
                                                <button
                                                    key={`${c.code ?? c.name}-${i}`}
                                                    type="button"
                                                    className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] hover:bg-accent"
                                                    onClick={() => void pickCandidate(c)}
                                                    disabled={loading}
                                                >
                                                    {candidateLabel(c)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                                {m.tools_called?.length ? (
                                    <p className="mt-2 text-[10px] text-muted-foreground">
                                        Sources:{" "}
                                        {m.tools_called
                                            .map((t) => ASSISTANT_TOOL_LABELS[t as keyof typeof ASSISTANT_TOOL_LABELS] ?? t)
                                            .join(", ")}
                                        {" · "}
                                        <a href="/assistant#glossary" className="underline hover:text-foreground">
                                            glossary
                                        </a>
                                    </p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex gap-2">
                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="e.g. What is A one washing machine's payable? Who posted PAY-2026-042?"
                    rows={compact ? 2 : 3}
                    className="resize-none"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void submit();
                        }
                    }}
                />
            </div>
            <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={loading || !messages.length}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Clear
                </Button>
                <Button type="button" size="sm" onClick={() => void submit()} disabled={loading || !input.trim()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                    Ask
                </Button>
            </div>
        </div>
    );
}
