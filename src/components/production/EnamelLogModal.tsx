import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Beaker, CheckCircle, AlertTriangle, XCircle, Disc } from "lucide-react";
import { useState } from "react";

interface EnamelLogModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobId: string;
    onSubmit: (data: any) => void;
}

export function EnamelLogModal({ open, onOpenChange, jobId, onSubmit }: EnamelLogModalProps) {
    const [grossWeight, setGrossWeight] = useState("");
    const [tareWeight, setTareWeight] = useState("");
    const [drums, setDrums] = useState(0);
    const [quality, setQuality] = useState("Pass");

    const handleSubmit = () => {
        onSubmit({
            jobId,
            grossWeight,
            tareWeight,
            netWeight: Number(grossWeight) - Number(tareWeight),
            drums,
            quality
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Finish Enamel Job</DialogTitle>
                    <DialogDescription>
                        Record production details for Job <span className="font-mono font-bold text-slate-900">{jobId}</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    {/* Weight Section */}
                    <div className="space-y-3 p-3 bg-slate-50 border rounded-lg">
                        <Label className="font-semibold text-slate-700 flex items-center gap-2">
                            <Disc className="h-4 w-4" /> Output Weight
                        </Label>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label className="text-xs">Gross (with Spool)</Label>
                                <Input
                                    type="number"
                                    placeholder="0.00"
                                    value={grossWeight}
                                    onChange={(e) => setGrossWeight(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Spool Tare</Label>
                                <Input
                                    type="number"
                                    placeholder="0.00"
                                    value={tareWeight}
                                    onChange={(e) => setTareWeight(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                            <span className="text-sm text-slate-500">Net Wire Weight</span>
                            <span className="font-mono font-bold text-slate-900">
                                {(Number(grossWeight) - Number(tareWeight)).toFixed(2)} kg
                            </span>
                        </div>
                    </div>

                    {/* Chemicals */}
                    <div className="space-y-3">
                        <Label className="font-semibold text-slate-700 flex items-center gap-2">
                            <Beaker className="h-4 w-4" /> Chemical Drums Consumed
                        </Label>
                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((num) => (
                                <div
                                    key={num}
                                    onClick={() => setDrums(num)}
                                    className={`cursor-pointer w-8 h-10 rounded-md border flex items-end justify-center pb-1 text-xs font-bold transition-all ${drums >= num ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-slate-100 border-slate-200 text-slate-400 hover:border-indigo-300'}`}
                                >
                                    {num}
                                </div>
                            ))}
                            <div
                                onClick={() => setDrums(0)}
                                className="cursor-pointer px-2 py-1 flex items-center text-xs text-slate-500 hover:text-slate-700"
                            >
                                Reset
                            </div>
                        </div>
                    </div>

                    {/* Quality */}
                    <div className="space-y-3">
                        <Label className="font-semibold text-slate-700">Quality Check</Label>
                        <div className="grid grid-cols-3 gap-2">
                            <div
                                onClick={() => setQuality("Pass")}
                                className={`cursor-pointer rounded-lg border p-2 flex flex-col items-center gap-1 text-sm font-medium transition-all ${quality === 'Pass' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 ring-1 ring-emerald-500' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                <CheckCircle className={`h-5 w-5 ${quality === 'Pass' ? 'text-emerald-600' : 'text-slate-400'}`} />
                                Pass
                            </div>
                            <div
                                onClick={() => setQuality("Hold")}
                                className={`cursor-pointer rounded-lg border p-2 flex flex-col items-center gap-1 text-sm font-medium transition-all ${quality === 'Hold' ? 'bg-amber-50 border-amber-500 text-amber-700 ring-1 ring-amber-500' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                <AlertTriangle className={`h-5 w-5 ${quality === 'Hold' ? 'text-amber-600' : 'text-slate-400'}`} />
                                Hold
                            </div>
                            <div
                                onClick={() => setQuality("Fail")}
                                className={`cursor-pointer rounded-lg border p-2 flex flex-col items-center gap-1 text-sm font-medium transition-all ${quality === 'Fail' ? 'bg-rose-50 border-rose-500 text-rose-700 ring-1 ring-rose-500' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                <XCircle className={`h-5 w-5 ${quality === 'Fail' ? 'text-rose-600' : 'text-slate-400'}`} />
                                Fail
                            </div>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">Submit Production Log</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
