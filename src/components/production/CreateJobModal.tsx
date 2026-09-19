import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

interface CreateJobModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (job: { item: string, operator: string, priority: "High" | "Normal" }) => void;
}

export function CreateJobModal({ open, onOpenChange, onSubmit }: CreateJobModalProps) {
    const [item, setItem] = useState("Enamel 18 SWG");
    const [operator, setOperator] = useState("Ali");
    const [priority, setPriority] = useState<"High" | "Normal">("Normal");

    const handleSubmit = () => {
        onSubmit({ item, operator, priority });
        onOpenChange(false);
        // Reset default
        setPriority("Normal");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create Production Job</DialogTitle>
                    <DialogDescription>
                        Add a new batch to the Enamel Queue.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Item</Label>
                        <Select value={item} onValueChange={setItem}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Item" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Enamel 18 SWG">Enamel 18 SWG</SelectItem>
                                <SelectItem value="Enamel 20 SWG">Enamel 20 SWG</SelectItem>
                                <SelectItem value="Enamel 22 SWG">Enamel 22 SWG</SelectItem>
                                <SelectItem value="Enamel 24 SWG">Enamel 24 SWG</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label>Operator</Label>
                        <Input
                            value={operator}
                            onChange={(e) => setOperator(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Priority</Label>
                        <Select value={priority} onValueChange={(v) => setPriority(v as "High" | "Normal")}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Normal">Normal</SelectItem>
                                <SelectItem value="High">High</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700">Add to Queue</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
