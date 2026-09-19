import { AlertCircle, AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { FormValidationIssues } from "@/lib/formValidation";

export function FormValidationPanel({
    issues,
    visible,
    title,
}: {
    issues: FormValidationIssues;
    visible: boolean;
    title?: string;
}) {
    const hasErrors = issues.errors.length > 0;
    const hasWarnings = issues.warnings.length > 0;
    const show = visible && (hasErrors || hasWarnings);

    return (
        <AnimatePresence initial={false}>
            {show ? (
                <motion.div
                    key="form-validation"
                    role="alert"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="overflow-hidden"
                >
                    <div className="rounded-xl border border-rose-200/90 bg-rose-50/90 px-4 py-3 shadow-sm">
                        <div className="flex items-start gap-2.5">
                            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden />
                            <div className="min-w-0 flex-1 space-y-2">
                                <p className="text-xs font-semibold text-rose-950">
                                    {title ??
                                        (hasErrors ? "Complete the required fields to continue" : "Please review before continuing")}
                                </p>
                                {hasErrors ? (
                                    <ul className="space-y-1 text-[11px] leading-relaxed text-rose-900 list-disc pl-4 marker:text-rose-400">
                                        {issues.errors.map((msg) => (
                                            <li key={msg}>{msg}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                {hasWarnings ? (
                                    <div className="rounded-lg border border-amber-200/80 bg-amber-50/95 px-3 py-2">
                                        <div className="flex items-start gap-2">
                                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                                            <ul className="space-y-1 text-[11px] leading-relaxed text-amber-950 list-disc pl-4 marker:text-amber-400">
                                                {issues.warnings.map((msg) => (
                                                    <li key={msg}>{msg}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

/** @deprecated Use FormValidationPanel with a `visible` flag instead. */
export function InvoiceFormValidationAlerts({
    errors,
    warnings,
    visible = true,
}: {
    errors: string[];
    warnings: string[];
    visible?: boolean;
}) {
    return <FormValidationPanel visible={visible} issues={{ errors, warnings }} />;
}
