import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

interface CreateRuleModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: any) => void;
}

export function CreateRuleModal({ open, onOpenChange, onSubmit }: CreateRuleModalProps) {
    const [name, setName] = useState("");
    const [metric, setMetric] = useState("wastage");
    const [condition, setCondition] = useState("greater_than");
    const [threshold, setThreshold] = useState("");
    const [severity, setSeverity] = useState("warning");

    const handleSubmit = () => {
        onSubmit({
            name,
            metric,
            condition,
            threshold,
            severity,
            status: "active"
        });
        onOpenChange(false);
        // Reset
        setName("");
        setThreshold("");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create New Alert Rule</DialogTitle>
                    <DialogDescription>
                        Define conditions to trigger system alerts.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Rule Name</Label>
                        <Input
                            placeholder="e.g. High Wastage Alert"
                            value={name} onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Metric</Label>
                        <Select value={metric} onValueChange={setMetric}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="wastage">Production Wastage %</SelectItem>
                                <SelectItem value="stock">Stock Level (Low)</SelectItem>
                                <SelectItem value="credit">Customer Credit Limit</SelectItem>
                                <SelectItem value="parchi">Parchi Due Date</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label>Condition</Label>
                        <div className="flex gap-2">
                            <Select value={condition} onValueChange={setCondition}>
                                <SelectTrigger className="w-[140px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="greater_than">Greater Than (&gt;)</SelectItem>
                                    <SelectItem value="less_than">Less Than (&lt;)</SelectItem>
                                    <SelectItem value="equal">Equals (=)</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input
                                className="flex-1"
                                type="number"
                                placeholder="Value"
                                value={threshold} onChange={(e) => setThreshold(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label>Severity</Label>
                        <Select value={severity} onValueChange={setSeverity}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="info">Info (Blue)</SelectItem>
                                <SelectItem value="warning">Warning (Yellow)</SelectItem>
                                <SelectItem value="critical">Critical (Red)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700">Create Rule</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
