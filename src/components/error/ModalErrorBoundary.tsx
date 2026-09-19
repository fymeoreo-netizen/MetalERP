import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportRenderError } from "./GlobalErrorBoundary";

type ModalErrorBoundaryProps = {
    children: ReactNode;
    /** Invoked by the fallback's Close action (e.g. onOpenChange(false)). */
    onClose?: () => void;
    /** Invoked by the fallback's Reset action for inline forms without a dialog shell. */
    onReset?: () => void;
};

type ModalErrorBoundaryState = { error: Error | null; digest: string | null };

/**
 * Containment for high-risk modal/form bodies. Place it BELOW the host
 * component's useState declarations: state living above this boundary is never
 * unmounted when a child subtree throws, so entered data survives the crash.
 */
export class ModalErrorBoundary extends Component<ModalErrorBoundaryProps, ModalErrorBoundaryState> {
    state: ModalErrorBoundaryState = { error: null, digest: null };

    static getDerivedStateFromError(error: Error): ModalErrorBoundaryState {
        return { error, digest: null };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        const digest = reportRenderError(error, info);
        this.setState((prev) => (prev.digest ? prev : { ...prev, digest }));
    }

    private handleRetry = (): void => {
        this.setState({ error: null, digest: null });
    };

    private handleClose = (): void => {
        this.setState({ error: null, digest: null });
        this.props.onClose?.();
    };

    private handleReset = (): void => {
        this.setState({ error: null, digest: null });
        this.props.onReset?.();
    };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        const hasClose = typeof this.props.onClose === "function";
        return (
            <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-900">This section hit an unexpected error</h3>
                <p className="mt-1 max-w-xs text-xs text-zinc-500">
                    Everything you entered above is still preserved. Retry the section, or close and reopen the form.
                </p>
                <p className="mt-3 font-mono text-[11px] text-zinc-400 tabular-nums">
                    ref: {this.state.digest ?? "n/a"}
                </p>
                <div className="mt-5 flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={this.handleRetry}>
                        Retry
                    </Button>
                    {hasClose ? (
                        <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={this.handleClose}>
                            Close
                        </Button>
                    ) : (
                        <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={this.handleReset}>
                            Reset form
                        </Button>
                    )}
                </div>
            </div>
        );
    }
}
