import type { IconSvgElement } from "@hugeicons/react";
import {
    Alert01Icon,
    BookOpen01Icon,
    BookOpen02Icon,
    BoxIcon,
    ChartColumnIcon,
    ChartLineIcon,
    ChartUpIcon,
    DashboardSquare01Icon,
    Database01Icon,
    Factory01Icon,
    Grid2X2Icon,
    Grid3X3Icon,
    JusticeScale01Icon,
    Package01Icon,
    ReceiptTextIcon,
    Recycle01Icon,
    ReplaceIcon,
    Settings01Icon,
    Shield01Icon,
    ShoppingBag01Icon,
    ShoppingCart01Icon,
    SparklesIcon,
    TagsIcon,
    TrendingUpDownIcon,
    UserGroupIcon,
    Wallet01Icon,
} from "@hugeicons/core-free-icons";

export type NavItem = {
    label: string;
    href: string;
    icon: IconSvgElement;
};

export type NavGroup = {
    label: string;
    items: NavItem[];
};

export function isActiveNavRoute(currentPath: string, currentSearch: string, href: string): boolean {
    const [path, query] = href.split("?");
    if (query) {
        return currentPath === path && currentSearch.includes(query);
    }
    if (path === "/inventory") {
        return currentPath === path || currentPath.startsWith("/inventory/");
    }
    if (path === "/production") {
        return currentPath === path || currentPath.startsWith("/production/");
    }
    if (path === "/masters/parties") {
        return currentPath === path || currentPath.startsWith("/masters/parties/");
    }
    if (path === "/reports") {
        return currentPath === path || currentPath.startsWith("/reports");
    }
    if (path === "/ledgers") {
        return currentPath === path || currentPath.startsWith("/ledgers");
    }
    if (path === "/market") {
        return currentPath === path || currentPath.startsWith("/market");
    }
    if (path === "/assistant") {
        return currentPath === path || currentPath.startsWith("/assistant");
    }
    return currentPath === path;
}

export function buildNavGroups(options: { isAdmin: boolean; isAccountant: boolean }): NavGroup[] {
    const { isAdmin, isAccountant } = options;

    const main: NavGroup = {
        label: "Main",
        items: [
            { label: "Dashboard", href: "/dashboard", icon: DashboardSquare01Icon },
            { label: "Purchase", href: "/purchase", icon: ShoppingCart01Icon },
            { label: "Sales", href: "/sales", icon: ShoppingBag01Icon },
            { label: "Cashbook", href: "/cashbook", icon: Wallet01Icon },
            { label: "Journal Vouchers", href: "/journal-vouchers", icon: BookOpen01Icon },
            { label: "Period Costing", href: "/period-costing", icon: ChartColumnIcon },
        ],
    };

    const operationsItems: NavItem[] = [
        ...(!isAccountant
            ? [
                  { label: "Inventory", href: "/inventory", icon: Package01Icon },
                  { label: "Stock Adjustments", href: "/inventory/adjustments", icon: JusticeScale01Icon },
              ]
            : []),
        { label: "Production", href: "/production", icon: Factory01Icon },
        { label: "Scrap", href: "/scrap", icon: ReplaceIcon },
        { label: "Factory Scrap", href: "/production/scrap-dispatch", icon: Recycle01Icon },
        { label: "Parchi Register", href: "/parchis", icon: ReceiptTextIcon },
        { label: "Rate Mgmt", href: "/rate-management", icon: ChartUpIcon },
    ];

    const reportsItems: NavItem[] = [
        ...(!isAccountant
            ? [{ label: "Reports Hub", href: "/reports", icon: ChartColumnIcon }]
            : []),
        { label: "Market Intelligence", href: "/market", icon: ChartLineIcon },
        {
            label: "Unified Ledgers",
            href: isAccountant ? "/ledgers" : "/reports?report=unified-ledgers",
            icon: BookOpen02Icon,
        },
        { label: "Alerts & Risk", href: "/alerts", icon: Alert01Icon },
        { label: "ERP Ask", href: "/assistant", icon: SparklesIcon },
        ...(isAdmin ? [{ label: "Audit Logs", href: "/audit", icon: Shield01Icon }] : []),
    ];

    const masters: NavGroup = {
        label: "Masters",
        items: [
            { label: "Item Master", href: "/masters/items", icon: BoxIcon },
            { label: "Party Master", href: "/masters/parties", icon: Database01Icon },
            { label: "Chart of Accounts", href: "/masters/coa", icon: Grid3X3Icon },
            { label: "Drawing Labour", href: "/masters/labor-rates", icon: TrendingUpDownIcon },
            { label: "Watta Matrix", href: "/masters/watta", icon: Grid2X2Icon },
        ],
    };

    const groups: NavGroup[] = [
        main,
        { label: "Operations", items: operationsItems },
        { label: "Reports", items: reportsItems },
        masters,
    ];

    if (isAdmin) {
        groups.push({
            label: "Admin",
            items: [
                { label: "Users", href: "/admin/users", icon: UserGroupIcon },
                {
                    label: "Production Settings",
                    href: "/admin/production-settings",
                    icon: Settings01Icon,
                },
                {
                    label: "Item Product Types",
                    href: "/admin/item-types",
                    icon: TagsIcon,
                },
            ],
        });
    }

    return groups;
}
