"use client";

/**
 * Permission Override Dialog — CEO 23/05/2026
 *
 * Cho phép admin cấp quyền/khoá quyền RIÊNG cho từng user, ngoài
 * permissions inherited từ role. Use cases:
 *   - Cashier lâu năm trust → grant POS_EDIT_PRICE riêng
 *   - Thực tập sinh → revoke POS_VOID tạm thời
 *
 * State của mỗi permission:
 *   - "default": dùng theo role (effective = có/không tuỳ role)
 *   - "grant":   force cho phép (effective = có, dù role không có)
 *   - "revoke":  force khoá (effective = không, dù role có)
 *
 * Effective = (role_perms ∪ grants) ∖ revokes
 */

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/contexts";
import {
  PERMISSION_GROUPS,
  type PermissionCode,
} from "@/lib/permissions/constants";
import {
  getUserPermissionOverrides,
  setUserPermissionOverride,
  deleteUserPermissionOverride,
  type PermissionOverride,
} from "@/lib/services/supabase/permission-overrides";
import { getUserPermissions } from "@/lib/services/supabase/roles";

type OverrideState = "default" | "grant" | "revoke";

interface PermissionOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    fullName: string;
    roleName: string | null;
  } | null;
}

export function PermissionOverrideDialog({
  open,
  onOpenChange,
  user,
}: PermissionOverrideDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set các permission code mà role đã có (effective default behavior)
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  // Override state cho TỪNG permission. Default: 'default'.
  const [overrides, setOverrides] = useState<Map<string, OverrideState>>(
    new Map(),
  );
  // Backup để biết permission nào đã thay đổi → call API tương ứng
  const [originalOverrides, setOriginalOverrides] = useState<
    Map<string, OverrideState>
  >(new Map());

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [roleP, userOverrides] = await Promise.all([
        getUserPermissions(user.id).catch(() => new Set<string>()),
        getUserPermissionOverrides(user.id),
      ]);
      setRolePerms(roleP);

      const overrideMap = new Map<string, OverrideState>();
      userOverrides.forEach((o: PermissionOverride) => {
        overrideMap.set(o.permissionCode, o.overrideType);
      });
      setOverrides(new Map(overrideMap));
      setOriginalOverrides(new Map(overrideMap));
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi tải quyền",
        description: err instanceof Error ? err.message : "",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (open && user) {
      void loadData();
    }
  }, [open, user, loadData]);

  function setOverride(code: string, state: OverrideState) {
    const next = new Map(overrides);
    if (state === "default") {
      next.delete(code);
    } else {
      next.set(code, state);
    }
    setOverrides(next);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      // Diff: tìm permissions thay đổi giữa original và current
      const allCodes = new Set([
        ...originalOverrides.keys(),
        ...overrides.keys(),
      ]);
      const ops: Promise<void>[] = [];

      for (const code of allCodes) {
        const oldState = originalOverrides.get(code);
        const newState = overrides.get(code);

        if (oldState === newState) continue;

        if (!newState || newState === "default") {
          // Xoá override → reset về role default
          ops.push(deleteUserPermissionOverride(user.id, code));
        } else {
          // newState ở đây CHẮC CHẮN là 'grant' | 'revoke' (đã loại default)
          // Upsert grant/revoke
          ops.push(
            setUserPermissionOverride({
              userId: user.id,
              permissionCode: code,
              overrideType: newState as "grant" | "revoke",
            }),
          );
        }
      }

      await Promise.all(ops);
      toast({
        variant: "success",
        title: "Đã lưu quyền tuỳ chỉnh",
        description: `${ops.length} thay đổi áp dụng cho ${user.fullName}. User cần đăng nhập lại để cập nhật.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu quyền",
        description: err instanceof Error ? err.message : "",
      });
    } finally {
      setSaving(false);
    }
  }

  const hasChanges =
    overrides.size !== originalOverrides.size ||
    Array.from(overrides.entries()).some(
      ([code, state]) => originalOverrides.get(code) !== state,
    );

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <DialogTitle>
            Quyền tuỳ chỉnh — {user.fullName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Vai trò:{" "}
            <span className="font-medium text-foreground">
              {user.roleName ?? "—"}
            </span>
            {" · "}
            Override permission riêng cho user này. Không thay đổi role gốc.
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 flex-1">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-6 py-4">
            {/* Legend */}
            <div className="mb-4 p-3 bg-surface-container-low rounded-lg text-xs space-y-1.5">
              <div className="font-semibold">Hướng dẫn:</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="inline-block w-3 h-3 rounded bg-muted mr-1.5 align-middle" />
                  <strong>Mặc định</strong>: theo vai trò
                </div>
                <div>
                  <span className="inline-block w-3 h-3 rounded bg-status-success/30 mr-1.5 align-middle" />
                  <strong>Cho thêm</strong>: force cấp quyền
                </div>
                <div>
                  <span className="inline-block w-3 h-3 rounded bg-status-error/30 mr-1.5 align-middle" />
                  <strong>Khoá bớt</strong>: force chặn
                </div>
              </div>
            </div>

            {/* Permission groups */}
            <div className="space-y-4">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.group}>
                  <h3 className="text-sm font-semibold mb-2 text-foreground/90">
                    {group.group}
                  </h3>
                  <div className="space-y-1">
                    {group.permissions.map((perm) => {
                      const hasFromRole = rolePerms.has(perm.code);
                      const override = overrides.get(perm.code) ?? "default";
                      const effective =
                        override === "grant"
                          ? true
                          : override === "revoke"
                            ? false
                            : hasFromRole;
                      return (
                        <PermissionRow
                          key={perm.code}
                          code={perm.code}
                          label={perm.label}
                          hasFromRole={hasFromRole}
                          override={override}
                          effective={effective}
                          onChange={(state) => setOverride(perm.code, state)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saving || loading}>
            {saving && (
              <Icon
                name="progress_activity"
                size={14}
                className="mr-1.5 animate-spin"
              />
            )}
            Lưu thay đổi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Row hiển thị 1 permission với 3 nút radio: Mặc định / Cho thêm / Khoá bớt.
 */
function PermissionRow({
  code,
  label,
  hasFromRole,
  override,
  effective,
  onChange,
}: {
  code: PermissionCode;
  label: string;
  hasFromRole: boolean;
  override: OverrideState;
  effective: boolean;
  onChange: (state: OverrideState) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-surface-container-low">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">{label}</span>
          {hasFromRole && override === "default" && (
            <span className="text-[10px] text-status-success font-medium">
              ✓ có theo vai trò
            </span>
          )}
          {!hasFromRole && override === "default" && (
            <span className="text-[10px] text-muted-foreground/60 font-medium">
              · không có
            </span>
          )}
          {override !== "default" && (
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase",
                override === "grant" &&
                  "bg-status-success/15 text-status-success",
                override === "revoke" && "bg-status-error/15 text-status-error",
              )}
            >
              {override === "grant" ? "Cấp" : "Khoá"}
            </span>
          )}
        </div>
        <code className="text-[10px] text-muted-foreground/70 font-mono">
          {code}
        </code>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <RadioBtn
          active={override === "default"}
          onClick={() => onChange("default")}
          tone="default"
          label="Mặc định"
        />
        <RadioBtn
          active={override === "grant"}
          onClick={() => onChange("grant")}
          tone="grant"
          label="Cấp"
        />
        <RadioBtn
          active={override === "revoke"}
          onClick={() => onChange("revoke")}
          tone="revoke"
          label="Khoá"
        />
      </div>
      <div className="w-14 text-right shrink-0">
        {effective ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-status-success font-semibold">
            <Icon name="check_circle" size={12} />
            CÓ
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/60">
            <Icon name="block" size={12} />
            Không
          </span>
        )}
      </div>
    </div>
  );
}

function RadioBtn({
  active,
  onClick,
  tone,
  label,
}: {
  active: boolean;
  onClick: () => void;
  tone: "default" | "grant" | "revoke";
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-[10px] font-medium rounded border transition-colors",
        active
          ? tone === "grant"
            ? "bg-status-success/15 border-status-success text-status-success"
            : tone === "revoke"
              ? "bg-status-error/15 border-status-error text-status-error"
              : "bg-muted border-border text-foreground"
          : "border-transparent text-muted-foreground hover:bg-surface-container-low",
      )}
    >
      {label}
    </button>
  );
}
