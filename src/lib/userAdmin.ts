import { getAppSession } from "@/lib/appSession";
import { supabase } from "@/lib/supabase";

export type AppRoleCode = "ADMIN" | "ACCOUNTANT";

export type ManagedUser = {
    userId: string;
    email: string | null;
    displayName: string | null;
    isActive: boolean;
    role: AppRoleCode | "UNASSIGNED";
    canPost: boolean;
};

function rpcMissingMessage(fn: string): string {
    return `${fn} is not deployed. Run migrations 46 and 47 in Supabase SQL Editor.`;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
    const { data: profiles, error } = await supabase
        .schema("erp")
        .from("user_profiles")
        .select("user_id,email,display_name,is_active")
        .order("created_at", { ascending: false });

    if (error || !profiles) return [];

    const { data: roleRows } = await supabase
        .schema("erp")
        .from("user_role_assignments")
        .select("user_id,roles(code)");

    const roleMap = new Map<string, AppRoleCode | "UNASSIGNED">();
    (roleRows ?? []).forEach((row: any) => {
        const code = row?.roles?.code as string | undefined;
        if (code === "ADMIN" || code === "ACCOUNTANT") {
            roleMap.set(row.user_id as string, code);
        }
    });

    return profiles.map((p: any) => ({
        userId: p.user_id as string,
        email: (p.email as string | null) ?? null,
        displayName: (p.display_name as string | null) ?? null,
        isActive: p.is_active === true,
        role: roleMap.get(p.user_id as string) ?? "UNASSIGNED",
        canPost: (roleMap.get(p.user_id as string) ?? "UNASSIGNED") !== "UNASSIGNED",
    }));
}

export async function createManagedUser(input: {
    displayName: string;
    email: string;
    password: string;
    role: AppRoleCode;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const { userId: sessionUserId } = getAppSession();
    if (!sessionUserId) return { ok: false, error: "Session is not ready. Re-login and try again." };

    const { data: userId, error } = await supabase.schema("erp").rpc("admin_create_managed_user", {
        p_email: input.email.trim().toLowerCase(),
        p_password: input.password,
        p_display_name: input.displayName.trim(),
        p_role_code: input.role,
    });

    if (error) {
        const message = error.message ?? "Failed to create user.";
        if (message.toLowerCase().includes("does not exist")) {
            return { ok: false, error: rpcMissingMessage("admin_create_managed_user") };
        }
        return { ok: false, error: message };
    }

    if (!userId) {
        return { ok: false, error: "Failed to create user." };
    }

    return { ok: true };
}

export async function updateManagedUser(input: {
    userId: string;
    displayName: string;
    email: string;
    role: AppRoleCode;
    isActive: boolean;
    password?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const { userId: sessionUserId } = getAppSession();
    if (!sessionUserId) return { ok: false, error: "Session is not ready. Re-login and try again." };

    const { error } = await supabase.schema("erp").rpc("admin_update_managed_user", {
        p_user_id: input.userId,
        p_display_name: input.displayName.trim(),
        p_email: input.email.trim().toLowerCase(),
        p_role_code: input.role,
        p_is_active: input.isActive,
        p_password: input.password && input.password.length >= 6 ? input.password : null,
    });
    if (error) {
        if (error.message.toLowerCase().includes("does not exist")) {
            return { ok: false, error: rpcMissingMessage("admin_update_managed_user") };
        }
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

/** Confirm an existing auth user so they can log in immediately (admin-only). */
export async function confirmManagedUser(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await supabase.schema("erp").rpc("admin_confirm_auth_user", {
        p_user_id: userId,
    });
    if (error) {
        return { ok: false, error: error.message ?? "Failed to confirm user." };
    }
    return { ok: true };
}
