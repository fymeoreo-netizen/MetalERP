export type ParchiCommitmentRow = {
    parchi_id: string;
    available_balance: number;
};

export type ParchiAllocation = {
    parchiNo: string;
    amount: number;
};

export type ParchiClearancePlan =
    | {
          ok: true;
          allocations: ParchiAllocation[];
          remarks: string;
          cashAmount: number;
          needsMoreParchi: boolean;
          needsCashRemainder: boolean;
          unallocatedRemainder: number;
      }
    | {
          ok: false;
          error: string;
          needsMoreParchi?: boolean;
          needsCashRemainder?: boolean;
          unallocatedRemainder?: number;
      };

function roundMoney(n: number): number {
    return Math.round(n * 1000) / 1000;
}

export function buildParchiClearanceRemarks(
    allocations: ParchiAllocation[],
    total: number,
    userNote?: string,
    cashAmount?: number,
    cashLabel = "Cash",
): string {
    const parts = allocations.map((a) => `${a.parchiNo}: ₨ ${a.amount.toLocaleString()}`);
    const cash = roundMoney(cashAmount ?? 0);
    if (cash > 0.001) {
        parts.push(`${cashLabel}: ₨ ${cash.toLocaleString()}`);
    }
    const breakdown = parts.join("; ");
    let text = `Parchi clearance — ${breakdown}; Total: ₨ ${total.toLocaleString()}`;
    const note = userNote?.trim();
    if (note) text += `. ${note}`;
    return text;
}

export function partyParchiOptions(
    parchiData: ParchiCommitmentRow[],
    opts?: { excludeParchiIds?: string[]; includeParchiId?: string },
): ParchiCommitmentRow[] {
    const excluded = new Set(opts?.excludeParchiIds ?? []);
    return parchiData.filter(
        (p) =>
            !excluded.has(p.parchi_id) &&
            (p.available_balance > 0 || p.parchi_id === opts?.includeParchiId),
    );
}

export function computeParchiClearancePlan(input: {
    totalAmount: number;
    primaryParchiId: string;
    additionalParchiIds?: string[];
    partyParchis: ParchiCommitmentRow[];
    priorByParchiNo?: Record<string, number>;
    userNote?: string;
    allowCashRemainder?: boolean;
    /** Label used for the unallocated remainder in remarks (e.g. "On account" for cross-party). */
    cashRemainderLabel?: string;
}): ParchiClearancePlan {
    const total = roundMoney(input.totalAmount);
    if (total <= 0) {
        return { ok: false, error: "Enter a clearance amount greater than zero." };
    }

    if (!input.primaryParchiId?.trim()) {
        return { ok: false, error: "Select a parchi to clear." };
    }

    const additional = (input.additionalParchiIds ?? []).filter(Boolean);
    const selectedIds = [input.primaryParchiId, ...additional];
    if (new Set(selectedIds).size !== selectedIds.length) {
        return { ok: false, error: "Each parchi slip can only be selected once." };
    }

    let remaining = total;
    const allocations: ParchiAllocation[] = [];

    for (const parchiId of selectedIds) {
        const parchi = input.partyParchis.find((p) => p.parchi_id === parchiId);
        if (!parchi) {
            return {
                ok: false,
                error:
                    parchiId === input.primaryParchiId
                        ? "Select a parchi to clear."
                        : "Select a valid parchi for the remainder.",
            };
        }

        const prior = input.priorByParchiNo?.[parchiId] ?? 0;
        const cap = roundMoney(parchi.available_balance + prior);
        const onParchi = roundMoney(Math.min(cap, remaining));
        if (onParchi > 0) {
            allocations.push({ parchiNo: parchiId, amount: onParchi });
        }
        remaining = roundMoney(remaining - onParchi);
    }

    if (remaining <= 0.001) {
        return {
            ok: true,
            allocations,
            remarks: buildParchiClearanceRemarks(allocations, total, input.userNote),
            cashAmount: 0,
            needsMoreParchi: false,
            needsCashRemainder: false,
            unallocatedRemainder: 0,
        };
    }

    if (input.allowCashRemainder) {
        return {
            ok: true,
            allocations,
            cashAmount: remaining,
            remarks: buildParchiClearanceRemarks(
                allocations,
                total,
                input.userNote,
                remaining,
                input.cashRemainderLabel,
            ),
            needsMoreParchi: false,
            needsCashRemainder: false,
            unallocatedRemainder: 0,
        };
    }

    const selectedSet = new Set(selectedIds);
    const unselectedWithBalance = input.partyParchis.filter((p) => {
        if (selectedSet.has(p.parchi_id)) return false;
        const prior = input.priorByParchiNo?.[p.parchi_id] ?? 0;
        return p.available_balance + prior > 0.001;
    });

    if (unselectedWithBalance.length > 0) {
        const lastId = selectedIds[selectedIds.length - 1];
        const lastParchi = input.partyParchis.find((p) => p.parchi_id === lastId);
        const lastCap = lastParchi
            ? roundMoney(lastParchi.available_balance + (input.priorByParchiNo?.[lastId] ?? 0))
            : 0;
        return {
            ok: false,
            needsMoreParchi: true,
            unallocatedRemainder: remaining,
            error:
                additional.length === 0
                    ? `₨ ${remaining.toLocaleString()} exceeds ${lastId} available (₨ ${lastCap.toLocaleString()}). Select another parchi or apply as cash.`
                    : `₨ ${remaining.toLocaleString()} remains after selected slips. Select another parchi or apply as cash.`,
        };
    }

    return {
        ok: false,
        needsCashRemainder: true,
        unallocatedRemainder: remaining,
        error: `₨ ${remaining.toLocaleString()} exceeds all open parchi slips for this party. Apply remainder as cash or reduce the amount.`,
    };
}
