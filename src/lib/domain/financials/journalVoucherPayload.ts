import { z } from "zod";

/** AR/AP control accounts that require a party on the line. */
export const PARTY_CONTROL_ACCOUNT_CODES = ["11201", "11202", "21101", "21103"] as const;

export function isPartyControlAccount(accountCode: string | null | undefined): boolean {
    return PARTY_CONTROL_ACCOUNT_CODES.includes(
        (accountCode ?? "").trim() as (typeof PARTY_CONTROL_ACCOUNT_CODES)[number],
    );
}

const num = z.coerce.number();

export const journalVoucherLineSchema = z
    .object({
        accountCode: z.string().trim().min(1, "Account is required"),
        partyCode: z.union([z.string(), z.null()]).optional(),
        debit: num.nonnegative("Debit must be >= 0"),
        credit: num.nonnegative("Credit must be >= 0"),
        remarks: z.string().optional(),
    })
    .superRefine((line, ctx) => {
        if (line.debit > 0 && line.credit > 0) {
            ctx.addIssue({
                code: "custom",
                message: "Cannot have both debit and credit on the same line",
                path: ["debit"],
            });
        }
        if (line.debit === 0 && line.credit === 0) {
            ctx.addIssue({
                code: "custom",
                message: "Enter a debit or credit amount",
                path: ["debit"],
            });
        }
        const party = (line.partyCode ?? "").trim();
        if (isPartyControlAccount(line.accountCode)) {
            if (!party) {
                ctx.addIssue({
                    code: "custom",
                    message: "Party is required for AR/AP accounts",
                    path: ["partyCode"],
                });
            }
        } else if (party) {
            ctx.addIssue({
                code: "custom",
                message: "Party is not allowed for this account",
                path: ["partyCode"],
            });
        }
    });

export const journalVoucherPayloadSchema = z
    .object({
        postingDate: z.string().min(1, "Posting date is required"),
        referenceNo: z.string().optional(),
        narration: z.string().optional(),
        lines: z.array(journalVoucherLineSchema).min(2, "At least two journal lines are required"),
    })
    .superRefine((payload, ctx) => {
        const totalDebit = Math.round(payload.lines.reduce((s, l) => s + Number(l.debit || 0), 0) * 1000) / 1000;
        const totalCredit = Math.round(payload.lines.reduce((s, l) => s + Number(l.credit || 0), 0) * 1000) / 1000;
        if (totalDebit <= 0 || totalCredit <= 0) {
            ctx.addIssue({
                code: "custom",
                message: "Total debit and credit must be greater than zero",
                path: ["lines"],
            });
        }
        if (totalDebit !== totalCredit) {
            ctx.addIssue({
                code: "custom",
                message: `Journal is out of balance: debit ${totalDebit}, credit ${totalCredit}`,
                path: ["lines"],
            });
        }
    });

export type JournalVoucherLinePayload = z.infer<typeof journalVoucherLineSchema>;
export type JournalVoucherPayload = z.infer<typeof journalVoucherPayloadSchema>;

/** Form shape uses string amounts for controlled inputs. */
export const journalVoucherFormSchema = z
    .object({
        postingDate: z.string().min(1, "Posting date is required"),
        referenceNo: z.string().optional(),
        narration: z.string().optional(),
        lines: z
            .array(
                z.object({
                    accountCode: z.string(),
                    partyCode: z.string().optional(),
                    debit: z.string(),
                    credit: z.string(),
                    remarks: z.string().optional(),
                }),
            )
            .min(2, "At least two journal lines are required"),
    })
    .superRefine((payload, ctx) => {
        payload.lines.forEach((line, idx) => {
            const debit = Number(line.debit || 0);
            const credit = Number(line.credit || 0);
            if (!line.accountCode.trim()) {
                ctx.addIssue({
                    code: "custom",
                    message: "Account is required",
                    path: ["lines", idx, "accountCode"],
                });
            }
            if (debit < 0 || credit < 0) {
                ctx.addIssue({
                    code: "custom",
                    message: "Amounts must be >= 0",
                    path: ["lines", idx, "debit"],
                });
            }
            if (debit > 0 && credit > 0) {
                ctx.addIssue({
                    code: "custom",
                    message: "Cannot have both debit and credit",
                    path: ["lines", idx, "debit"],
                });
            }
            if (debit === 0 && credit === 0) {
                ctx.addIssue({
                    code: "custom",
                    message: "Enter a debit or credit",
                    path: ["lines", idx, "debit"],
                });
            }
            const party = (line.partyCode ?? "").trim();
            if (isPartyControlAccount(line.accountCode)) {
                if (!party) {
                    ctx.addIssue({
                        code: "custom",
                        message: "Party is required",
                        path: ["lines", idx, "partyCode"],
                    });
                }
            } else if (party) {
                ctx.addIssue({
                    code: "custom",
                    message: "Party not allowed",
                    path: ["lines", idx, "partyCode"],
                });
            }
        });

        const totalDebit =
            Math.round(payload.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0) * 1000) / 1000;
        const totalCredit =
            Math.round(payload.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0) * 1000) / 1000;
        if (totalDebit > 0 && totalCredit > 0 && totalDebit !== totalCredit) {
            ctx.addIssue({
                code: "custom",
                message: `Out of balance: Dr ${totalDebit} ≠ Cr ${totalCredit}`,
                path: ["lines"],
            });
        }
    });

export type JournalVoucherFormValues = z.infer<typeof journalVoucherFormSchema>;

export function formValuesToPayload(values: JournalVoucherFormValues): JournalVoucherPayload {
    return {
        postingDate: values.postingDate,
        referenceNo: values.referenceNo?.trim() || undefined,
        narration: values.narration?.trim() || undefined,
        lines: values.lines.map((l) => ({
            accountCode: l.accountCode.trim(),
            partyCode: isPartyControlAccount(l.accountCode) ? l.partyCode?.trim() || null : null,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            remarks: l.remarks?.trim() || undefined,
        })),
    };
}
