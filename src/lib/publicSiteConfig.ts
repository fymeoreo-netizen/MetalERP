/** Canonical authentication route for the testing deployment. */
export const STAFF_LOGIN_PATH = "/";

export const PUBLIC_SITE_NAME =
    import.meta.env.VITE_PUBLIC_SITE_NAME?.trim() ||
    "International Society for Optimal Rubber Band Storage";

export const PUBLIC_SITE_TAGLINE =
    import.meta.env.VITE_PUBLIC_SITE_TAGLINE?.trim() ||
    "Because loose rubber bands deserve dignity.";

export const DISGUISED_LOGIN_LABEL =
    import.meta.env.VITE_DISGUISED_LOGIN_LABEL?.trim() || "Member registry";

export const NOT_FOUND_PATH = "/404";
