"use client";

/**
 * User Management Page — List users, assign roles, activate/deactivate.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryCard } from "@/components/shared/summary-card";
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
import { formatNumber } from "@/lib/format";
import {
  getRoles,
  getTenantUsers,
  assignRoleToUser,
} from "@/lib/services/supabase/roles";
import type { DbRole } from "@/lib/services/supabase/roles";
import { setUserPosPin, removeUserPosPin } from "@/lib/services/supabase/pos-pin";
import { SetPinDialog } from "@/components/shared/dialogs";
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
  const { tenant, branches, user } = useAuth();
  const { toast } = useToast();
  const tenantId = tenant?.id ?? "";

  // Security gate: chỉ owner mới được hiển thị checkbox "Cấp quyền owner".
  // Trước đây ai mở dialog Mời cũng có thể tick → bypass toàn bộ RBAC.
  // (Trang `/he-thong/users` cần wrap PermissionPage ở layout level — tạm
  // thời chặn ở UI layer cho đến khi route gating sẵn sàng).
  const isCurrentUserOwner = user?.role === "owner";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<DbRole[]>([]);
  const [loading, setLoading] = useState(true);

  // Role assign dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  // Sprint B.4 (CEO 12/05): Set PIN POS dialog
  const [setPinUser, setSetPinUser] = useState<UserRow | null>(null);

  // Edit user dialog (CEO 06/05/2026)
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    phone: "",
    roleId: "",
    branchIds: [] as string[],
    allBranches: false,
    newPassword: "",
  });

  const handleEditUser = async () => {
    if (!editTarget) return;
    if (editForm.newPassword && editForm.newPassword.length < 8) {
      toast({
        title: "Mật khẩu mới quá ngắn",
        description: "Tối thiểu 8 ký tự",
        variant: "error",
      });
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch("/api/admin/update-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editTarget.id,
          fullName: editForm.fullName.trim() || undefined,
          phone: editForm.phone.trim(),
          roleId: editForm.roleId || null,
          branchIds: editForm.allBranches ? [] : editForm.branchIds,
          allBranches: editForm.allBranches,
          newPassword: editForm.newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? "Lỗi không xác định");
      }
      toast({
        title: "Đã cập nhật thông tin",
        description: editTarget.fullName,
        variant: "success",
      });
      setEditOpen(false);
      setEditTarget(null);
      load();
    } catch (err) {
      toast({
        title: "Cập nhật thất bại",
        description: (err as Error).message,
        variant: "error",
        duration: 8000,
      });
    } finally {
      setEditBusy(false);
    }
  };

  // Create account dialog (Sprint USER-MGMT — admin tự đặt password).
  // CEO 13/05: admin KHÔNG đặt PIN POS — nhân viên tự set qua trang Hồ sơ
  // sau khi login lần đầu (PIN cá nhân, owner không nên biết).
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: "",
    password: "",
    fullName: "",
    phone: "",
    roleId: "",
    branchIds: [] as string[],
    allBranches: false,
  });
  const resetCreateForm = () =>
    setCreateForm({
      email: "",
      password: "",
      fullName: "",
      phone: "",
      roleId: "",
      branchIds: [],
      allBranches: false,
    });

  const handleCreateUser = async () => {
    if (!createForm.email || !createForm.password || !createForm.fullName) {
      toast({
        title: "Thiếu thông tin",
        description: "Vui lòng nhập đầy đủ email, mật khẩu, họ tên",
        variant: "error",
      });
      return;
    }
    if (createForm.password.length < 8) {
      toast({
        title: "Mật khẩu quá ngắn",
        description: "Mật khẩu phải có ít nhất 8 ký tự",
        variant: "error",
      });
      return;
    }
    if (!createForm.allBranches && createForm.branchIds.length === 0) {
      toast({
        title: "Chưa chọn chi nhánh",
        description: "Chọn ít nhất 1 chi nhánh hoặc tick 'Tất cả chi nhánh'",
        variant: "error",
      });
      return;
    }
    setCreateBusy(true);
    try {
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createForm.email.trim(),
          password: createForm.password,
          fullName: createForm.fullName.trim(),
          phone: createForm.phone.trim() || undefined,
          roleId: createForm.roleId || undefined,
          branchIds: createForm.allBranches ? [] : createForm.branchIds,
          allBranches: createForm.allBranches,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? "Lỗi không xác định");
      }

      toast({
        title: "Đã tạo tài khoản",
        description: `${createForm.email} có thể đăng nhập bằng mật khẩu vừa đặt. Nhân viên tự đặt PIN POS qua trang Hồ sơ.`,
        variant: "success",
        duration: 8000,
      });
      setCreateOpen(false);
      resetCreateForm();
      load();
    } catch (err) {
      toast({
        title: "Tạo tài khoản thất bại",
        description: (err as Error).message,
        variant: "error",
        duration: 10000,
      });
    } finally {
      setCreateBusy(false);
    }
  };

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
      // Defense-in-depth: filter tenant_id để admin tenant A KHÔNG thể
      // disable user tenant B nếu biết UUID. Trước đây chỉ filter id →
      // RLS off (dev mode) sẽ leak cross-tenant.
      const supabase = getClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ is_active: !user.isActive })
        .eq("tenant_id", tenantId)
        .eq("id", user.id);
      if (error) throw error;
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
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <Icon name="person_add" size={16} className="mr-1" />
            Tạo tài khoản mới
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon="group"
          label="Tổng người dùng"
          value={formatNumber(users.length)}
        />
        <SummaryCard
          icon="verified_user"
          label="Đang hoạt động"
          value={formatNumber(users.filter((u) => u.isActive).length)}
          highlight
        />
        <SummaryCard
          icon="admin_panel_settings"
          label="Vai trò"
          value={formatNumber(roles.length)}
        />
        <SummaryCard
          icon="person_off"
          label="Chưa gán vai trò"
          value={formatNumber(users.filter((u) => !u.roleId).length)}
          danger={users.some((u) => !u.roleId)}
          hint={users.some((u) => !u.roleId) ? "Cần gán vai trò" : undefined}
        />
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
                    <td className="py-3 font-medium">{user.fullName}</td>
                    <td className="py-3 text-muted-foreground">{user.email}</td>
                    <td className="py-3 hidden md:table-cell">{getBranchName(user.branchId)}</td>
                    <td className="py-3">
                      {user.roleName ? (
                        <Badge variant="secondary" className="text-xs">
                          <Icon name="shield" size={14} className="mr-1" />
                          {user.roleName}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {user.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
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
                    <td className="py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted transition-colors">
                          <Icon name="more_horiz" size={16} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Thao tác</DropdownMenuLabel>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditTarget(user);
                              setEditForm({
                                fullName: user.fullName,
                                phone: user.phone ?? "",
                                roleId: user.roleId ?? "",
                                branchIds: user.branchId ? [user.branchId] : [],
                                allBranches: false,
                                newPassword: "",
                              });
                              setEditOpen(true);
                            }}
                          >
                            <Icon name="edit" size={16} className="mr-2" />
                            Chỉnh sửa thông tin
                          </DropdownMenuItem>
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
                          {/* Sprint B.4 (CEO 12/05): đặt PIN POS cho nhân viên */}
                          <DropdownMenuItem onSelect={() => setSetPinUser(user)}>
                            <Icon name="pin" size={16} className="mr-2 text-status-warning" />
                            Đặt PIN POS
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => handleToggleActive(user)}
                            className={user.isActive ? "text-status-error" : "text-status-success"}
                          >
                            <Icon name={user.isActive ? "block" : "check_circle"} size={16} className="mr-2" />
                            {user.isActive ? "Vô hiệu hoá" : "Kích hoạt lại"}
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
              items={roles.map((r) => ({ value: r.id, label: r.name }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn vai trò">
                  {(v) => {
                    const match = roles.find((r) => r.id === v);
                    return match?.name ?? "Chọn vai trò";
                  }}
                </SelectValue>
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
              <Icon name="check" size={16} className="mr-1" />
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================
           Dialog: Tạo tài khoản mới (Sprint USER-MGMT)
           Admin tự đặt password thay vì gửi link email
         ================================================ */}
      {/* ================================================
           Dialog: Chỉnh sửa user (CEO 06/05/2026)
           Sửa tên / SĐT / role / chi nhánh + reset password
         ================================================ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Chỉnh sửa thông tin — {editTarget?.fullName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Email (không sửa được)</Label>
              <Input value={editTarget?.email ?? ""} disabled className="bg-muted" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-fullname">Họ và tên</Label>
              <Input
                id="edit-fullname"
                value={editForm.fullName}
                onChange={(e) =>
                  setEditForm({ ...editForm, fullName: e.target.value })
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-phone">Số điện thoại</Label>
              <Input
                id="edit-phone"
                value={editForm.phone}
                onChange={(e) =>
                  setEditForm({ ...editForm, phone: e.target.value })
                }
                placeholder="0912345678"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-role">Vai trò</Label>
              <Select
                value={editForm.roleId}
                onValueChange={(v) =>
                  setEditForm({ ...editForm, roleId: v ?? "" })
                }
                items={roles.map((r) => ({ value: r.id, label: r.name }))}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue placeholder="Không gán vai trò">
                    {(v) => {
                      if (!v) return "Không gán vai trò";
                      const match = roles.find((r) => r.id === v);
                      return match?.name ?? "Không gán vai trò";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Chi nhánh được phép truy cập</Label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.allBranches}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      allBranches: e.target.checked,
                      branchIds: e.target.checked ? [] : editForm.branchIds,
                    })
                  }
                  className="h-4 w-4"
                />
                <span className="font-medium">Tất cả chi nhánh</span>
              </label>
              {!editForm.allBranches && (
                <div className="border rounded-lg p-2 max-h-40 overflow-auto space-y-1">
                  {branches.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Chưa có chi nhánh nào
                    </p>
                  ) : (
                    branches.map((b) => (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-surface-container-low rounded px-2 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={editForm.branchIds.includes(b.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...editForm.branchIds, b.id]
                              : editForm.branchIds.filter((x) => x !== b.id);
                            setEditForm({ ...editForm, branchIds: next });
                          }}
                          className="h-4 w-4"
                        />
                        <span>{b.name}</span>
                        {b.code && (
                          <span className="text-xs text-muted-foreground">
                            ({b.code})
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1 border-t pt-3">
              <Label htmlFor="edit-password" className="flex items-center gap-2">
                <Icon name="lock_reset" size={14} />
                Đặt lại mật khẩu
                <span className="text-xs text-muted-foreground font-normal">
                  (để trống nếu không đổi)
                </span>
              </Label>
              <Input
                id="edit-password"
                type="text"
                value={editForm.newPassword}
                onChange={(e) =>
                  setEditForm({ ...editForm, newPassword: e.target.value })
                }
                placeholder="Mật khẩu mới (≥ 8 ký tự)"
              />
              {editForm.newPassword && (
                <p className="text-xs text-status-warning">
                  ⚠️ Sau khi lưu, đưa mật khẩu mới cho nhân viên — họ phải đăng nhập lại.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditTarget(null);
              }}
              disabled={editBusy}
            >
              Huỷ
            </Button>
            <Button onClick={handleEditUser} disabled={editBusy}>
              {editBusy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="mr-1 animate-spin"
                  />
                  Đang lưu...
                </>
              ) : (
                <>
                  <Icon name="save" size={16} className="mr-1" />
                  Lưu thay đổi
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tạo tài khoản mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="create-email">Email *</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  placeholder="ten@xuongcaphe.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="create-password">
                  Mật khẩu * (≥ 8 ký tự)
                </Label>
                <Input
                  id="create-password"
                  type="text"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, password: e.target.value })
                  }
                  placeholder="Nhập mật khẩu cho nhân viên"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="create-fullname">Họ và tên *</Label>
              <Input
                id="create-fullname"
                value={createForm.fullName}
                onChange={(e) =>
                  setCreateForm({ ...createForm, fullName: e.target.value })
                }
                placeholder="Nguyễn Văn A"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="create-phone">Số điện thoại</Label>
              <Input
                id="create-phone"
                value={createForm.phone}
                onChange={(e) =>
                  setCreateForm({ ...createForm, phone: e.target.value })
                }
                placeholder="0912345678"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="create-role">Vai trò</Label>
              <Select
                value={createForm.roleId}
                onValueChange={(v) =>
                  setCreateForm({ ...createForm, roleId: v ?? "" })
                }
                items={roles.map((r) => ({ value: r.id, label: r.name }))}
              >
                <SelectTrigger id="create-role">
                  <SelectValue placeholder="Chọn vai trò...">
                    {(v) => {
                      if (!v) return "Chọn vai trò...";
                      const match = roles.find((r) => r.id === v);
                      return match?.name ?? "Chọn vai trò...";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Chi nhánh được phép truy cập *</Label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.allBranches}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      allBranches: e.target.checked,
                      branchIds: e.target.checked ? [] : createForm.branchIds,
                    })
                  }
                  className="h-4 w-4"
                />
                <span className="font-medium">Tất cả chi nhánh</span>
                <span className="text-xs text-muted-foreground">
                  (truy cập mọi chi nhánh hiện có và sau này)
                </span>
              </label>
              {!createForm.allBranches && (
                <div className="border rounded-lg p-2 max-h-40 overflow-auto space-y-1">
                  {branches.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Chưa có chi nhánh nào
                    </p>
                  ) : (
                    branches.map((b) => (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-surface-container-low rounded px-2 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={createForm.branchIds.includes(b.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...createForm.branchIds, b.id]
                              : createForm.branchIds.filter((x) => x !== b.id);
                            setCreateForm({ ...createForm, branchIds: next });
                          }}
                          className="h-4 w-4"
                        />
                        <span>{b.name}</span>
                        {b.code && (
                          <span className="text-xs text-muted-foreground">
                            ({b.code})
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg bg-status-info/5 border border-status-info/20 p-3 text-xs text-status-info">
              <Icon name="info" size={14} className="inline mr-1 align-text-bottom" />
              Sau khi tạo, đưa email + mật khẩu cho nhân viên. Nhân viên tự
              vào <strong>Hồ sơ → Đổi PIN POS</strong> để đặt PIN 6 số riêng
              (chủ cửa hàng không biết PIN này). Khi NV quên PIN → reset qua
              dropdown ⋯ → &quot;Đặt PIN POS&quot;.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
              disabled={createBusy}
            >
              Huỷ
            </Button>
            <Button onClick={handleCreateUser} disabled={createBusy}>
              {createBusy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="mr-1 animate-spin"
                  />
                  Đang tạo...
                </>
              ) : (
                <>
                  <Icon name="person_add" size={16} className="mr-1" />
                  Tạo tài khoản
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sprint B.4 (CEO 12/05): Đặt PIN POS cho nhân viên */}
      <SetPinDialog
        open={setPinUser !== null}
        onOpenChange={(o) => {
          if (!o) setSetPinUser(null);
        }}
        targetUserName={setPinUser?.fullName ?? ""}
        hasExistingPin={false}
        onConfirm={async (pin) => {
          if (!setPinUser) return;
          try {
            await setUserPosPin(setPinUser.id, pin);
            toast({
              title: "Đã đặt PIN POS",
              description: `${setPinUser.fullName} — nhân viên có thể switch user trên POS bằng PIN mới`,
              variant: "success",
            });
            setSetPinUser(null);
          } catch (err) {
            toast({
              title: "Đặt PIN thất bại",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
            throw err; // để SetPinDialog giữ open + hiện error inline
          }
        }}
      />
    </div>
  );
}
