import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    BookOpen,
    FileText,
    Receipt,
    ShoppingCart,
    Wallet,
    ArrowRight,
} from "lucide-react";
import { StaggerContainer, StaggerItem } from "@/components/motion/MotionPrimitives";

const shortcuts = [
    {
        title: "Sales invoices",
        description: "Create, post, and manage sales invoices and credit notes.",
        href: "/sales",
        icon: Receipt,
        accent: "bg-emerald-50 text-emerald-700",
    },
    {
        title: "Purchase invoices",
        description: "Create, post, and manage purchase invoices and debit notes.",
        href: "/purchase",
        icon: ShoppingCart,
        accent: "bg-blue-50 text-blue-700",
    },
    {
        title: "Cashbook",
        description: "Record receipts, payments, and parchi clearances.",
        href: "/cashbook",
        icon: Wallet,
        accent: "bg-violet-50 text-violet-700",
    },
    {
        title: "Parchi register",
        description: "Issue and track parchi commitments.",
        href: "/parchis",
        icon: FileText,
        accent: "bg-amber-50 text-amber-700",
    },
    {
        title: "Party & cash ledgers",
        description: "View party statements and cash & bank account ledgers.",
        href: "/ledgers",
        icon: BookOpen,
        accent: "bg-slate-100 text-slate-700",
    },
] as const;

export default function AccountantDashboard() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    return (
        <DashboardLayout>
            <div className="space-y-8 max-w-4xl">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Accounting workspace</h1>
                    <p className="text-slate-500 mt-1">{dateStr}</p>
                    <p className="text-sm text-slate-600 mt-2">
                        Post financial documents and review party or cash ledgers. Operational reports and
                        inventory are not available on this role.
                    </p>
                </div>

                <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {shortcuts.map((item) => {
                        const Icon = item.icon;
                        return (
                            <StaggerItem key={item.href} className="h-full">
                            <Link to={item.href} className="group block h-full">
                                <Card className="h-full shadow-soft border-slate-100 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-slate-200">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-start justify-between gap-3">
                                            <div
                                                className={`p-2 rounded-lg ${item.accent}`}
                                            >
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-600 transition-colors shrink-0 mt-1" />
                                        </div>
                                        <CardTitle className="text-base">{item.title}</CardTitle>
                                        <CardDescription className="text-xs leading-relaxed">
                                            {item.description}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="pt-0">
                                        <span className="text-xs font-medium text-blue-600 group-hover:text-blue-700">
                                            Open module
                                        </span>
                                    </CardContent>
                                </Card>
                            </Link>
                            </StaggerItem>
                        );
                    })}
                </StaggerContainer>
            </div>
        </DashboardLayout>
    );
}
