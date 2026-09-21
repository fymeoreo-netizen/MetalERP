import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CorsHeaders = Record<string, string>;

function corsHeaders(req: Request): CorsHeaders {
    const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const origin = req.headers.get("Origin") ?? "";
    const allowedOrigin = configured.length === 0
        ? (origin || "*")
        : (configured.includes(origin) ? origin : configured[0]);

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}

function json(body: Record<string, unknown>, status: number, cors: CorsHeaders): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...cors,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });
}

function randomToken(byteLength: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requesterAddress(req: Request): string {
    return req.headers.get("cf-connecting-ip")?.trim()
        || req.headers.get("x-real-ip")?.trim()
        || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || "unknown";
}

Deno.serve(async (req) => {
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, cors);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
        return json({ ok: false, error: "Account provisioning is not configured" }, 503, cors);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: "erp" },
    });

    const token = randomToken(12).toLowerCase();
    const email = `researcher-${Date.now().toString(36)}-${token.slice(0, 8)}@metalerp.test`;
    const password = `R!${randomToken(18)}9a`;
    const requesterHash = await sha256(
        `${requesterAddress(req)}|${serviceRoleKey.slice(-24)}`,
    );

    const { data: reservationId, error: reserveError } = await admin.rpc("reserve_researcher_account", {
        p_requester_hash: requesterHash,
        p_email: email,
    });

    if (reserveError || typeof reservationId !== "string") {
        const rateLimited = reserveError?.message.includes("rate_limited")
            || reserveError?.message.includes("capacity_reached");
        return json(
            {
                ok: false,
                error: rateLimited
                    ? "Account creation limit reached. Please try again later."
                    : "Could not reserve a researcher account.",
            },
            rateLimited ? 429 : 500,
            cors,
        );
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: "Security Researcher", account_type: "researcher" },
    });

    if (createError || !created.user) {
        await admin.rpc("cancel_researcher_account_reservation", { p_reservation_id: reservationId });
        return json({ ok: false, error: "Could not create the researcher account." }, 500, cors);
    }

    const { error: completeError } = await admin.rpc("complete_researcher_account", {
        p_reservation_id: reservationId,
        p_user_id: created.user.id,
        p_email: email,
    });

    if (completeError) {
        await admin.auth.admin.deleteUser(created.user.id);
        await admin.rpc("cancel_researcher_account_reservation", { p_reservation_id: reservationId });
        return json({ ok: false, error: "Could not finish setting up the researcher account." }, 500, cors);
    }

    return json({
        ok: true,
        credentials: {
            email,
            password,
            loginAs: "accountant",
        },
    }, 201, cors);
});
