/** Stable-height placeholder while lazy route chunks load — avoids layout collapse during nav. */
export function RouteFallback() {
    return <div className="min-h-[calc(100svh-2.75rem)]" aria-hidden />;
}
