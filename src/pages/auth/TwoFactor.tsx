import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_SITE_NAME } from "@/lib/publicSiteConfig";
import { supabase } from "@/lib/supabase";

export default function TwoFactor() {
    const navigate = useNavigate();
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const [error, setError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    usePageMeta({
        title: `Verification · ${PUBLIC_SITE_NAME}`,
        noindex: true,
    });

    useEffect(() => {
        if (inputRefs.current[0]) {
            inputRefs.current[0].focus();
        }
    }, []);

    const handleChange = (index: number, value: string) => {
        if (isNaN(Number(value))) return;
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        if (value !== "" && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && otp[index] === "" && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleVerify = async () => {
        setError(null);
        const code = otp.join("");
        if (code.length !== 6) {
            setError("Enter the 6-digit code.");
            return;
        }
        setVerifying(true);
        try {
            // Real MFA verification against an enrolled TOTP factor. There is no bypass:
            // an invalid code (or no enrolled/verified factor) fails here.
            const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
            if (listErr) throw listErr;
            const totp = factors?.totp?.find((f) => f.status === "verified") ?? factors?.totp?.[0];
            if (!totp) {
                setError("Two-factor authentication is not set up for this account.");
                return;
            }
            const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
                factorId: totp.id,
                code,
            });
            if (verifyErr) {
                setError("Invalid or expired code.");
                return;
            }
            navigate("/dashboard");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Verification failed.");
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center p-4 relative">
            <Card className="w-full max-w-md shadow-lg border-stone-200">
                <CardHeader className="space-y-1 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="h-12 w-12 bg-stone-100 rounded-full flex items-center justify-center">
                            <ShieldCheck className="h-6 w-6 text-stone-700" />
                        </div>
                    </div>
                    <CardTitle className="text-xl font-serif font-medium text-stone-900">
                        Additional verification
                    </CardTitle>
                    <CardDescription>
                        Enter the 6-digit code sent to your device.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center gap-2 my-4">
                        {otp.map((digit, index) => (
                            <Input
                                key={index}
                                type="text"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                ref={(el) => {
                                    inputRefs.current[index] = el;
                                }}
                                className="w-10 h-12 text-center text-lg font-bold border-stone-300 focus:border-stone-500"
                            />
                        ))}
                    </div>
                    {error && (
                        <div className="text-center text-sm text-rose-600 mb-2">{error}</div>
                    )}
                    <div className="text-center text-sm text-stone-500 mb-4">
                        Enter the code from your authenticator app.
                    </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-3">
                    <Button
                        className="w-full bg-stone-900 hover:bg-stone-800 text-white"
                        onClick={() => void handleVerify()}
                        disabled={verifying}
                    >
                        {verifying ? "Verifying…" : "Verify"}
                    </Button>
                    <Link to="/" className="text-xs text-stone-400 hover:text-stone-600 text-center">
                        Back to homepage
                    </Link>
                </CardFooter>
            </Card>
        </div>
    );
}
