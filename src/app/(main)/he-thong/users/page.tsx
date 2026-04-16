"use client";

/**
 * User Management Page — List users, assign roles, activate/deactivate.
 */

import { useState, useEffect, useCallback } from "react";
import {
  UserCog,
  Shield,
  Loader2,
  MoreHorizontal,
  UserPlus,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth, useToast } from "@/lib/contexts";
import {
  getRoles,
  getTenantUsers,
  assignRoleToUser,
} from "@/lib/services/supabase/roles";
import type { DbRole } from "@/lib/services/supabase/roles";
import { getClient } from "@/lib/services/supabase/base";

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  roleId: string | null;
  roleName: string | null;
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const { tenant, branches } = useAuth();
  const { toast } = useToast();
  const tenantId = tenant?.id ?? "";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<DbRole[]>([]);
  const [loading, setLoading] = useState(true);

  // Role assign dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        getTenantUsers(tenantId),
        getRoles(tenantId),
      ]);
      setUsers(u);
      setRoles(r);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const handleAssignRole = async () => {
    if (!selectedUser) return;
    try {
      await assignRoleToUser(selectedUser.id, selectedRoleId || null);
      toast({ title: "Đã cập nhật vai trò", variant: "success" });
      setAssignOpen(false);
      load();
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "error" });
    }
  };

  const handleToggleActive = async (user: UserRow) => {
    try {
      const supabase = getClient();
      await supabase
        .from("profiles")
        .update({ is_active: !user.isActive })
        .eq("id", user.id);
      toast({
        title: user.isActive ? "Đã vô hiệu hóa" : "Đã kích hoạt",
        description: user.fullName,
        variant: "success",
      });
      load();
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "error" });
    }
  };

  const getBranchName = (branchId: string | null) =>
    branches.find((b) => b.id === branchId)?.name ?? "—";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Người dùng & Phân quyền</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý tài khoản nhân viên, gán vai trò
          </p>
        </div>
        <Button disabled>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Mời nhân viên
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{users.length}</div>
            <p className="text-xs text-muted-foreground">Tổng người dùng</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{users.filter((u) => u.isActive).length}</div>
            <p className="text-xs text-muted-foreground">Đang hoạt động</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{roles.length}</div>
            <p className="text-xs text-muted-foreground">Vai trò</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{users.filter((u) => !u.roleId).length}</div>
            <p className="text-xs text-muted-foreground">Chưa gán vai trò</p>
          </CardContent>
        </Card>
      </div>

      {/* User table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Danh sách nhân viên
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Họ tên</th>
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium hidden md:table-cell">Chi nhánh</th>
                  <th className="pb-2 font-medium">Vai trò</th>
                  <th className="pb-2 font-medium">Trạng thái</th>
                  <th className="pb-2 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="py-2.5 font-medium">{user.fullName}</td>
                    <td className="py-2.5 text-muted-foreground">{user.email}</td>
                    <td className="py-2.5 hidden md:table-cell">{getBranchName(user.branchId)}</td>
                    <td className="py-2.5">
                      {user.roleName ? (
                        <Badge variant="secondary" className="text-xs">
                          <Shield className="h-3 w-3 mr-1" />
                          {user.roleName}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {user.role}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <Badge
                        variant={user.isActive ? "default" : "secondary"}
                        className={cn(
                          "text-xs",
                          user.isActive ? "bg-green-100 text-green-700 hover:bg-green-100" : ""
                        )}
                      >
                        {user.isActive ? "Hoạt động" : "Vô hiệu"}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Thao tác</DropdownMenuLabel>
                          <DropdownMenuItem
                            onSelect={() => {
                              setSelectedUser(user);
                              setSelectedRoleId(user.roleId ?? "");
                              setAssignOpen(true);
                            }}
                          >
                            <Shield className="h-4 w-4 mr-2" />
                            Gán vai trò
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => handleToggleActive(user)}
                            className={user.isActive ? "text-red-600" : "text-green-600"}
                          >
                            {user.isActive ? "Vô hiệu hóa" : "Kích hoạt lại"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Assign Role Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gán vai trò — {selectedUser?.fullName}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Select
              value={selectedRoleId}
              onValueChange={(v) => setSelectedRoleId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn vai trò" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", role.color)} />
                      {role.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              Vai trò quyết định quyền truy cập của nhân viên trong hệ thống.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleAssignRole}>
              <Check className="h-4 w-4 mr-1.5" />
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
