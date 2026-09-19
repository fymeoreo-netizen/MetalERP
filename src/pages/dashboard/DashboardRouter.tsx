import { useAppSession } from "@/contexts/AppSessionContext";
import { TabContentMotion } from "@/components/motion/MotionPrimitives";
import Dashboard from "./Dashboard";
import AccountantDashboard from "./AccountantDashboard";

/** Home dashboard (role-specific). */
export default function DashboardRouter() {
    const { isAccountant } = useAppSession();
    return (
        <TabContentMotion>
            {isAccountant ? <AccountantDashboard /> : <Dashboard />}
        </TabContentMotion>
    );
}
