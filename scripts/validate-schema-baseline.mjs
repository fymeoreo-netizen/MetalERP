import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baselineUrl = new URL(
  "../supabase/migrations/20260919231000_erp_schema_baseline.sql",
  import.meta.url,
);
const baselinePath = fileURLToPath(baselineUrl);
const sql = readFileSync(baselineUrl, "utf8");

const forbiddenPatterns = [
  ["Supabase project URL", /https?:\/\/[a-z0-9-]+\.supabase\.co/i],
  ["PostgreSQL connection string", /postgres(?:ql)?:\/\//i],
  ["database password environment variable", /\bPGPASSWORD\b/i],
  ["OpenRouter or OpenAI-style secret", /\bsk-(?:or-v1-)?[a-z0-9_-]{20,}/i],
  ["Supabase secret key", /\bsb_secret_[a-z0-9_-]{20,}/i],
  ["JWT-shaped credential", /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\./i],
  ["Windows workstation path", /\b[A-Z]:\\(?:Users|erp)\\/i],
  ["pg_dump session guard", /^\\(?:un)?restrict\b/m],
  ["pg_dump table-data section", /^-- Data for Name:/m],
];

const failures = forbiddenPatterns
  .filter(([, pattern]) => pattern.test(sql))
  .map(([label]) => `Forbidden ${label} found`);

let dollarQuote = null;
const topLevelDml = [];

sql.split(/\r?\n/).forEach((line, index) => {
  if (dollarQuote) {
    if (line.includes(dollarQuote)) dollarQuote = null;
    return;
  }

  const functionBody = line.match(/\bAS\s+(\$[A-Za-z0-9_]*\$)/i);
  if (functionBody) {
    const tag = functionBody[1];
    const afterOpeningTag = line.slice((functionBody.index ?? 0) + functionBody[0].length);
    if (!afterOpeningTag.includes(tag)) dollarQuote = tag;
    return;
  }

  if (/^\s*(?:COPY|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+)/i.test(line)) {
    topLevelDml.push(index + 1);
  }
});

if (dollarQuote) failures.push(`Unclosed SQL dollar quote ${dollarQuote}`);
if (topLevelDml.length > 0) {
  failures.push(`Top-level data statements found on lines: ${topLevelDml.join(", ")}`);
}

const requiredObjects = [
  ["tables", /^CREATE TABLE /gm],
  ["functions", /^CREATE FUNCTION /gm],
  ["indexes", /^CREATE (?:UNIQUE )?INDEX /gm],
  ["triggers", /^CREATE (?:CONSTRAINT )?TRIGGER /gm],
  ["policies", /^CREATE POLICY /gm],
  ["RLS declarations", /^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;/gm],
  ["grants", /^GRANT /gm],
];

const counts = Object.fromEntries(
  requiredObjects.map(([label, pattern]) => [label, [...sql.matchAll(pattern)].length]),
);

for (const [label, count] of Object.entries(counts)) {
  if (count === 0) failures.push(`No ${label} found in baseline`);
}

if (failures.length > 0) {
  console.error(`Schema baseline validation failed for ${baselinePath}:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Schema baseline validated: ${baselinePath}`);
console.log(counts);
