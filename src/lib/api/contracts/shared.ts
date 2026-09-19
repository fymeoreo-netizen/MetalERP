/**
 * Typed row contracts for PostgREST selects and RPC results on money paths.
 *
 * Asymmetry policy (roadmap CSERP-RRM-2026-08-25 section 3.2):
 * - Inputs are compile-time only (`satisfies XxxArgs`) so emitted JSON never changes.
 * - Read rows are compile-time contracts today; runtime zod parsing at this boundary
 *   is the deliberate tightening step once staging fixtures exist.
 */

/** Cast helper keeping call sites honest about which contract a select must satisfy. */
export function asRows<T>(data: unknown): T[] {
    return Array.isArray(data) ? (data as T[]) : [];
}

export function asRowOrNull<T>(data: unknown): T | null {
    return (data ?? null) as T | null;
}

export type PartyCodeNameRef = { code: string; name: string } | null;

export type ItemCodeNameRef = { code: string; name: string } | null;

/** Generic `{ ok: true; data } | { ok: false; error }` envelope lives in api/types.ts (Result<T>). */
