import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/** Short stable fingerprint so operators can correlate console output with user reports. */
export function computeErrorDigest(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Single seam for render-error telemetry; attach a remote reporter here later. */
export function reportRenderError(error: Error, info?: ErrorInfo): string {
    const digest = computeErrorDigest(`${error.message}|${info?.componentStack ?? ""}`);
    console.error(`[erp:error:${digest}]`, error);
    if (info?.componentStack) {
        console.error(`[erp:error:${digest}] component stack:\n${info.componentStack}`);
    }
    return digest;
}

type GlobalErrorBoundaryProps = { children: ReactNode };
type GlobalErrorBoundaryState = { error: Error | null; digest: string | null };

/**
 * Outermost containment layer. Mounted inside QueryClientProvider but outside
 * the Router, so the fallback never depends on routing or session state.
 */
export class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
    state: GlobalErrorBoundaryState = { error: null, digest: null };

    static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
        return { error, digest: null };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        const digest = reportRenderError(error, info);
        this.setState((prev) => (prev.digest ? prev : { ...prev, digest }));
    }

    private handleReload = (): void => {
        window.location.assign("/dashboard");
    };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        return (
            <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
                <div className="max-w-md w-full rounded-xl border border-zinc-200 bg-white shadow-sm p-6 text-center">
                    <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rose-50">
                        <AlertTriangle className="h-5 w-5 text-rose-600" />
                    </div>
                    <h1 className="text-base font-semibold text-zinc-900">The application hit an unexpected error</h1>
                    <p className="mt-1.5 text-sm text-zinc-500">
                        Your data is safe — posting is protected by server-side guards. Reloading usually resolves this.
                    </p>
                    <p className="mt-3 font-mono text-[11px] text-zinc-400 tabular-nums">
                        ref: {this.state.digest ?? "n/a"}
                    </p>
                    <button
                        type="button"
                        onClick={this.handleReload}
                        className="mt-5 inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Reload application
                    </button>
                </div>
            </div>
        );
    }
}
