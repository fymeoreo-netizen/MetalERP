import { Suspense } from "react";
import { AnimatePresence } from "framer-motion";
import { useLocation, useOutlet } from "react-router-dom";
import { RouteFallback } from "@/components/shared/RouteFallback";
import { RouteErrorBoundary } from "@/components/error/RouteErrorBoundary";
import PageMotion from "./PageMotion";

/**
 * Animate staff route changes. Suspense must sit *inside* the keyed motion
 * node — an outer Suspense replaces AnimatePresence on lazy chunk load and
 * kills the transition.
 */
export function AnimatedOutlet() {
    const location = useLocation();
    const outlet = useOutlet();

    return (
        <AnimatePresence mode="wait" initial={false}>
            <PageMotion key={location.pathname}>
                <RouteErrorBoundary>
                    <Suspense fallback={<RouteFallback />}>{outlet}</Suspense>
                </RouteErrorBoundary>
            </PageMotion>
        </AnimatePresence>
    );
}
