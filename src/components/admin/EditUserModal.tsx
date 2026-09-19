import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { updateManagedUser, type AppRoleCode, type ManagedUser } from "@/lib/userAdmin";
import { useToast } from "@/components/ui/use-toast";

interface EditUserModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user: ManagedUser | null;
    onUpdated: () => void;
}

export function EditUserModal({ open, onOpenChange, user, onUpdated }: EditUserModalProps) {
    const { toast } = useToast();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<AppRoleCode>("ACCOUNTANT");
    const [isActive, setIsActive] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!user || !open) return;
        setName(user.displayName ?? "");
        setEmail(user.email ?? "");
        setPassword("");
        setRole(user.role === "UNASSIGNED" ? "ACCOUNTANT" : user.role);
        setIsActive(user.isActive);
    }, [user, open]);

    const handleSubmit = async () => {
        if (!user) return;
        if (!name.trim() || !email.trim()) {
            toast({
                title: "Missing details",
                description: "Name and email are required.",
                variant: "destructive",
            });
            return;
        }
        if (password && password.length < 6) {
            toast({
                title: "Invalid password",
                description: "New password must be at least 6 characters, or leave blank to keep current.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);
        const result = await updateManagedUser({
            userId: user.userId,
            displayName: name,
            email,
            role,
            isActive,
            password: password || undefined,
        });
        setIsSubmitting(false);

        if (!result.ok) {
            toast({
                title: "Could not update user",
                description: result.error,
                variant: "destructive",
            });
            return;
        }

        toast({ title: "User updated", description: `${email} has been saved.` });
        onOpenChange(false);
        onUpdated();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit User</DialogTitle>
                    <DialogDescription>Update account details, role, and access status.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="edit-name">Name</Label>
                        <Input
                            id="edit-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Full Name"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit-email">Email</Label>
                        <Input
                            id="edit-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="user@coppersync.com"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit-role">Role</Label>
                        <Select value={role} onValueChange={(v) => setRole(v as AppRoleCode)}>
                            <SelectTrigger id="edit-role">
                                <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                                <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
                        <div>
                            <Label htmlFor="edit-active" className="text-sm">Active account</Label>
                            <p className="text-xs text-slate-500">Inactive users cannot sign in.</p>
                        </div>
                        <Switch id="edit-active" checked={isActive} onCheckedChange={(checked) => setIsActive(checked === true)} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit-password">New password (optional)</Label>
                        <Input
                            id="edit-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Leave blank to keep current password"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => void handleSubmit()} disabled={isSubmitting || !user} className="bg-blue-600 hover:bg-blue-700">
                        {isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
