/** Shared scrollbar styling for ERP scroll regions (tables, tabs, panels, modals). */
export const erpScrollbarClass =
    "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400/75 [&::-webkit-scrollbar-thumb]:min-h-[28px] [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-zinc-100/90";

/** @deprecated Use erpScrollbarClass */
export const thinScrollbarClass = erpScrollbarClass;
