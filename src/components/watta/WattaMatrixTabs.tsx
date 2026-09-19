import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabsScroller } from "@/components/ui/responsive-primitives";
import type { ReactNode } from "react";

type Props = {
    salesContent: ReactNode;
    purchaseContent: ReactNode;
    tab: "sales" | "purchase";
    onTabChange: (tab: "sales" | "purchase") => void;
};

export function WattaMatrixTabs({ salesContent, purchaseContent, tab, onTabChange }: Props) {
    return (
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as "sales" | "purchase")}>
            <TabsScroller>
                <TabsList className="mb-4">
                    <TabsTrigger value="sales">Premium sales (enamel)</TabsTrigger>
                    <TabsTrigger value="purchase">Premium purchase (wire / rod)</TabsTrigger>
                </TabsList>
            </TabsScroller>
            <TabsContent value="sales">{salesContent}</TabsContent>
            <TabsContent value="purchase">{purchaseContent}</TabsContent>
        </Tabs>
    );
}
