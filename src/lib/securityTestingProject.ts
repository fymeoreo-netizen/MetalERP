export const SECURITY_TEST_PROJECT_REF = "fwocbgmydsgjodxzithe";
export const SECURITY_TEST_HOSTNAME = `${SECURITY_TEST_PROJECT_REF}.supabase.co`;

export function assertSecurityTestingProject(url: string, keyProjectRef: string | null): void {
    let configuredUrl: URL;
    try {
        configuredUrl = new URL(url);
    } catch {
        throw new Error("Supabase URL is invalid for the security-testing environment.");
    }

    if (configuredUrl.protocol !== "https:" || configuredUrl.hostname.toLowerCase() !== SECURITY_TEST_HOSTNAME) {
        throw new Error("This build can connect only to the isolated MetalERP security-testing project.");
    }

    if (keyProjectRef && keyProjectRef !== SECURITY_TEST_PROJECT_REF) {
        throw new Error("The Supabase key does not belong to the MetalERP security-testing project.");
    }
}
