"use client";

/**
 * Role & Permission Management Page
 *
 * Admin can create custom roles, toggle individual permissions,
 * and see member counts for each role.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth, useToast } from "@/lib/contexts";
import {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
} from "@/lib/services/supabase/roles";
import type { DbRole, DbRoleDetail } from "@/lib/services/supabase/roles";
import { PERMISSION_GROUPS, DEFAULT_ROLE_TEMPLATES } from "@/lib/permissions/constants";
import type { PermissionCode } from "@/lib/permissions/constants";
import { Icon } from "@/components/ui/icon";

export default function PermissionSettingsPage() {
  const { tenant } = useAuth();
  const { toast } = useToast();
  const tenantId = tenant?.id ?? "";

  const [roles, setRoles] = useState<DbRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [roleDetail, setRoleDetail] = useState<DbRoleDetail | null>(null);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Create role dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const r = await getRoles(tenantId);
      setRoles(r);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Load role detail when expanded
  const handleExpand = async (roleId: string) => {
    if (expandedRole === roleId) {
      setExpandedRole(null);
      setRoleDetail(null);
      setDirty(false);
      return;
    }
    setExpandedRole(roleId);
    try {
      const detail = await getRoleById(roleId);
      setRoleDetail(detail);
      setEditPerms(new Set(detail.permissions));
      setDirty(false);
    } catch {
      // silent
    }
  };

  // Toggle permission
  const togglePerm = (code: string) => {
    setEditPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setDirty(true);
  };

  // Toggle all in a group
  const toggleGroup = (groupCodes: string[]) => {
    const allOn = groupCodes.every((c) => editPerms.has(c));
    setEditPerms((prev) => {
      const next = new Set(prev);
      for (const c of groupCodes) {
        if (allOn) next.delete(c);
        else next.add(c);
      }
      return next;
    });
    setDirty(true);
  };

  // Save permissions
  const handleSave = async () => {
    if (!expandedRole || !roleDetail) return;
    setSaving(true);
    try {
      await setRolePermissions(expandedRole, Array.from(editPerms));
      toast({ title: "Đã lưu quyền", description: roleDetail.name, variant: "success" });
      setDirty(false);
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  // Create new role
  const handleCreate = async () => {
    if (!newRoleName.trim()) return;
    try {
      await createRole({ tenantId, name: newRoleName.trim(), description: newRoleDesc.trim() || undefined });
      toast({ title: "Đã tạo vai trò", description: newRoleName, variant: "success" });
      setCreateOpen(false);
      setNewRoleName("");
      setNewRoleDesc("");
      load();
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "error" });
    }
  };

  // Delete role
  const handleDelete = async (roleId: string, roleName: string) => {
    try {
      await deleteRole(roleId);
      toast({ title: "Đã xóa vai trò", description: roleName, variant: "success" });
      if (expandedRole === roleId) {
        setExpandedRole(null);
        setRoleDetail(null);
      }
      load();
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "error" });
    }
  };

  // Seed default roles
  const handleSeedDefaults = async () => {
    try {
      for (const template of DEFAULT_ROLE_TEMPLATES) {
        const existing = roles.find((r) => r.name === template.name);
        if (existing) continue;
        await createRole({
          tenantId,
          name: template.name,
          description: template.description,
          color: template.color,
          permissions: template.permissions as PermissionCode[],
        });
      }
      toast({ title: "Đã tạo vai trò mặc định", variant: "success" });
      load();
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "error" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Phân quyền</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý vai trò và quyền truy cập — {roles.length} vai trò
          </p>
        </div>
        <div className="flex items-center gap-2">
          {roles.length === 0 && (
            <Button variant="outline" onClick={handleSeedDefaults}>
              Tạo vai trò mặc định
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={16} className="mr-1.5" />
            Thêm vai trò
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {roles.map((role) => {
          const isExpanded = expandedRole === role.id;
          return (
            <Card key={role.id}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => handleExpand(role.id)}
              >
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center text-white",
                          role.color
                        )}
                      >
                        <Icon name="shield" size={16} />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{role.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {role.description ?? "Vai trò tùy chỉnh"}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {role.isSystem && (
                        <Badge variant="outline" className="text-xs">
                          Hệ thống
                        </Badge>
                      )}
                      <Badge variant="secondary">
                        <Icon name="group" size={12} className="mr-1" />
                        {role.memberCount}
                      </Badge>
                      {isExpanded ? (
                        <Icon name="expand_less" size={16} className="text-muted-foreground" />
                      ) : (
                        <Icon name="expand_more" size={16} className="text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {isExpanded && roleDetail && (
                <CardContent>
                  <Separator className="mb-4" />
                  <div className="space-y-5">
                    {PERMISSION_GROUPS.map((group) => {
                      const groupCodes = group.permissions.map((p) => p.code);
                      const enabledCount = groupCodes.filter((c) => editPerms.has(c)).length;
                      const allOn = enabledCount === groupCodes.length;

                      return (
                        <div key={group.group}>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              {group.group}
                              <span className="ml-2 text-[10px] font-normal normal-case">
                                ({enabledCount}/{groupCodes.length})
                              </span>
                            </h4>
                            <button
                              type="button"
                              onClick={() => toggleGroup(groupCodes)}
                              className="text-[10px] text-primary hover:underline"
                            >
                              {allOn ? "Bỏ tất cả" : "Bật tất cả"}
                            </button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {group.permissions.map((perm) => (
                              <button
                                key={perm.code}
                                type="button"
                                onClick={() => togglePerm(perm.code)}
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer transition-colors text-left",
                                  editPerms.has(perm.code)
                                    ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                                    : "bg-muted text-muted-foreground"
                                )}
                              >
                                <div
                                  className={cn(
                                    "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                    editPerms.has(perm.code)
                                      ? "bg-green-500 border-green-500 text-white"
                                      : "border-border bg-white"
                                  )}
                                >
                                  {editPerms.has(perm.code) && (
                                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </div>
                                {perm.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    {!role.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDelete(role.id, role.name)}
                      >
                        <Icon name="delete" size={16} className="mr-1" />
                        Xóa vai trò
                      </Button>
                    )}
                    {role.isSystem && <div />}
                    <Button
                      onClick={handleSave}
                      disabled={!dirty || saving}
                      size="sm"
                    >
                      {saving ? (
                        <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />
                      ) : (
                        <Icon name="save" size={16} className="mr-1" />
                      )}
                      Lưu thay đổi
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm vai trò mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div>
              <Label>Tên vai trò</Label>
              <Input
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="VD: Trưởng ca, Nhân viên bar..."
              />
            </div>
            <div>
              <Label>Mô tả</Label>
              <Input
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                placeholder="Mô tả ngắn về vai trò"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleCreate} disabled={!newRoleName.trim()}>
              <Icon name="add" size={16} className="mr-1.5" />
              Tạo vai trò
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
