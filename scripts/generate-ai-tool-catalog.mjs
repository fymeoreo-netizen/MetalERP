#!/usr/bin/env node
/**
 * Regenerate docs/ai-tool-catalog.md from the edge-function tool declarations.
 * Run: node scripts/generate-ai-tool-catalog.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toolsPath = join(root, "supabase/functions/erp-assistant/tools.ts");
const outPath = join(root, "docs/ai-tool-catalog.md");

const src = readFileSync(toolsPath, "utf8");
const blockMatch = src.match(
    /export const ASSISTANT_TOOL_DECLARATIONS = (\[[\s\S]*?\]) as const;/,
);
if (!blockMatch) {
    console.error("Could not parse ASSISTANT_TOOL_DECLARATIONS from tools.ts");
    process.exit(1);
}

// eslint-disable-next-line no-eval
const tools = eval(blockMatch[1]);

const lines = [
    "# ERP Assistant Tool Catalog",
    "",
    "Auto-generated from `supabase/functions/erp-assistant/tools.ts`.",
    "Do not edit by hand — run `node scripts/generate-ai-tool-catalog.mjs`.",
    "",
    "| Tool | Description | Parameters |",
    "|------|-------------|------------|",
];

for (const t of tools) {
    const props = t.parameters?.properties ?? {};
    const paramList = Object.entries(props)
        .map(([k, v]) => `${k}${v.type ? `: ${v.type}` : ""}`)
        .join(", ");
    const required = (t.parameters?.required ?? []).join(", ");
    const params = required ? `${paramList} (required: ${required})` : paramList || "—";
    lines.push(`| \`${t.name}\` | ${t.description} | ${params} |`);
}

lines.push("", "## RPC mapping", "");
lines.push("Each tool is executed via `erp.fn_erp_assistant_execute_tool` with permission checks.");
lines.push("See `supabase/migrations/153_erp_assistant.sql` for the underlying `fn_*` report RPCs.");
lines.push("");

writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath} (${tools.length} tools)`);
