"use client";

/**
 * User Management Page — List users, assign roles, activate/deactivate.
 */

import { useState, useEffect, useCallback } from "react";
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
  inviteStaff,
} from "@/lib/services/supabase/roles";
import type { DbRole } from "@/lib/services/supabase/roles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClient } from "@/lib/services/supabase/base";
import { Icon } from "@/components/ui/icon";

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

  // Invite staff dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    fullName: "",
    phone: "",
    branchId: "",
    roleId: "",
    asOwner: false,
  });

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

  const resetInviteForm = () =>
    setInviteForm({ email: "", fullName: "", phone: "", branchId: "", roleId: "", asOwner: false });

  const handleInvite = async () => {
    if (!tenantId) return;
    setInviteBusy(true);
    try {
      await inviteStaff({
        tenantId,
        email: inviteForm.email.trim(),
        fullName: inviteForm.fullName,
        phone: inviteForm.phone || undefined,
        branchId: inviteForm.branchId || undefined,
        roleId: inviteForm.roleId || undefined,
        asOwner: inviteForm.asOwner,
      });
      toast({
        title: "Đã gửi lời mời",
        description: `Email mời đã gửi đến ${inviteForm.email}. Nhân viên click link trong email để kích hoạt tài khoản.`,
        variant: "success",
        duration: 8000,
      });
      setInviteOpen(false);
      resetInviteForm();
      load();
    } catch (err) {
      toast({
        title: "Không gửi được lời mời",
        description: (err as Error).message,
        variant: "error",
        duration: 8000,
      });
    } finally {
      setInviteBusy(false);
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
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
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
        <Button onClick={() => setInviteOpen(true)}>
          <Icon name="person_add" size={16} className="mr-1.5" />
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
            <Icon name="manage_accounts" size={16} />
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
                          <Icon name="shield" size={12} className="mr-1" />
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
                          user.isActive ? "bg-status-success/10 text-status-success hover:bg-status-success/10" : ""
                        )}
                      >
                        {user.isActive ? "Hoạt động" : "Vô hiệu"}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors">
                          <Icon name="more_horiz" size={16} />
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
                            <Icon name="shield" size={16} className="mr-2" />
                            Gán vai trò
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => handleToggleActive(user)}
                            className={user.isActive ? "text-status-error" : "text-status-success"}
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
              <Icon name="check" size={16} className="mr-1.5" />
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Staff Dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(o) => {
          setInviteOpen(o);
          if (!o) resetInviteForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mời nhân viên mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Nhân viên sẽ nhận email chứa link đăng nhập. Sau khi click link,
              tài khoản tự động được kích hoạt và liên kết với cửa hàng.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invite-email">Email *</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="nhanvien@email.com"
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, email: e.target.value }))
                  }
                  disabled={inviteBusy}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-name">Họ và tên *</Label>
                <Input
                  id="invite-name"
                  placeholder="Nguyễn Văn A"
                  value={inviteForm.fullName}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, fullName: e.target.value }))
                  }
                  disabled={inviteBusy}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-phone">Số điện thoại</Label>
                <Input
                  id="invite-phone"
                  type="tel"
                  placeholder="0912xxxxxx"
                  value={inviteForm.phone}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  disabled={inviteBusy}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-branch">Chi nhánh</Label>
                <Select
                  value={inviteForm.branchId}
                  onValueChange={(v) =>
                    setInviteForm((f) => ({ ...f, branchId: v ?? "" }))
                  }
                  disabled={inviteBusy}
                >
                  <SelectTrigger id="invite-branch">
                    <SelectValue placeholder="Chọn chi nhánh" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Vai trò</Label>
                <Select
                  value={inviteForm.roleId}
                  onValueChange={(v) =>
                    setInviteForm((f) => ({ ...f, roleId: v ?? "" }))
                  }
                  disabled={inviteBusy || inviteForm.asOwner}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue
                      placeholder={
                        inviteForm.asOwner ? "(Chủ cửa hàng — full quyền)" : "Chọn vai trò"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn("h-2 w-2 rounded-full", role.color)}
                          />
                          {role.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:col-span-2 flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                <input
                  id="invite-as-owner"
                  type="checkbox"
                  checked={inviteForm.asOwner}
                  onChange={(e) =>
                    setInviteForm((f) => ({
                      ...f,
                      asOwner: e.target.checked,
                      // Nếu cấp quyền chủ → clear roleId (không cần)
                      roleId: e.target.checked ? "" : f.roleId,
                    }))
                  }
                  disabled={inviteBusy}
                  className="mt-0.5 h-4 w-4 rounded border-amber-400 accent-amber-600"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="invite-as-owner"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Cấp quyền Chủ cửa hàng (đồng chủ)
                  </Label>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    Người này sẽ có toàn quyền như bạn: xem mọi chi nhánh,
                    mời/xoá nhân viên, xem báo cáo tài chính. Chỉ tick khi
                    hoàn toàn tin tưởng.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={inviteBusy}
            >
              Hủy
            </Button>
            <Button
              onClick={handleInvite}
              disabled={
                inviteBusy ||
                !inviteForm.email.trim() ||
                !inviteForm.fullName.trim()
              }
            >
              {inviteBusy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="mr-1.5 animate-spin"
                  />
                  Đang gửi...
                </>
              ) : (
                <>
                  <Icon name="send" size={16} className="mr-1.5" />
                  Gửi lời mời
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
