/**
 * ERP AI assistant — read-only Q&A over curated report RPCs (via edge function).
 * Tool names mirror supabase/functions/erp-assistant/tools.ts and migration 153.
 */
export {
    invokeErpAssistant,
    fetchAssistantAllowedTools,
    type ErpAssistantResponse,
} from "@/lib/ai/assistantApi";

export {
    ASSISTANT_TOOL_LABELS,
    EXAMPLE_QUESTIONS,
    type AssistantToolName,
    type AssistantContext,
} from "@/lib/ai/tools";
