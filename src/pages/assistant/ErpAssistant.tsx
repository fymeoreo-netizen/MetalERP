import DashboardLayout from "@/components/layout/DashboardLayout";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { isErpLiveMode } from "@/lib/backendFlags";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ErpAssistant() {
    const live = isErpLiveMode();

    return (
        <DashboardLayout>
            <div className="max-w-3xl mx-auto space-y-6 p-4 md:p-6">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-violet-500" />
                        ERP Ask
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Natural-language questions over your live data — party ledgers, invoices, stock, pending rates,
                        and posting diagnostics.{" "}
                        <Link to="/assistant#glossary" className="text-violet-600 hover:underline inline-flex items-center gap-1">
                            <BookOpen className="h-3.5 w-3.5" />
                            Glossary
                        </Link>
                    </p>
                </div>

                {!live ? (
                    <Alert>
                        <AlertDescription>
                            Sign in with Supabase live mode to use ERP Ask. Demo mode has no database connection.
                        </AlertDescription>
                    </Alert>
                ) : null}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Ask a question</CardTitle>
                        <CardDescription>
                            Read-only. Admins can access financial statements; accountants get ledgers, documents, and
                            diagnostics.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <AssistantPanel context={{ page: "assistant" }} />
                    </CardContent>
                </Card>

                <Card id="glossary">
                    <CardHeader>
                        <CardTitle className="text-lg">Domain glossary</CardTitle>
                        <CardDescription>
                            Terms the assistant understands. Full reference in repo: docs/ai-glossary.md
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-2">
                        <p>
                            <strong className="text-foreground">Financial khata</strong> — PKR party ledger (debits/credits).
                        </p>
                        <p>
                            <strong className="text-foreground">Metal khata</strong> — kg metal account, separate from PKR.
                        </p>
                        <p>
                            <strong className="text-foreground">Rate pending</strong> — lines awaiting final rate; may show Rs 0 until fixed.
                        </p>
                        <p>
                            <strong className="text-foreground">Parchi</strong> — informal metal instrument cleared against payments or scrap.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
