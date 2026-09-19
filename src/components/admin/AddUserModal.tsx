import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { createManagedUser, type AppRoleCode } from "@/lib/userAdmin";
import { useToast } from "@/components/ui/use-toast";

interface AddUserModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}

export function AddUserModal({ open, onOpenChange, onCreated }: AddUserModalProps) {
    const { toast } = useToast();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<AppRoleCode>("ACCOUNTANT");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!name.trim() || !email.trim() || password.length < 6) {
            toast({
                title: "Missing details",
                description: "Name, email, and password (min 6 chars) are required.",
                variant: "destructive",
            });
            return;
        }
        setIsSubmitting(true);
        const result = await createManagedUser({
            displayName: name,
            email,
            password,
            role,
        });
        setIsSubmitting(false);
        if (!result.ok) {
            toast({
                title: "Could not create user",
                description: result.error,
                variant: "destructive",
            });
            return;
        }
        toast({ title: "User created", description: `${email} (${role}) can log in immediately — no email verification required.` });
        onOpenChange(false);
        onCreated();
        setName("");
        setEmail("");
        setPassword("");
        setRole("ACCOUNTANT");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add New User</DialogTitle>
                    <DialogDescription>
                        Create a new account for system access.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">
                            Name
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Full Name"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">
                            Email
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="user@coppersync.com"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="role">
                            Role
                        </Label>
                        <Select value={role} onValueChange={(v) => setRole(v as AppRoleCode)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                                <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="password">
                            Temporary Password
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="At least 6 characters"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => void handleSubmit()} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
                        {isSubmitting ? "Creating..." : "Create User"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
