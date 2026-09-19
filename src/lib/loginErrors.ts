import { supabase } from "@/lib/supabase";

export type LoginFailure = {
    title: string;
    description: string;
};

export function mapAuthSignInError(message: string | undefined): LoginFailure {
    const msg = (message ?? "").toLowerCase();

    if (
        msg.includes("invalid login credentials") ||
        msg.includes("invalid email or password") ||
        msg.includes("invalid credentials")
    ) {
        return {
            title: "Incorrect email or password",
            description: "Check your work email and password, then try again.",
        };
    }

    if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
        return {
            title: "Email not verified",
            description: "This account is not verified yet. Ask your administrator to activate it.",
        };
    }

    if (msg.includes("banned") || msg.includes("disabled") || msg.includes("user is banned")) {
        return {
            title: "Account inactive",
            description: "This account has been deactivated. Contact your administrator for access.",
        };
    }

    if (msg.includes("too many requests") || msg.includes("rate limit")) {
        return {
            title: "Too many attempts",
            description: "Please wait a minute before trying to sign in again.",
        };
    }

    return {
        title: "Sign in failed",
        description: message ?? "Unable to sign in. Check your details and try again.",
    };
}

export type LoginStatus = {
    profileExists: boolean;
    isActive: boolean;
    roles: ("ADMIN" | "ACCOUNTANT")[];
};

export async function fetchMyLoginStatus(): Promise<LoginStatus | null> {
    const { data, error } = await supabase.schema("erp").rpc("get_my_login_status");
    if (error || !data) return null;

    const rolesRaw = (data as { roles?: unknown }).roles;
    const roles = Array.isArray(rolesRaw)
        ? rolesRaw.filter((r): r is "ADMIN" | "ACCOUNTANT" => r === "ADMIN" || r === "ACCOUNTANT")
        : [];

    return {
        profileExists: (data as { profile_exists?: boolean }).profile_exists === true,
        isActive: (data as { is_active?: boolean }).is_active === true,
        roles,
    };
}

export function mapPostAuthLoginFailure(
    status: LoginStatus | null,
    loginAs: "admin" | "accountant"
): LoginFailure | null {
    if (!status) {
        return {
            title: "Account setup incomplete",
            description: "Your profile could not be loaded. Contact your administrator.",
        };
    }

    if (!status.profileExists) {
        return {
            title: "Account setup incomplete",
            description: "This account is not registered yet. Contact your administrator.",
        };
    }

    if (!status.isActive) {
        return {
            title: "Account inactive",
            description: "This account has been deactivated. Contact your administrator for access.",
        };
    }

    if (status.roles.length === 0) {
        return {
            title: "No role assigned",
            description: "This account has no Admin or Accountant role. Contact your administrator.",
        };
    }

    const targetRole = loginAs === "admin" ? "ADMIN" : "ACCOUNTANT";
    if (!status.roles.includes(targetRole)) {
        const assigned = status.roles.map((r) => (r === "ADMIN" ? "Admin" : "Accountant")).join(" or ");
        const selected = loginAs === "admin" ? "Admin" : "Accountant";
        return {
            title: "Wrong login role selected",
            description: `This account is assigned as ${assigned}. Change "Login as" to ${assigned} and try again. You selected ${selected}.`,
        };
    }

    return null;
}
