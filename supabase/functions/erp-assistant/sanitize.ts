/** Strip sensitive fields and cap tool result size before sending to Gemini. */

const SENSITIVE_KEYS = new Set([
    "before_data",
    "after_data",
    "metadata",
    "password",
    "token",
    "secret",
    "api_key",
    "actor_user_id",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARRAY_ROWS = 200;
const MAX_DEPTH = 12;
const MAX_RESULT_BYTES = 32_000;

function stripValue(key: string, value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return "[truncated]";
    if (value === null || typeof value !== "object") return value;

    if (Array.isArray(value)) {
        const sliced = value.slice(0, MAX_ARRAY_ROWS).map((item) => stripObject(item, depth + 1));
        if (value.length > MAX_ARRAY_ROWS) {
            sliced.push({ _truncated_rows: value.length - MAX_ARRAY_ROWS });
        }
        return sliced;
    }

    return stripObject(value as Record<string, unknown>, depth + 1);
}

function stripObject(obj: Record<string, unknown>, depth: number): unknown {
    if (depth > MAX_DEPTH) return "[truncated]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(k)) continue;
        if (k === "id" && typeof v === "string" && UUID_RE.test(v)) continue;
        out[k] = stripValue(k, v, depth);
    }
    return out;
}

function byteSize(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function sanitizeToolResult(tool: string, raw: unknown): unknown {
    if (raw === null || raw === undefined) return raw;

    let cleaned = stripObject(
        typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : { data: raw },
        0,
    ) as Record<string, unknown>;

    // get_transaction_history: admin tool — never pass audit blobs even if RPC shape changes.
    if (tool === "get_transaction_history" && cleaned.data && Array.isArray(cleaned.data)) {
        cleaned = {
            ...cleaned,
            data: (cleaned.data as Record<string, unknown>[]).map((row) => ({
                event_at: row.event_at,
                action: row.action,
                entity_type: row.entity_type,
                source_doc_no: row.source_doc_no,
                summary: row.summary,
                actor_display_name: row.actor_display_name,
            })),
        };
    }

    if (byteSize(cleaned) > MAX_RESULT_BYTES) {
        return {
            ok: false,
            error: `Tool result too large (${tool}); request a narrower query.`,
            tool,
        };
    }

    return cleaned;
}

export function estimateResultBytes(results: unknown[]): number {
    return byteSize(results);
}
