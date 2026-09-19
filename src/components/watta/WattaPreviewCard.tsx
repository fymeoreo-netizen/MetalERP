import { useMemo, useState } from "react";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FieldGroup, invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import { resolveWatta } from "@/lib/repositories/wattaRepo";
import { itemCatalog } from "@/lib/itemCatalog";
import { isErpLiveMode } from "@/lib/backendFlags";
import { FlaskConical } from "lucide-react";

type Props = {
    direction: "sales" | "purchase";
    parties: { id: string; code?: string; name: string }[];
};

function sampleItems(direction: "sales" | "purchase") {
    if (direction === "sales") {
        return itemCatalog.filter((i) => i.category === "Enameled" || /enameled/i.test(i.name)).slice(0, 8);
    }
    return itemCatalog.filter(
        (i) => i.code.startsWith("RM-W8") || i.code.startsWith("RM-CR") || /wire no 8|rod/i.test(i.name),
    );
}

export function WattaPreviewCard({ direction, parties }: Props) {
    const items = sampleItems(direction);
    const [partyCode, setPartyCode] = useState("");
    const [itemCode, setItemCode] = useState(items[0]?.code ?? "");
    const [resolved, setResolved] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const partyOptions = useMemo(
        () => toPartyComboboxOptions(parties.map((p) => ({ id: p.code ?? p.id, name: p.name }))),
        [parties],
    );

    const runPreview = async () => {
        if (!isErpLiveMode()) {
            setResolved(null);
            return;
        }
        setLoading(true);
        try {
            const w = await resolveWatta({
                partyCode: partyCode || null,
                itemCode,
                direction,
            });
            setResolved(w);
        } catch {
            setResolved(0);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="shadow-soft border-slate-100 bg-white">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-zinc-500" />
                    <CardTitle className="text-base">Resolve preview</CardTitle>
                </div>
                <CardDescription>
                    Test what <code className="text-xs">resolve_watta</code> returns for a party + item (live mode only).
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
                <FieldGroup label="Party">
                    <PartyCombobox
                        value={partyCode || "__default"}
                        onValueChange={(v) => setPartyCode(v === "__default" ? "" : v)}
                        options={partyOptions}
                        placeholder="Default"
                        leadingOptions={[{ value: "__default", label: "Default" }]}
                        triggerClassName={invoiceInputClass}
                    />
                </FieldGroup>
                <FieldGroup label="Sample item">
                    <Select value={itemCode} onValueChange={setItemCode}>
                        <SelectTrigger className={invoiceInputClass}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {items.map((i) => (
                                <SelectItem key={i.code} value={i.code}>
                                    {i.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FieldGroup>
                <div className="flex items-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => void runPreview()} disabled={loading || !isErpLiveMode()}>
                        {loading ? "…" : "Test"}
                    </Button>
                    {resolved != null && isErpLiveMode() ? (
                        <span className="text-sm font-semibold text-zinc-900 tabular-nums pb-2">
                            Watta: {resolved.toLocaleString()} PKR/kg
                        </span>
                    ) : !isErpLiveMode() ? (
                        <span className="text-xs text-zinc-400 pb-2">Connect Supabase to preview</span>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}
