interface DashboardLayoutProps {
    children: React.ReactNode;
}

/** Page content container — AppShell lives on the persistent staff route layout. */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <div className="min-h-0">
            <div className="container mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 md:px-8 print:m-0 print:max-w-none print:p-0">
                {children}
            </div>
        </div>
    );
}
