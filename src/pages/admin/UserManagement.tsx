import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Plus, Shield, Key, UserCheck, Lock, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AddUserModal } from "@/components/admin/AddUserModal";
import { EditUserModal } from "@/components/admin/EditUserModal";
import { TabsScroller, TableScroller } from "@/components/ui/responsive-primitives";
import { listManagedUsers, type ManagedUser } from "@/lib/userAdmin";
import { useAppSession } from "@/contexts/AppSessionContext";
import { fetchTransactionHistory, formatAuditAction, type TransactionHistoryRow } from "@/lib/repositories/auditRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { format } from "date-fns";

export default function UserManagement() {
    const [isAddUserOpen, setIsAddUserOpen] = useState(false);
    const [isEditUserOpen, setIsEditUserOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
    const [search, setSearch] = useState("");
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [activityLogs, setActivityLogs] = useState<TransactionHistoryRow[]>([]);
    const [activityUserId, setActivityUserId] = useState<string>("all");
    const [activityLoading, setActivityLoading] = useState(false);
    const { isAdmin } = useAppSession();

    const loadUsers = async () => {
        setLoading(true);
        const rows = await listManagedUsers();
        setUsers(rows);
        setLoading(false);
    };

    useEffect(() => {
        if (isAdmin) {
            void loadUsers();
        }
    }, [isAdmin]);

    const loadActivityLogs = async (actorId?: string) => {
        if (!isErpLiveMode()) {
            setActivityLogs([]);
            return;
        }
        setActivityLoading(true);
        try {
            const rows = await fetchTransactionHistory({
                actorId: actorId && actorId !== "all" ? actorId : undefined,
                limit: 50,
            });
            setActivityLogs(rows);
        } finally {
            setActivityLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) {
            void loadActivityLogs(activityUserId);
        }
    }, [isAdmin, activityUserId]);

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return users;
        return users.filter((u) => {
            const name = (u.displayName ?? "").toLowerCase();
            const email = (u.email ?? "").toLowerCase();
            const role = u.role.toLowerCase();
            return name.includes(q) || email.includes(q) || role.includes(q);
        });
    }, [users, search]);

    if (!isAdmin) {
        return (
            <DashboardLayout>
                <Card className="shadow-soft border-slate-100">
                    <CardHeader>
                        <CardTitle>Admin Access Required</CardTitle>
                        <CardDescription>Only admin users can manage system users.</CardDescription>
                    </CardHeader>
                </Card>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Administration & Security</h1>
                        <p className="text-slate-500">Manage users, roles, and system security.</p>
                    </div>
                    <Button onClick={() => setIsAddUserOpen(true)} className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto">
                        <Plus className="h-4 w-4 mr-2" />
                        Add New User
                    </Button>
                </div>

                <AddUserModal open={isAddUserOpen} onOpenChange={setIsAddUserOpen} onCreated={() => void loadUsers()} />
                <EditUserModal
                    open={isEditUserOpen}
                    onOpenChange={setIsEditUserOpen}
                    user={editingUser}
                    onUpdated={() => void loadUsers()}
                />

                <Tabs defaultValue="users" className="space-y-4">
                    <TabsScroller>
                        <TabsList className="bg-slate-100 p-1">
                            <TabsTrigger value="users" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">User Management</TabsTrigger>
                            <TabsTrigger value="roles" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Role Permissions</TabsTrigger>
                            <TabsTrigger value="logs" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Activity Logs</TabsTrigger>
                        </TabsList>
                    </TabsScroller>

                    <TabsContent value="users" className="space-y-4">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <CardTitle>System Users</CardTitle>
                                        <CardDescription>Manage access and credentials.</CardDescription>
                                    </div>
                                    <div className="relative w-full sm:w-auto">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                                        <Input
                                            className="pl-9 w-full sm:w-[250px]"
                                            placeholder="Search users..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <TableScroller>
                                <Table noWrapper className="min-w-[820px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>User</TableHead>
                                            <TableHead>Role</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Access</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loading && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center text-slate-500 py-8">Loading users...</TableCell>
                                            </TableRow>
                                        )}
                                        {!loading && filteredUsers.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center text-slate-500 py-8">No users found.</TableCell>
                                            </TableRow>
                                        )}
                                        {!loading && filteredUsers.map((user) => (
                                            <TableRow key={user.userId}>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-medium">
                                                            {(user.displayName ?? user.email ?? "U").charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-slate-900">{user.displayName ?? "Unnamed user"}</p>
                                                            <p className="text-xs text-slate-500">{user.email ?? "No email"}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                                                        {user.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={user.isActive ? "default" : "destructive"}
                                                        className={user.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-rose-100 text-rose-700 hover:bg-rose-100"}
                                                    >
                                                        {user.isActive ? "Active" : "Inactive"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-slate-500">{user.canPost ? "Can post" : "Read only"}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 gap-1.5"
                                                        onClick={() => {
                                                            setEditingUser(user);
                                                            setIsEditUserOpen(true);
                                                        }}
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                        Edit
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </TableScroller>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="roles" className="space-y-4">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Permission Matrix</CardTitle>
                                <CardDescription>Configure access levels for each role.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <TableScroller>
                                <Table noWrapper className="min-w-[720px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Module</TableHead>
                                            <TableHead>Super Admin</TableHead>
                                            <TableHead>Accountant</TableHead>
                                            <TableHead>Gatekeeper</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {["Procurement", "Production", "Financials", "Settings"].map((module) => (
                                            <TableRow key={module}>
                                                <TableCell className="font-medium">{module}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1 text-emerald-600">
                                                        <Shield className="h-4 w-4" /> Full Access
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {module === "Settings" ? (
                                                        <div className="flex items-center gap-1 text-rose-500">
                                                            <Lock className="h-4 w-4" /> No Access
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1 text-blue-600">
                                                            <UserCheck className="h-4 w-4" /> Edit
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {module === "Procurement" ? (
                                                        <div className="flex items-center gap-1 text-blue-600">
                                                            <UserCheck className="h-4 w-4" /> Create Only
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1 text-rose-500">
                                                            <Lock className="h-4 w-4" /> No Access
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </TableScroller>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="logs" className="space-y-4">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>User Activity</CardTitle>
                                <CardDescription>Recent system actions from the audit trail (create, edit, post, delete).</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="mb-4 max-w-xs">
                                    <select
                                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                                        value={activityUserId}
                                        onChange={(e) => setActivityUserId(e.target.value)}
                                    >
                                        <option value="all">All users</option>
                                        {users.map((u) => (
                                            <option key={u.userId} value={u.userId}>
                                                {u.displayName ?? u.email ?? u.userId.slice(0, 8)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-3">
                                    {activityLoading && (
                                        <p className="text-sm text-slate-500">Loading activity…</p>
                                    )}
                                    {!activityLoading && activityLogs.length === 0 && (
                                        <p className="text-sm text-slate-500">No activity recorded yet. Run migration 57 in Supabase to enable audit logging.</p>
                                    )}
                                    {activityLogs.map((log) => (
                                        <div key={log.id} className="flex items-start justify-between pb-3 border-b border-slate-100 last:border-0 last:pb-0">
                                            <div className="flex items-start gap-3 min-w-0">
                                                <div className="mt-1 p-2 rounded-full bg-slate-100 text-slate-500 shrink-0">
                                                    <Key className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-slate-900 truncate">
                                                        {formatAuditAction(log.action)}
                                                        {log.sourceDocNo ? ` · ${log.sourceDocNo}` : ""}
                                                    </p>
                                                    <p className="text-xs text-slate-500 truncate">
                                                        {log.actorDisplayName} · {log.entityType.replace(/_/g, " ")}
                                                    </p>
                                                    {log.summary && (
                                                        <p className="text-xs text-slate-400 truncate mt-0.5">{log.summary}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-xs text-slate-400 whitespace-nowrap ml-2">
                                                {log.eventAt ? format(new Date(log.eventAt), "dd-MMM-yy HH:mm") : "—"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
