import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDownIcon, Factory01Icon, Logout01Icon, Menu02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAppSession } from "@/contexts/AppSessionContext";
import { clearSessionStorage } from "@/lib/appSession";
import { STAFF_LOGIN_PATH } from "@/lib/publicSiteConfig";
import { supabase } from "@/lib/supabase";
import { buildNavGroups, isActiveNavRoute, type NavGroup } from "@/lib/navConfig";
import { prefetchStaffRoute } from "@/lib/prefetchStaffRoute";
import { cn } from "@/lib/utils";

function NavGroupMenu({
    group,
    pathname,
    search,
}: {
    group: NavGroup;
    pathname: string;
    search: string;
}) {
    const groupActive = group.items.some((item) => isActiveNavRoute(pathname, search, item.href));

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    "group/trigger flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-slate-400/40",
                    groupActive
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
            >
                {group.label}
                <Icon icon={ChevronDownIcon} size={12} className="opacity-60 transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                sideOffset={6}
                className="min-w-[14rem] rounded-lg border border-slate-200/90 bg-white p-1 shadow-lg"
            >
                {group.items.map((item) => {
                    const active = isActiveNavRoute(pathname, search, item.href);
                    return (
                        <DropdownMenuItem key={item.href + item.label} asChild>
                            <Link
                                to={item.href}
                                onMouseEnter={() => prefetchStaffRoute(item.href)}
                                onFocus={() => prefetchStaffRoute(item.href)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]",
                                    active
                                        ? "bg-slate-900 font-medium text-white focus:bg-slate-900 focus:text-white"
                                        : "text-slate-600 focus:bg-slate-50 focus:text-slate-900",
                                )}
                            >
                                <Icon
                                    icon={item.icon}
                                    size={16}
                                    className={cn("shrink-0", active ? "text-white" : "text-black")}
                                />
                                <span className="truncate">{item.label}</span>
                            </Link>
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function MobileNav({
    groups,
    pathname,
    search,
    onNavigate,
}: {
    groups: NavGroup[];
    pathname: string;
    search: string;
    onNavigate: () => void;
}) {
    return (
        <div className="flex flex-col gap-0.5 px-2 py-2">
            {groups.map((group) => (
                <div key={group.label} className="py-1">
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {group.label}
                    </p>
                    {group.items.map((item) => {
                        const active = isActiveNavRoute(pathname, search, item.href);
                        return (
                            <Link
                                key={item.href + item.label}
                                to={item.href}
                                onClick={onNavigate}
                                onMouseEnter={() => prefetchStaffRoute(item.href)}
                                onFocus={() => prefetchStaffRoute(item.href)}
                                className={cn(
                                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors",
                                    active
                                        ? "bg-slate-900 font-medium text-white"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                                )}
                            >
                                <Icon
                                    icon={item.icon}
                                    size={16}
                                    className={cn("shrink-0", active ? "text-white" : "text-black")}
                                />
                                <span className="truncate">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

export function AppShell({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAdmin, isAccountant } = useAppSession();
    const [mobileOpen, setMobileOpen] = useState(false);
    const mainRef = useRef<HTMLElement>(null);

    const groups = useMemo(
        () => buildNavGroups({ isAdmin, isAccountant }),
        [isAdmin, isAccountant],
    );

    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, [location.pathname]);

    const roleLabel = isAdmin ? "Admin" : isAccountant ? "Accountant" : "Staff";

    const handleLogout = useCallback(async () => {
        setMobileOpen(false);
        try {
            await supabase.auth.signOut({ scope: "global" });
        } catch {
            /* offline or already-expired session */
        } finally {
            clearSessionStorage();
        }
        navigate(STAFF_LOGIN_PATH, { replace: true });
    }, [navigate]);

    return (
        <div className="erp-app-shell flex h-svh flex-col overflow-hidden bg-slate-50 bg-[radial-gradient(ellipse_80%_50%_at_85%_0%,rgba(0,0,0,0.04),transparent)] print:h-auto print:overflow-visible print:bg-white">
            <header className="fixed left-0 right-0 top-0 z-40 h-11 border-b border-slate-200/80 bg-white/90 shadow-[0_1px_0_0_rgba(15,23,42,0.04)] backdrop-blur-md print:hidden">
                <div className="mx-auto flex h-full max-w-[1600px] items-center gap-3 px-3 sm:px-4">
                    {/* Brand */}
                    <Link
                        to="/dashboard"
                        className="flex shrink-0 items-center gap-2 rounded-md pr-2 transition-colors hover:opacity-90"
                    >
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white">
                            <Icon icon={Factory01Icon} size={14} />
                        </div>
                        <span className="hidden text-[13px] font-semibold tracking-tight text-slate-900 sm:inline">
                            CopperSync
                        </span>
                    </Link>

                    <div className="hidden h-4 w-px bg-slate-200 md:block" aria-hidden />

                    {/* Desktop nav */}
                    <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {groups.map((group) => (
                            <NavGroupMenu
                                key={group.label}
                                group={group}
                                pathname={location.pathname}
                                search={location.search}
                            />
                        ))}
                    </nav>

                    {/* Right actions */}
                    <div className="ml-auto flex items-center gap-1">
                        <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 lg:inline">
                            {roleLabel}
                        </span>
                        <button
                            type="button"
                            onClick={() => void handleLogout()}
                            className={cn(
                                "hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-slate-600 md:flex",
                                "transition-colors hover:bg-slate-100 hover:text-slate-900",
                            )}
                        >
                            <Icon icon={Logout01Icon} size={14} />
                            <span>Log out</span>
                        </button>
                        <button
                            type="button"
                            aria-label="Open menu"
                            onClick={() => setMobileOpen(true)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 transition-colors hover:bg-slate-100 md:hidden"
                        >
                            <Icon icon={Menu02Icon} size={16} />
                        </button>
                    </div>
                </div>
            </header>

            <main
                ref={mainRef}
                className="erp-scroll-region min-h-0 flex-1 overflow-y-auto pt-11 print:overflow-visible print:pt-0"
            >
                {children}
            </main>

            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                    side="left"
                    className="w-72 border-slate-200/80 bg-white p-0 [&>button]:hidden"
                >
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <div className="flex h-full flex-col">
                        <div className="flex h-11 items-center justify-between border-b border-slate-100 px-4">
                            <span className="text-[13px] font-semibold text-slate-900">CopperSync</span>
                            <button
                                type="button"
                                aria-label="Close menu"
                                onClick={() => setMobileOpen(false)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                            >
                                <Icon icon={Cancel01Icon} size={16} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto py-1">
                            <MobileNav
                                groups={groups}
                                pathname={location.pathname}
                                search={location.search}
                                onNavigate={() => setMobileOpen(false)}
                            />
                        </div>
                        <div className="border-t border-slate-100 p-3">
                            <button
                                type="button"
                                onClick={() => void handleLogout()}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
                            >
                                <Icon icon={Logout01Icon} size={16} />
                                Log out
                            </button>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
