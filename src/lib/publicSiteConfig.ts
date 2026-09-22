/** Canonical authentication route for the testing deployment. */
export const STAFF_LOGIN_PATH = "/";

export const PUBLIC_SITE_NAME =
    import.meta.env.VITE_PUBLIC_SITE_NAME?.trim() ||
    "MetalERP Security Testing";

export const PUBLIC_SITE_TAGLINE =
    import.meta.env.VITE_PUBLIC_SITE_TAGLINE?.trim() ||
    "Isolated ERP security testing environment.";

export const DISGUISED_LOGIN_LABEL =
    import.meta.env.VITE_DISGUISED_LOGIN_LABEL?.trim() || "MetalERP";

export const NOT_FOUND_PATH = "/404";
