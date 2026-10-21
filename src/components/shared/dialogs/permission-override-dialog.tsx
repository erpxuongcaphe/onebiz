"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/contexts";
import { PERMISSION_GROUPS } from "@/lib/permissions/constants";
import { normalizeListSearch } from "@/lib/local-list-query";
import { getUserPermissionOverrides, setUserPermissionOverride, deleteUserPermissionOverride } from "@/lib/services/supabase/permission-overrides";
import { getUserPermissions } from "@/lib/services/supabase/roles";

type OverrideState = "default" | "grant" | "revoke";
type Filter = "all" | "custom" | "allowed" | "blocked";
interface PermissionOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; fullName: string; roleName: string | null } | null;
}

export function PermissionOverrideDialog({ open, onOpenChange, user }: PermissionOverrideDialogProps) {
  const { toast } = useToast();
  const userId = user?.id;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, OverrideState>>(new Map());
  const [originalOverrides, setOriginalOverrides] = useState<Map<string, OverrideState>>(new Map());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const request = useRef(0);
  const saveLock = useRef(false);
  const activeUserId = useRef(userId);
  activeUserId.current = userId;

  const loadData = useCallback(async () => {
    const id = ++request.current;
    if (!userId) return;
    setLoading(true);
    setLoadedUserId(null);
    setLoadError(false);
    setSaveError(null);
    setRolePerms(new Set());
    setOverrides(new Map());
    setOriginalOverrides(new Map());
    try {
      const [roleP, userOverrides] = await Promise.all([
        getUserPermissions(userId, { strict: true }), getUserPermissionOverrides(userId),
      ]);
      if (id !== request.current || activeUserId.current !== userId) return;
      const map = new Map<string, OverrideState>(userOverrides.map(item => [item.permissionCode, item.overrideType]));
      setRolePerms(roleP);
      setOverrides(new Map(map));
      setOriginalOverrides(new Map(map));
      setLoadedUserId(userId);
    } catch {
      if (id === request.current && activeUserId.current === userId) setLoadError(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setSearch("");
    setFilter("all");
    if (open && userId) void loadData();
    return () => { request.current += 1; };
  }, [open, userId, user?.roleName, loadData]);

  const ready = open && !loading && !loadError && loadedUserId === userId;
  const changedCodes = [...new Set([...originalOverrides.keys(), ...overrides.keys()])]
    .filter(code => originalOverrides.get(code) !== overrides.get(code));
  const hasChanges = ready && changedCodes.length > 0;
  const hasFromRole = (code: string) => rolePerms.has("*") || rolePerms.has(code);
  const isAllowed = (code: string) => overrides.get(code) === "grant" || (overrides.get(code) !== "revoke" && hasFromRole(code));
  const query = normalizeListSearch(search);
  const groups = PERMISSION_GROUPS.map(group => ({
    ...group,
    permissions: group.permissions.filter(perm => {
      if (filter === "custom" && !overrides.has(perm.code)) return false;
      if (filter === "allowed" && !isAllowed(perm.code)) return false;
      if (filter === "blocked" && isAllowed(perm.code)) return false;
      return normalizeListSearch(`${group.group} ${perm.label} ${perm.code}`).includes(query);
    }),
  })).filter(group => group.permissions.length > 0);
  const visibleCount = groups.reduce((sum, group) => sum + group.permissions.length, 0);
  const totalCount = PERMISSION_GROUPS.reduce((sum, group) => sum + group.permissions.length, 0);

  function setOverride(code: string, state: OverrideState) {
    if (!ready || saveLock.current) return;
    setOverrides(current => {
      const next = new Map(current);
      if (state === "default") next.delete(code);
      else next.set(code, state);
      return next;
    });
  }

  async function handleSave() {
    if (!user || !ready || !hasChanges || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    const target = { id: user.id, name: user.fullName };
    const generation = request.current;
    const changes = changedCodes.map(code => ({ code, state: overrides.get(code) }));
    try {
      // Confirm every write before reporting; retry only changes not yet acknowledged.
      const results = await Promise.allSettled(changes.map(async change => {
        if (!change.state || change.state === "default") await deleteUserPermissionOverride(target.id, change.code);
        else await setUserPermissionOverride({ userId: target.id, permissionCode: change.code, overrideType: change.state });
      }));
      if (generation !== request.current || activeUserId.current !== target.id) return;
      setOriginalOverrides(current => {
        const next = new Map(current);
        results.forEach((result, index) => {
          if (result.status !== "fulfilled") return;
          const { code, state } = changes[index];
          if (!state || state === "default") next.delete(code);
          else next.set(code, state);
        });
        return next;
      });
      const confirmed = results.filter(result => result.status === "fulfilled").length;
      if (confirmed !== changes.length) {
        setSaveError(`Đã xác nhận ${confirmed}/${changes.length} thay đổi. Còn ${changes.length - confirmed} chưa xác nhận; thử lưu lại.`);
        return;
      }
      toast({ variant: "success", title: "Đã lưu quyền riêng", description: `${target.name}. Đăng nhập lại để cập nhật quyền.` });
      onOpenChange(false);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  if (!user) return null;
  return (
    <Dialog open={open} trackFormChanges={false} hasUnsavedChanges={hasChanges} onOpenChange={value => { if (!saveLock.current) onOpenChange(value); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-primary/15 bg-primary/5 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="break-words pr-0">Quyền riêng · {user.fullName}</DialogTitle>
              <p className="mt-1 break-words text-xs text-muted-foreground">Vai trò: {user.roleName ?? "Chưa gán"}</p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0" data-dialog-close aria-label="Đóng quyền riêng" title="Đóng" disabled={saving} onClick={() => onOpenChange(false)}><Icon name="close" size={20} /></Button>
          </div>
        </DialogHeader>
        {loading || (!ready && !loadError) ? <div role="status" aria-label="Đang tải quyền riêng" className="flex min-h-48 items-center justify-center"><Icon name="progress_activity" size={28} className="animate-spin text-muted-foreground" /></div>
          : loadError ? <div role="alert" className="space-y-3 p-5 text-sm"><p>Chưa tải được quyền. Không thể chỉnh sửa.</p><Button variant="outline" onClick={() => void loadData()}>Thử lại</Button></div>
            : <>
              <div className="shrink-0 space-y-2 border-b bg-muted/20 px-4 py-3 sm:px-5">
                <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
                  <Input aria-label="Tìm quyền" placeholder="Tìm quyền..." value={search} onChange={event => setSearch(event.target.value)} disabled={saving} />
                  <select aria-label="Lọc quyền" value={filter} onChange={event => setFilter(event.target.value as Filter)} disabled={saving} className="h-10 min-w-0 rounded-md border bg-background px-2 text-sm">
                    <option value="all">Tất cả quyền</option>
                    <option value="custom">Đã tùy chỉnh</option>
                    <option value="allowed">Được phép</option>
                    <option value="blocked">Không được phép</option>
                  </select>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">{visibleCount}/{totalCount} quyền{hasChanges ? ` · ${changedCodes.length} thay đổi chưa lưu` : ""}</p>
              </div>
              <div data-testid="permission-override-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
                {groups.length ? groups.map(group => (
                  <section key={group.group} aria-label={group.group} className="mb-5 last:mb-0">
                    <h3 className="border-y border-primary/10 bg-primary/5 px-2 py-2 text-sm font-semibold text-foreground">{group.group}</h3>
                    <div className="divide-y">
                      {group.permissions.map(perm => (
                        <PermissionRow
                          key={perm.code}
                          code={perm.code}
                          label={perm.label}
                          hasFromRole={hasFromRole(perm.code)}
                          override={overrides.get(perm.code) ?? "default"}
                          effective={isAllowed(perm.code)}
                          disabled={saving}
                          onChange={state => setOverride(perm.code, state)}
                        />
                      ))}
                    </div>
                  </section>
                )) : <p className="py-8 text-center text-sm text-muted-foreground">Không có quyền khớp bộ lọc.</p>}
              </div>
            </>}
        {saveError && <p role="alert" className="shrink-0 border-t border-amber-600/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">{saveError}</p>}
        <DialogFooter className="m-0 shrink-0 px-4 sm:px-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Đóng</Button>
          <Button onClick={() => void handleSave()} disabled={!hasChanges || saving || !ready}>
            {saving && <Icon name="progress_activity" size={15} className="animate-spin" />}Lưu thay đổi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionRow({ code, label, hasFromRole, override, effective, disabled, onChange }: {
  code: string; label: string; hasFromRole: boolean; override: OverrideState; effective: boolean; disabled: boolean; onChange: (state: OverrideState) => void;
}) {
  return (
    <div data-permission-code={code} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium" title={code}>{label}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Theo vai trò: {hasFromRole ? "Có" : "Không"}</span>
          <span className={effective ? "font-medium text-teal-700 dark:text-teal-400" : "text-muted-foreground"}>
            {effective ? "Được phép" : "Không được phép"}
          </span>
        </p>
      </div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] rounded-md border bg-muted/30 p-0.5 sm:w-[236px]">
        {([
          { value: "default", label: "Theo vai trò" },
          { value: "grant", label: "Cấp" },
          { value: "revoke", label: "Chặn" },
        ] as const).map(option => (
          <label key={option.value} className={cn(
            "relative flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded px-2 text-xs font-medium",
            disabled && "cursor-not-allowed opacity-50",
            override === option.value && (option.value === "grant"
              ? "bg-teal-600 text-white" : option.value === "revoke"
                ? "bg-rose-600 text-white" : "bg-background text-foreground shadow-sm"),
          )}>
            <input type="radio" name={`override-${code}`} value={option.value} checked={override === option.value} disabled={disabled} onChange={() => onChange(option.value)} className="peer sr-only" />
            <span className="break-words peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
