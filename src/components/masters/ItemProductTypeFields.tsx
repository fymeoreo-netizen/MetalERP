import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    ENAMEL_COLORS,
    ENAMEL_GAUGES,
    GOAT_ENAMEL_WEIGHTS,
    GOAT_PRODUCTS,
    MACHINE_SCRAP_DEPARTMENTS,
    type ItemFormState,
} from "@/lib/itemFormSchema";
import type { ItemFormTemplate } from "@/lib/itemProductTypes";
import type { ReactNode } from "react";

const fieldGrid = "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 items-start";

function FormField({
    label,
    labelExtra,
    hint,
    className,
    children,
}: {
    label: string;
    labelExtra?: ReactNode;
    hint?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={`grid gap-2 ${className ?? ""}`}>
            <div className="flex items-center justify-between gap-2 min-h-5">
                <Label>{label}</Label>
                {labelExtra}
            </div>
            {hint ? <p className="text-xs text-slate-500 -mt-1">{hint}</p> : null}
            {children}
        </div>
    );
}

type Props = {
    template: ItemFormTemplate;
    form: ItemFormState;
    onPatch: (partial: Partial<ItemFormState>) => void;
};

export function ItemProductTypeFields({ template, form, onPatch }: Props) {
    switch (template) {
        case "enamel_gauge_color":
            return (
                <div className={fieldGrid}>
                    <FormField label="Enamel color">
                        <Select
                            value={form.enamelColor}
                            onValueChange={(v) => onPatch({ enamelColor: v as ItemFormState["enamelColor"] })}
                        >
                            <SelectTrigger className="h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ENAMEL_COLORS.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {c}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label="Gauge (SWG)">
                        {!form.enamelGaugeIsCustom ? (
                            <Select
                                value={form.enamelGaugePreset}
                                onValueChange={(v) => onPatch({ enamelGaugePreset: v })}
                            >
                                <SelectTrigger className="h-10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-56">
                                    {ENAMEL_GAUGES.map((g) => (
                                        <SelectItem key={g} value={String(g)}>
                                            SWG {g}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input
                                className="h-10"
                                value={form.enamelGaugeCustom}
                                onChange={(e) => onPatch({ enamelGaugeCustom: e.target.value })}
                                placeholder="Custom gauge e.g. 19.5 SWG"
                            />
                        )}
                        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                            <Checkbox
                                checked={form.enamelGaugeIsCustom}
                                onCheckedChange={(c) => onPatch({ enamelGaugeIsCustom: c === true })}
                            />
                            Use custom gauge
                        </label>
                    </FormField>
                    <FormField
                        label="Custom display name (optional)"
                        hint="Leave blank to auto-generate from gauge and color"
                        className="sm:col-span-2"
                    >
                        <Input
                            className="h-10"
                            value={form.enamelCustomName}
                            onChange={(e) => onPatch({ enamelCustomName: e.target.value })}
                            placeholder="e.g. Special export grade SWG 22"
                        />
                    </FormField>
                </div>
            );
        case "strip_dimensions":
            return (
                <div className={fieldGrid}>
                    <FormField label="Strip dimensions" className="sm:col-span-2">
                        <Input
                            className="h-10"
                            value={form.stripSize}
                            onChange={(e) => onPatch({ stripSize: e.target.value })}
                            placeholder="e.g. 8 mm × 2 mm"
                        />
                    </FormField>
                </div>
            );
        case "free_text":
            return (
                <div className={fieldGrid}>
                    <FormField label="Name">
                        <Input
                            className="h-10"
                            value={form.freeTextName}
                            onChange={(e) => onPatch({ freeTextName: e.target.value })}
                            placeholder="Item name"
                        />
                    </FormField>
                    <FormField label="Specification">
                        <Input
                            className="h-10"
                            value={form.freeTextSpec}
                            onChange={(e) => onPatch({ freeTextSpec: e.target.value })}
                            placeholder="Size / grade / notes"
                        />
                    </FormField>
                </div>
            );
        case "machine_scrap":
            return (
                <div className={fieldGrid}>
                    <FormField label="Department">
                        <Select
                            value={form.machineScrapDepartment}
                            onValueChange={(v) =>
                                onPatch({ machineScrapDepartment: v as ItemFormState["machineScrapDepartment"] })
                            }
                        >
                            <SelectTrigger className="h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MACHINE_SCRAP_DEPARTMENTS.map((d) => (
                                    <SelectItem key={d} value={d}>
                                        {d}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label="Machine / label (optional)">
                        <Input
                            className="h-10"
                            value={form.machineScrapLabel}
                            onChange={(e) => onPatch({ machineScrapLabel: e.target.value })}
                            placeholder="e.g. D3, E1, WS1"
                        />
                    </FormField>
                </div>
            );
        case "goat_packing":
            return (
                <div className={fieldGrid}>
                    <FormField label="For product">
                        <Select
                            value={form.goatProduct}
                            onValueChange={(v) => onPatch({ goatProduct: v as ItemFormState["goatProduct"] })}
                        >
                            <SelectTrigger className="h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {GOAT_PRODUCTS.map((p) => (
                                    <SelectItem key={p} value={p}>
                                        {p}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    {form.goatProduct === "Enamel Wire" ? (
                        <>
                            <FormField label="Goat weight">
                                <Select
                                    value={form.goatEnamelWeight}
                                    onValueChange={(v) =>
                                        onPatch({ goatEnamelWeight: v as ItemFormState["goatEnamelWeight"] })
                                    }
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {GOAT_ENAMEL_WEIGHTS.map((w) => (
                                            <SelectItem key={w} value={w}>
                                                {w}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormField>
                            {form.goatEnamelWeight === "Custom" && (
                                <FormField label="Custom weight">
                                    <Input
                                        className="h-10"
                                        value={form.goatCustomWeight}
                                        onChange={(e) => onPatch({ goatCustomWeight: e.target.value })}
                                        placeholder="e.g. 7 kg"
                                    />
                                </FormField>
                            )}
                        </>
                    ) : (
                        <FormField label="Strip goat size" className="sm:col-span-2">
                            <Input
                                className="h-10"
                                value={form.goatStripSize}
                                onChange={(e) => onPatch({ goatStripSize: e.target.value })}
                                placeholder="Custom dimensions for strip goat"
                            />
                        </FormField>
                    )}
                </div>
            );
        case "packing_spec":
            return (
                <div className={fieldGrid}>
                    <FormField label="Specification (optional)" className="sm:col-span-2">
                        <Input
                            className="h-10"
                            value={form.packingSpec}
                            onChange={(e) => onPatch({ packingSpec: e.target.value })}
                            placeholder="e.g. 0.25 mm, brand, size"
                        />
                    </FormField>
                </div>
            );
        case "varnish_drum":
            return (
                <div className={fieldGrid}>
                    <FormField label="Varnish colour">
                        <Select
                            value={form.varnishColor}
                            onValueChange={(v) => onPatch({ varnishColor: v as ItemFormState["varnishColor"] })}
                        >
                            <SelectTrigger className="h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ENAMEL_COLORS.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {c}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label="Drum net weight (kg)">
                        <Input
                            className="h-10 font-mono"
                            type="number"
                            value={form.varnishDrumWeightKg}
                            onChange={(e) => onPatch({ varnishDrumWeightKg: e.target.value })}
                            placeholder="e.g. 180"
                        />
                    </FormField>
                    <FormField label="Drum spec (optional)" className="sm:col-span-2">
                        <Input
                            className="h-10"
                            value={form.chemicalCustomSpec}
                            onChange={(e) => onPatch({ chemicalCustomSpec: e.target.value })}
                            placeholder="e.g. supplier batch"
                        />
                    </FormField>
                </div>
            );
        case "none":
        default:
            return (
                <p className="text-sm text-slate-500">
                    No additional fields — name is set from the product type label.
                </p>
            );
    }
}
