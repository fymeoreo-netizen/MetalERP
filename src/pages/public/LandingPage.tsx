import { Link } from "react-router-dom";
import { publicSiteContent } from "@/content/publicSite";
import {
    DISGUISED_LOGIN_LABEL,
    PUBLIC_SITE_NAME,
    PUBLIC_SITE_TAGLINE,
    STAFF_LOGIN_PATH,
} from "@/lib/publicSiteConfig";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";

function scrollToHash(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!href.startsWith("#")) return;
    e.preventDefault();
    const el = document.querySelector(href);
    el?.scrollIntoView({ behavior: "smooth" });
}

export default function LandingPage() {
    const c = publicSiteContent;

    usePageMeta({
        title: PUBLIC_SITE_NAME,
        description: PUBLIC_SITE_TAGLINE,
    });

    return (
        <div className="min-h-screen bg-[#faf8f5] text-stone-800">
            {/* Header */}
            <header className="border-b border-stone-200/80 bg-[#faf8f5]/90 backdrop-blur-sm sticky top-0 z-20">
                <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-lg ring-1 ring-amber-200/80">
                            ○
                        </span>
                        <span className="text-sm font-semibold tracking-tight text-stone-900 max-w-[200px] sm:max-w-none leading-tight">
                            {c.name}
                        </span>
                    </div>
                    <nav className="hidden sm:flex items-center gap-5 text-xs text-stone-500">
                        {c.footer.links.slice(0, 3).map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                onClick={(e) => scrollToHash(e, link.href)}
                                className="hover:text-stone-800 transition-colors"
                            >
                                {link.label}
                            </a>
                        ))}
                    </nav>
                </div>
            </header>

            {/* Hero */}
            <section className="mx-auto max-w-3xl px-5 pt-14 pb-16 text-center">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-700/80 mb-4">
                    Est. 2003 · Peer-reviewed elasticity
                </p>
                <h1 className="text-3xl sm:text-4xl font-serif font-medium tracking-tight text-stone-900 leading-tight">
                    {c.hero.headline}
                </h1>
                <p className="mt-4 text-base text-stone-600 leading-relaxed max-w-xl mx-auto">
                    {c.hero.subhead}
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <a
                        href="#about"
                        onClick={(e) => scrollToHash(e, "#about")}
                        className="inline-flex h-10 items-center rounded-full bg-stone-900 px-5 text-sm font-medium text-stone-50 hover:bg-stone-800 transition-colors"
                    >
                        {c.hero.ctaPrimary}
                    </a>
                    <a
                        href="#tiers"
                        onClick={(e) => scrollToHash(e, "#tiers")}
                        className="inline-flex h-10 items-center rounded-full border border-stone-300 bg-white px-5 text-sm font-medium text-stone-700 hover:border-stone-400 transition-colors"
                    >
                        {c.hero.ctaSecondary}
                    </a>
                </div>
            </section>

            {/* Features */}
            <section className="border-y border-stone-200/80 bg-white/60">
                <div className="mx-auto max-w-3xl px-5 py-14 grid gap-8 sm:grid-cols-3">
                    {c.features.map((f) => (
                        <div key={f.title}>
                            <h3 className="text-sm font-semibold text-stone-900">{f.title}</h3>
                            <p className="mt-2 text-xs text-stone-600 leading-relaxed">{f.body}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* About */}
            <section id="about" className="mx-auto max-w-3xl px-5 py-14 scroll-mt-16">
                <h2 className="text-xl font-serif font-medium text-stone-900">{c.about.title}</h2>
                <div className="mt-5 space-y-4 text-sm text-stone-600 leading-relaxed">
                    {c.about.paragraphs.map((p, i) => (
                        <p key={i}>{p}</p>
                    ))}
                </div>
            </section>

            {/* Tiers */}
            <section id="tiers" className="border-t border-stone-200/80 bg-amber-50/40 scroll-mt-16">
                <div className="mx-auto max-w-3xl px-5 py-14">
                    <h2 className="text-xl font-serif font-medium text-stone-900 text-center">Membership tiers</h2>
                    <p className="text-center text-xs text-stone-500 mt-2">Choose your level of commitment to the loop.</p>
                    <div className="mt-8 grid gap-4 sm:grid-cols-3">
                        {c.tiers.map((tier, i) => (
                            <div
                                key={tier.name}
                                className={cn(
                                    "rounded-2xl border bg-white p-5 shadow-sm",
                                    i === 1 ? "border-amber-300 ring-1 ring-amber-200/60" : "border-stone-200/80",
                                )}
                            >
                                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800/80">
                                    {tier.name}
                                </p>
                                <p className="mt-1 text-lg font-semibold text-stone-900">{tier.price}</p>
                                <ul className="mt-4 space-y-1.5 text-xs text-stone-600">
                                    {tier.perks.map((perk) => (
                                        <li key={perk} className="flex gap-1.5">
                                            <span className="text-amber-600">·</span>
                                            {perk}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section id="faq" className="mx-auto max-w-3xl px-5 py-14 scroll-mt-16">
                <h2 className="text-xl font-serif font-medium text-stone-900">Frequently asked questions</h2>
                <dl className="mt-6 space-y-6">
                    {c.faq.map((item) => (
                        <div key={item.q}>
                            <dt className="text-sm font-medium text-stone-900">{item.q}</dt>
                            <dd className="mt-1.5 text-sm text-stone-600 leading-relaxed">{item.a}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            {/* Footer */}
            <footer className="border-t border-stone-200/80 bg-stone-100/50">
                <div className="mx-auto max-w-3xl px-5 py-8">
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-stone-500">
                        {c.footer.links.map((link) =>
                            link.href.startsWith("#") ? (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    onClick={(e) => scrollToHash(e, link.href)}
                                    className="hover:text-stone-700 transition-colors"
                                >
                                    {link.label}
                                </a>
                            ) : (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    className="hover:text-stone-700 transition-colors"
                                >
                                    {link.label}
                                </a>
                            ),
                        )}
                        <span className="text-stone-300 hidden sm:inline">|</span>
                        <Link
                            to={STAFF_LOGIN_PATH}
                            className="text-stone-500 hover:text-stone-700 transition-colors"
                        >
                            {DISGUISED_LOGIN_LABEL}
                        </Link>
                    </div>
                    <p className="mt-4 text-center text-[10px] text-stone-400">
                        © {new Date().getFullYear()} {c.footer.copyright}
                    </p>
                </div>
            </footer>
        </div>
    );
}
