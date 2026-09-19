import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";

type ReportLoadStateProps = {
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    emptyMessage?: string;
    loadingMessage?: string;
};

export function ReportLoadState({
    loading,
    error,
    empty,
    emptyMessage = "No data for this period.",
    loadingMessage = "Loading report…",
}: ReportLoadStateProps) {
    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600 print:hidden">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                {loadingMessage}
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive" className="print:hidden">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Report failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    if (empty) {
        return (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 print:hidden">
                {emptyMessage}
            </div>
        );
    }

    return null;
}
