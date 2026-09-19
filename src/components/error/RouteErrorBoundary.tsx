import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportRenderError } from "./GlobalErrorBoundary";

type RouteErrorBoundaryProps = { children: ReactNode };
type RouteErrorBoundaryState = { error: Error | null; digest: string | null };

/**
 * Per-route containment. Mounted inside AnimatedOutlet's pathname-keyed motion
 * node, so navigating away unmounts the errored subtree and the next route
 * starts from a clean boundary automatically.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
    state: RouteErrorBoundaryState = { error: null, digest: null };

    static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
        return { error, digest: null };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        const digest = reportRenderError(error, info);
        this.setState((prev) => (prev.digest ? prev : { ...prev, digest }));
    }

    private handleRetry = (): void => {
        this.setState({ error: null, digest: null });
    };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        return (
            <div className="min-h-[60vh] flex items-center justify-center p-6">
                <div className="max-w-md w-full rounded-xl border border-zinc-200 bg-white shadow-sm p-6 text-center">
                    <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <h2 className="text-base font-semibold text-zinc-900">This page failed to display</h2>
                    <p className="mt-1.5 text-sm text-zinc-500">
                        Other pages are unaffected. Retry, or head back to the dashboard.
                    </p>
                    <p className="mt-3 font-mono text-[11px] text-zinc-400 tabular-nums">
                        ref: {this.state.digest ?? "n/a"}
                    </p>
                    <div className="mt-5 flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={this.handleRetry}>
                            Try again
                        </Button>
                        <Button asChild size="sm" className="bg-zinc-900 hover:bg-zinc-800">
                            <Link to="/dashboard">Go to dashboard</Link>
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}
