import { useCallback, useState } from "react";

export type FormSubmitAction = "draft" | "post" | "submit";

/** Tracks whether the user tried to save/post so validation UI only appears after an attempt. */
export function useFormValidationGate() {
    const [attemptedAction, setAttemptedAction] = useState<FormSubmitAction | null>(null);

    const markAttempted = useCallback((action: FormSubmitAction) => {
        setAttemptedAction(action);
    }, []);

    const resetValidation = useCallback(() => {
        setAttemptedAction(null);
    }, []);

    return {
        attemptedAction,
        markAttempted,
        resetValidation,
        showValidation: attemptedAction !== null,
    };
}
