import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, Wallet } from "lucide-react";
import { Link } from "react-router-dom";

export default function Production() {
    return (
        <DashboardLayout>
            <div className="space-y-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Production Floor</h1>
                    <p className="text-slate-500 mt-2">Select a production line to record output.</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 max-w-3xl">
                    <Link to="/production/enamel">
                        <Card className="hover:shadow-lg transition-all cursor-pointer h-full border-l-4 border-l-blue-500 group">
                            <CardHeader>
                                <div className="p-3 w-fit rounded-lg bg-blue-100 text-blue-600 mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                    <Zap className="h-8 w-8" />
                                </div>
                                <CardTitle className="text-2xl">Production</CardTitle>
                                <CardDescription>Enamel wire and copper strip output.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-slate-500">
                                    Record enamel wire batches (wire, varnish, goats) and copper strip with gross/tare weights on one screen.
                                </p>
                            </CardContent>
                        </Card>
                    </Link>


                    <Link to="/production/drawing-wages">
                        <Card className="hover:shadow-lg transition-all cursor-pointer h-full border-l-4 border-l-emerald-500 group">
                            <CardHeader>
                                <div className="p-3 w-fit rounded-lg bg-emerald-100 text-emerald-600 mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                    <Wallet className="h-8 w-8" />
                                </div>
                                <CardTitle className="text-2xl">Drawing Weekly Wages</CardTitle>
                                <CardDescription>Saturday mazdoori settlement.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-slate-500">
                                    Wire No 8 base wage (Sun–Sat) plus SWG 33+ premium. Configure rates under Drawing Labour Rates.
                                </p>
                            </CardContent>
                        </Card>
                    </Link>
                </div>
            </div>
        </DashboardLayout>
    );
}
