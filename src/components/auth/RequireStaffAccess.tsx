import { useEffect, useRef, type ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAppSession } from "@/contexts/AppSessionContext";
import { NOT_FOUND_PATH, STAFF_LOGIN_PATH } from "@/lib/publicSiteConfig";

export function RequireAuth({ children }: { children: ReactElement }) {
    const { ready, userId } = useAppSession();
    if (!ready) return null;
    if (!userId) return <Navigate to={NOT_FOUND_PATH} replace />;
    return children;
}

/** Authenticated users with a resolved ERP role that may open this path. */
export function RequireStaffAccess({ children }: { children: ReactElement }) {
    const { ready, userId, role, canAccessPath } = useAppSession();
    const location = useLocation();
    const lastDeniedPath = useRef<string | null>(null);

    useEffect(() => {
        if (!ready || !userId || !role) return;
        if (!canAccessPath(location.pathname)) {
            if (lastDeniedPath.current !== location.pathname) {
                lastDeniedPath.current = location.pathname;
                toast.error("This area is not available for your role.");
            }
        } else {
            lastDeniedPath.current = null;
        }
    }, [ready, userId, role, location.pathname, canAccessPath]);

    if (!ready) return null;
    if (!userId) return <Navigate to={NOT_FOUND_PATH} replace />;
    if (!role) return <Navigate to={STAFF_LOGIN_PATH} replace />;
    if (!canAccessPath(location.pathname)) {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
}

export function RequireAuthStaff({ children }: { children: ReactElement }) {
    return (
        <RequireAuth>
            <RequireStaffAccess>{children}</RequireStaffAccess>
        </RequireAuth>
    );
}

/** Layout route: auth + role gate, renders child routes via Outlet. */
export function AuthStaffLayout() {
    return (
        <RequireAuth>
            <RequireStaffAccessLayout />
        </RequireAuth>
    );
}

function RequireStaffAccessLayout() {
    const { ready, userId, role, canAccessPath } = useAppSession();
    const location = useLocation();
    const lastDeniedPath = useRef<string | null>(null);

    useEffect(() => {
        if (!ready || !userId || !role) return;
        if (!canAccessPath(location.pathname)) {
            if (lastDeniedPath.current !== location.pathname) {
                lastDeniedPath.current = location.pathname;
                toast.error("This area is not available for your role.");
            }
        } else {
            lastDeniedPath.current = null;
        }
    }, [ready, userId, role, location.pathname, canAccessPath]);

    if (!ready) return null;
    if (!userId) return <Navigate to={NOT_FOUND_PATH} replace />;
    if (!role) return <Navigate to={STAFF_LOGIN_PATH} replace />;
    if (!canAccessPath(location.pathname)) {
        return <Navigate to="/dashboard" replace />;
    }
    return <Outlet />;
}
