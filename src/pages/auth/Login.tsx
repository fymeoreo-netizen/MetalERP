import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Shield } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import PageMotion from "@/components/layout/PageMotion";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { persistSessionPatch } from "@/lib/appSession";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import {
    fetchMyLoginStatus,
    mapAuthSignInError,
    mapPostAuthLoginFailure,
    type LoginFailure,
} from "@/lib/loginErrors";
import { usePageMeta } from "@/hooks/usePageMeta";
import { DISGUISED_LOGIN_LABEL, PUBLIC_SITE_NAME } from "@/lib/publicSiteConfig";

const fieldClass =
    "h-11 rounded-lg border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200";

export default function Login() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loginAs, setLoginAs] = useState<"admin" | "accountant">("admin");
    const [loginError, setLoginError] = useState<LoginFailure | null>(null);

    usePageMeta({
        title: `${DISGUISED_LOGIN_LABEL} · ${PUBLIC_SITE_NAME}`,
        description: "Verify membership records.",
        noindex: true,
    });

    const showLoginError = (failure: LoginFailure) => {
        setLoginError(failure);
        toast({
            title: failure.title,
            description: failure.description,
            variant: "destructive",
        });
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError(null);
        setIsLoading(true);
        const normalizedEmail = email.trim().toLowerCase();

        if (!normalizedEmail || !password) {
            setIsLoading(false);
            showLoginError({
                title: "Missing details",
                description: "Enter your email and password.",
            });
            return;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
        });

        if (error || !data.user) {
            setIsLoading(false);
            showLoginError(mapAuthSignInError(error?.message));
            return;
        }

        const status = await fetchMyLoginStatus();
        const postAuthFailure = mapPostAuthLoginFailure(status, loginAs);
        if (postAuthFailure) {
            await supabase.auth.signOut();
            setIsLoading(false);
            showLoginError(postAuthFailure);
            return;
        }

        setIsLoading(false);
        persistSessionPatch({ userId: data.user.id });
        navigate("/dashboard");
    };

    return (
        <PageMotion>
            <div className="flex min-h-screen flex-col bg-slate-50">
                <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
                    <div className="w-full max-w-[400px] rounded-xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
                        <div className="mb-8 text-center">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                {DISGUISED_LOGIN_LABEL}
                            </p>
                            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                                Verify your identity
                            </h1>
                            <p className="mt-1.5 text-sm text-slate-500">
                                Sign in with the credentials linked to your membership record.
                            </p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-4">
                            {loginError && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>{loginError.title}</AlertTitle>
                                    <AlertDescription>{loginError.description}</AlertDescription>
                                </Alert>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-xs font-medium text-slate-700">
                                    Email
                                </Label>
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        setLoginError(null);
                                    }}
                                    placeholder="you@example.com"
                                    className={fieldClass}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="login-role" className="text-xs font-medium text-slate-700">
                                    Access tier
                                </Label>
                                <Select
                                    value={loginAs}
                                    onValueChange={(v) => {
                                        setLoginAs(v as "admin" | "accountant");
                                        setLoginError(null);
                                    }}
                                >
                                    <SelectTrigger id="login-role" className={fieldClass}>
                                        <SelectValue placeholder="Select tier" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">Registry administrator</SelectItem>
                                        <SelectItem value="accountant">Standard member</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="password" className="text-xs font-medium text-slate-700">
                                        Password
                                    </Label>
                                    <Link
                                        to="/auth/forgot-password"
                                        className="text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-800"
                                    >
                                        Forgot?
                                    </Link>
                                </div>
                                <Input
                                    id="password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        setLoginError(null);
                                    }}
                                    placeholder="••••••••"
                                    className={fieldClass}
                                    required
                                />
                            </div>

                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="mt-2 h-11 w-full rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800"
                            >
                                {isLoading ? (
                                    "Verifying…"
                                ) : (
                                    <>
                                        Continue
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </Button>
                        </form>

                        <div className="mt-8 flex items-center justify-center gap-2 border-t border-slate-100 pt-6 text-[11px] text-slate-400">
                            <Shield className="h-3.5 w-3.5" />
                            Encrypted session
                        </div>
                    </div>
                </div>
            </div>
        </PageMotion>
    );
}
