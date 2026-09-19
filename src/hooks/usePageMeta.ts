import { useEffect } from "react";

export function usePageMeta(options: {
    title: string;
    description?: string;
    noindex?: boolean;
}) {
    useEffect(() => {
        const prevTitle = document.title;
        document.title = options.title;

        let descEl = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
        const prevDesc = descEl?.getAttribute("content") ?? "";
        if (options.description) {
            if (!descEl) {
                descEl = document.createElement("meta");
                descEl.name = "description";
                document.head.appendChild(descEl);
            }
            descEl.content = options.description;
        }

        let robotsEl = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
        const hadRobots = Boolean(robotsEl);
        const prevRobots = robotsEl?.getAttribute("content") ?? "";
        if (options.noindex) {
            if (!robotsEl) {
                robotsEl = document.createElement("meta");
                robotsEl.name = "robots";
                document.head.appendChild(robotsEl);
            }
            robotsEl.content = "noindex, nofollow";
        }

        return () => {
            document.title = prevTitle;
            if (descEl && options.description) descEl.content = prevDesc;
            if (options.noindex) {
                if (hadRobots && robotsEl) robotsEl.content = prevRobots;
                else robotsEl?.remove();
            }
        };
    }, [options.title, options.description, options.noindex]);
}
