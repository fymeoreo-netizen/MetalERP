import { useCallback, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
    formatLetterheadContactLine,
    getDefaultPartyDocumentLetterhead,
    loadPartyDocumentLetterhead,
    savePartyDocumentLetterhead,
    type PartyDocumentLetterhead,
} from "@/lib/partyDocumentLetterhead";

type PartyDocumentLetterheadBlockProps = {
    letterhead: PartyDocumentLetterhead;
    onChange: (letterhead: PartyDocumentLetterhead) => void;
    className?: string;
    previewClassName?: string;
};

export function usePartyDocumentLetterhead() {
    const [letterhead, setLetterhead] = useState(loadPartyDocumentLetterhead);

    const updateLetterhead = useCallback((patch: Partial<PartyDocumentLetterhead>) => {
        setLetterhead((prev) => {
            const next = { ...prev, ...patch };
            savePartyDocumentLetterhead(next);
            return next;
        });
    }, []);

    const resetLetterhead = useCallback(() => {
        const defaults = getDefaultPartyDocumentLetterhead();
        savePartyDocumentLetterhead(defaults);
        setLetterhead(defaults);
    }, []);

    const replaceLetterhead = useCallback((next: PartyDocumentLetterhead) => {
        savePartyDocumentLetterhead(next);
        setLetterhead(next);
    }, []);

    return { letterhead, updateLetterhead, resetLetterhead, replaceLetterhead, setLetterhead };
}

export function PartyDocumentLetterheadPreview({
    letterhead,
    className,
}: {
    letterhead: PartyDocumentLetterhead;
    className?: string;
}) {
    const contact = formatLetterheadContactLine(letterhead);
    return (
        <div className={className}>
            <h1 className="text-xl font-bold text-slate-900">{letterhead.name || "—"}</h1>
            <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">
                {letterhead.addressLine || "—"}
                {contact ? (
                    <>
                        {"\n"}
                        {contact}
                    </>
                ) : null}
            </p>
        </div>
    );
}

export function PartyDocumentLetterheadEditor({
    letterhead,
    onChange,
    className,
}: {
    letterhead: PartyDocumentLetterhead;
    onChange: (letterhead: PartyDocumentLetterhead) => void;
    className?: string;
}) {
    const [open, setOpen] = useState(false);

    const patch = (key: keyof PartyDocumentLetterhead, value: string) => {
        onChange({ ...letterhead, [key]: value });
    };

    const reset = () => {
        onChange(getDefaultPartyDocumentLetterhead());
    };

    return (
        <div className={cn("rounded-lg border border-slate-200 bg-slate-50/80", className)}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100/80"
            >
                <span>Edit company header</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
                <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                    <div className="space-y-1">
                        <Label className="text-xs">Company name</Label>
                        <Input
                            value={letterhead.name}
                            onChange={(e) => patch("name", e.target.value)}
                            className="h-9 bg-white"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Address</Label>
                        <Input
                            value={letterhead.addressLine}
                            onChange={(e) => patch("addressLine", e.target.value)}
                            className="h-9 bg-white"
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Phone</Label>
                            <Input
                                value={letterhead.phone}
                                onChange={(e) => patch("phone", e.target.value)}
                                className="h-9 bg-white"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">NTN</Label>
                            <Input
                                value={letterhead.ntn}
                                onChange={(e) => patch("ntn", e.target.value)}
                                className="h-9 bg-white"
                            />
                        </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={reset}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Reset to default
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

export function PartyDocumentLetterheadBlock({
    letterhead,
    onChange,
    className,
    previewClassName,
}: PartyDocumentLetterheadBlockProps) {
    return (
        <div className={cn("space-y-3", className)}>
            <PartyDocumentLetterheadEditor letterhead={letterhead} onChange={onChange} />
            <PartyDocumentLetterheadPreview letterhead={letterhead} className={previewClassName} />
        </div>
    );
}
