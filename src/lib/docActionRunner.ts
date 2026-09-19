import type { DocActionResult } from "@/lib/api/types";
import { agentDebugLog } from "@/lib/agentDebugLog";

type ToastFn = (opts: {
    title: string;
    description?: string;
    variant?: "default" | "destructive";
}) => void;

/**
 * Runs invoice modal save/post with consistent logging and error surfacing.
 */
export async function runInvoiceDocAction(params: {
    action: "draft" | "post";
    location: string;
    run: () => DocActionResult | Promise<DocActionResult>;
    toast: ToastFn;
    onDbId?: (id: string) => void;
    onSuccess: () => void;
}): Promise<void> {
    const { action, location, run, toast, onDbId, onSuccess } = params;
    agentDebugLog(`${location}:runAction`, "start", { action }, "UI");
    try {
        const result = await Promise.resolve(run());
        agentDebugLog(`${location}:runAction`, "done", { action, ok: result.ok, hasDbId: Boolean(result.dbId) }, "UI");
        if (result.dbId) onDbId?.(result.dbId);
        if (!result.ok) {
            // The run() callback owns the user-facing error toast (it has the most
            // specific message). Surface nothing here to avoid duplicate toasts.
            return;
        }
        onSuccess();
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unexpected error";
        agentDebugLog(`${location}:runAction`, "throw", { action, message: message.slice(0, 200) }, "UI");
        toast({
            title: action === "post" ? "Post failed" : "Save failed",
            description: message,
            variant: "destructive",
        });
    }
}
