import { Link } from "react-router-dom";
import { PUBLIC_SITE_NAME, PUBLIC_SITE_TAGLINE } from "@/lib/publicSiteConfig";
import { usePageMeta } from "@/hooks/usePageMeta";

export default function NotFoundPage() {
    usePageMeta({
        title: `Page not found · ${PUBLIC_SITE_NAME}`,
        description: PUBLIC_SITE_TAGLINE,
    });

    return (
        <div className="min-h-screen bg-[#faf8f5] flex flex-col items-center justify-center px-5 text-center">
            <p className="text-6xl font-serif text-stone-300">404</p>
            <h1 className="mt-4 text-lg font-medium text-stone-900">This page doesn&apos;t exist</h1>
            <p className="mt-2 text-sm text-stone-500 max-w-sm">
                The resource you requested could not be found. Perhaps it was retired to the archive.
            </p>
            <Link
                to="/"
                className="mt-8 inline-flex h-10 items-center rounded-full border border-stone-300 bg-white px-5 text-sm font-medium text-stone-700 hover:border-stone-400 transition-colors"
            >
                Return home
            </Link>
        </div>
    );
}
