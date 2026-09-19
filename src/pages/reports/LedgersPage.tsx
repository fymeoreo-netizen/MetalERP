import DashboardLayout from "@/components/layout/DashboardLayout";
import { UnifiedLedgersPanel } from "./UnifiedLedgers";

export default function LedgersPage() {
    return (
        <DashboardLayout>
            <div className="report-workspace-canvas print:bg-white print:p-0">
                <UnifiedLedgersPanel embedded />
            </div>
        </DashboardLayout>
    );
}
