import { supabase } from "@/lib/supabase";

export type ResearcherRole = "admin" | "accountant";

export type ResearcherCredentials = {
    email: string;
    password: string;
    loginAs: ResearcherRole;
};

type ProvisionResponse = {
    ok?: boolean;
    error?: string;
    credentials?: Partial<ResearcherCredentials>;
};

async function readFunctionError(error: unknown, payload: unknown): Promise<string | null> {
    const responseMessage = (payload as ProvisionResponse | null)?.error;
    if (typeof responseMessage === "string" && responseMessage.trim()) return responseMessage;

    const context = (error as { context?: unknown } | null)?.context;
    if (!(context instanceof Response)) return null;

    try {
        const responsePayload = await context.clone().json() as ProvisionResponse;
        return typeof responsePayload.error === "string" ? responsePayload.error : null;
    } catch {
        return null;
    }
}

export function parseResearcherCredentials(payload: unknown): ResearcherCredentials {
    const response = payload as ProvisionResponse | null;
    const credentials = response?.credentials;
    if (
        response?.ok !== true
        || typeof credentials?.email !== "string"
        || typeof credentials.password !== "string"
        || (credentials.loginAs !== "admin" && credentials.loginAs !== "accountant")
    ) {
        throw new Error(response?.error || "The server returned invalid researcher credentials.");
    }

    return {
        email: credentials.email,
        password: credentials.password,
        loginAs: credentials.loginAs,
    };
}

export async function createResearcherAccount(role: ResearcherRole): Promise<ResearcherCredentials> {
    const { data, error } = await supabase.functions.invoke("create-researcher-account", {
        body: { role },
    });

    if (error) {
        const message = await readFunctionError(error, data);
        throw new Error(message || "Could not create a researcher account. Please try again later.");
    }

    return parseResearcherCredentials(data);
}
