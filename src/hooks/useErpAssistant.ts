import { useCallback, useState } from "react";
import { invokeErpAssistant, type ErpAssistantResponse } from "@/lib/ai/assistantApi";
import type { AssistantContext, AssistantResolveCandidate } from "@/lib/ai/tools";

export type AssistantMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    tools_called?: string[];
    candidates?: AssistantResolveCandidate[];
};

export function useErpAssistant(initialContext?: AssistantContext) {
    const [messages, setMessages] = useState<AssistantMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [context, setContext] = useState<AssistantContext | undefined>(initialContext);

    const ask = useCallback(
        async (question: string, ctx?: AssistantContext): Promise<ErpAssistantResponse> => {
            const trimmed = question.trim();
            if (!trimmed) return { ok: false, error: "Enter a question" };

            const mergedContext = { ...context, ...ctx };
            const userMsg: AssistantMessage = {
                id: `u-${Date.now()}`,
                role: "user",
                content: trimmed,
            };
            setMessages((prev) => [...prev, userMsg]);
            setLoading(true);
            setError(null);

            try {
                const result = await invokeErpAssistant(trimmed, mergedContext);
                if (!result.ok) {
                    setError(result.error ?? "Request failed");
                    return result;
                }
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `a-${Date.now()}`,
                        role: "assistant",
                        content: result.answer ?? "",
                        tools_called: result.tools_called,
                        candidates: result.candidates,
                    },
                ]);
                return result;
            } catch (e) {
                const msg = e instanceof Error ? e.message : "Unexpected error";
                setError(msg);
                return { ok: false, error: msg };
            } finally {
                setLoading(false);
            }
        },
        [context],
    );

    const clear = useCallback(() => {
        setMessages([]);
        setError(null);
    }, []);

    return {
        messages,
        loading,
        error,
        context,
        setContext,
        ask,
        clear,
    };
}
