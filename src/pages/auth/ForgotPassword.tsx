import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_SITE_NAME, STAFF_LOGIN_PATH } from "@/lib/publicSiteConfig";
import { supabase } from "@/lib/supabase";

export default function ForgotPassword() {
    const [emailSent, setEmailSent] = useState(false);
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    usePageMeta({
        title: `Password reset · ${PUBLIC_SITE_NAME}`,
        noindex: true,
    });

    const handleSendReset = async () => {
        setError(null);
        const trimmed = email.trim();
        if (!trimmed) {
            setError("Enter your email address.");
            return;
        }
        setLoading(true);
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
            redirectTo: `${window.location.origin}/auth/reset`,
        });
        setLoading(false);
        // Always show success to avoid leaking which emails are registered.
        if (resetError) {
            // Only surface transport/config errors, not account existence.
            console.warn("password reset request failed", resetError.message);
        }
        setEmailSent(true);
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-lg border-slate-200">
                <CardHeader className="space-y-1">
                    <Link to={STAFF_LOGIN_PATH} className="mb-4 inline-flex items-center text-sm text-slate-500 hover:text-slate-900">
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        Back to registry
                    </Link>
                    <CardTitle className="text-2xl font-bold text-slate-900">Reset Password</CardTitle>
                    <CardDescription>
                        {emailSent
                            ? "Check your email for the reset link."
                            : "Enter your email address and we'll send you a link to reset your password."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!emailSent ? (
                        <div className="space-y-2">
                            <Label htmlFor="email">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") void handleSendReset(); }}
                            />
                            {error && <p className="text-xs text-rose-600">{error}</p>}
                        </div>
                    ) : (
                        <div className="p-4 bg-emerald-50 text-emerald-800 rounded-lg flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Check className="h-4 w-4 text-emerald-600" />
                            </div>
                            <div className="text-sm font-medium">
                                If that email is registered, a reset link has been sent.
                            </div>
                        </div>
                    )}
                </CardContent>
                <CardFooter>
                    {!emailSent && (
                        <Button
                            className="w-full bg-blue-600 hover:bg-blue-700"
                            onClick={() => void handleSendReset()}
                            disabled={loading}
                        >
                            {loading ? "Sending…" : "Send Reset Link"}
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
