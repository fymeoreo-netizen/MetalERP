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
        const message = (data as ProvisionResponse | null)?.error;
        throw new Error(message || "Could not create a researcher account. Please try again later.");
    }

    return parseResearcherCredentials(data);
}
