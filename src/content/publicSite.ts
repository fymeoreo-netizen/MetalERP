import { PUBLIC_SITE_NAME, PUBLIC_SITE_TAGLINE } from "@/lib/publicSiteConfig";

export type PublicSiteFaq = { q: string; a: string };

export type PublicSiteTier = {
    name: string;
    price: string;
    perks: string[];
};

export const publicSiteContent = {
    name: PUBLIC_SITE_NAME,
    tagline: PUBLIC_SITE_TAGLINE,
    hero: {
        headline: "Organize your rubber bands with confidence.",
        subhead:
            "A global community dedicated to the art, science, and gentle philosophy of keeping elastic loops tidy since 2003.",
        ctaPrimary: "Read our manifesto",
        ctaSecondary: "View membership tiers",
    },
    about: {
        title: "Our mission",
        paragraphs: [
            "Every desk drawer holds potential chaos. We believe rubber bands—often overlooked, frequently tangled—deserve thoughtful stewardship.",
            "Through workshops, seasonal newsletters, and peer-reviewed stacking guidelines, we help enthusiasts store loops without shame.",
            "We are not affiliated with any office supply manufacturer. We simply care—perhaps too much—about elastic organization.",
        ],
    },
    features: [
        {
            title: "Diagonal vs. vertical stacking",
            body: "Our 47-page guide settles the debate once and for all (results may vary by drawer humidity).",
        },
        {
            title: "Color sorting symposium",
            body: "Annual virtual event. Last year: 312 attendees, zero tangled bands reported in post-surveys.",
        },
        {
            title: "The Loop Ledger",
            body: "A members-only journal of acquisition dates, tensile memories, and retirement ceremonies.",
        },
    ],
    tiers: [
        {
            name: "Bronze Clip",
            price: "Free",
            perks: ["Monthly digest", "Forum access", "Sticker sheet (while supplies last)"],
        },
        {
            name: "Silver Loop",
            price: "$12 / year",
            perks: ["Everything in Bronze", "Priority FAQ responses", "Official lanyard"],
        },
        {
            name: "Gold Coil",
            price: "$40 / year",
            perks: ["Everything in Silver", "Handwritten welcome note", "Name in the archive"],
        },
    ] satisfies PublicSiteTier[],
    faq: [
        {
            q: "Is this a real organization?",
            a: "We prefer the term earnestly niche. Our members are real; our passion is sincere.",
        },
        {
            q: "Do you sell rubber bands?",
            a: "No. We only offer guidance. Purchase bands from any reputable stationery purveyor.",
        },
        {
            q: "How do I update my membership details?",
            a: "Existing members may use the member registry link in the footer to verify their records.",
        },
    ] satisfies PublicSiteFaq[],
    footer: {
        copyright: "International Society for Optimal Rubber Band Storage",
        links: [
            { label: "Manifesto", href: "#about" },
            { label: "Membership", href: "#tiers" },
            { label: "FAQ", href: "#faq" },
            { label: "Contact", href: "mailto:hello@rubberband-society.example" },
        ],
    },
};
