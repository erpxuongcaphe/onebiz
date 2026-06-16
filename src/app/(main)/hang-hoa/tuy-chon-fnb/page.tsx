"use client";

/**
 * Cài đặt FnB — Modifier Groups & Options.
 * CEO 01/06/2026 — Sprint 2.2.
 *
 * Quản lý "tuỳ chọn món FnB": Size, Mức đường, Mức đá, Topping...
 * Mỗi group có rule (single_required/single/multi) + list options.
 *
 * Pattern: gần giống /hang-hoa/nhom — list + dialog CRUD, expand row
 * để xem/sửa options.
 */

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  listModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  listModifierOptions,
  createModifierOption,
  updateModifierOption,
  deleteModifierOption,
  seedFnbVnPreset,
  type ModifierGroup,
  type ModifierOption,
  type ModifierRule,
  type ModifierChannel,
} from "@/lib/services/supabase/modifier-groups";

const RULE_LABEL: Record<ModifierRule, string> = {
  single_required: "Chọn 1 — bắt buộc (vd Size)",
  single: "Chọn 1 — tuỳ chọn (vd Mức đường)",
  multi: "Chọn nhiều (vd Topping)",
};
const RULE_BADGE: Record<ModifierRule, string> = {
  single_required: "bg-status-error/10 text-status-error",
  single: "bg-status-info/10 text-status-info",
  multi: "bg-status-success/10 text-status-success",
};

export default function ModifierFnbPage() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [optionsByGroup, setOptionsByGroup] = useState<Record<string, ModifierOption[]>>({});
  const [loadingOptions, setLoadingOptions] = useState<Record<string, boolean>>({});

  const [groupDialog, setGroupDialog] = useState<{
    open: boolean;
    editing: ModifierGroup | null;
  }>({ open: false, editing: null });
  const [optionDialog, setOptionDialog] = useState<{
    open: boolean;
    groupId: string | null;
    editing: ModifierOption | null;
  }>({ open: false, groupId: null, editing: null });

  // ── Load groups ──
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listModifierGroups();
      setGroups(list);
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi tải nhóm tuỳ chọn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Load options of one group when expanded ──
  const loadOptions = useCallback(
    async (groupId: string) => {
      if (optionsByGroup[groupId]) return; // cached
      setLoadingOptions((prev) => ({ ...prev, [groupId]: true }));
      try {
        const list = await listModifierOptions(groupId);
        setOptionsByGroup((prev) => ({ ...prev, [groupId]: list }));
      } catch (err) {
        toast({
          variant: "error",
          title: "Lỗi tải options",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
        });
      } finally {
        setLoadingOptions((prev) => ({ ...prev, [groupId]: false }));
      }
    },
    [optionsByGroup, toast],
  );

  function toggleExpand(groupId: string) {
    if (expandedId === groupId) {
      setExpandedId(null);
    } else {
      setExpandedId(groupId);
      void loadOptions(groupId);
    }
  }

  // ── Handlers ──
  const [seeding, setSeeding] = useState(false);

  async function handleSeedPreset() {
    if (
      !window.confirm(
        "Tạo sẵn 4 nhóm tuỳ chọn chuẩn FnB Việt:\n\n" +
          "• Size (M / L / XL — bắt buộc)\n" +
          "• Mức đường (0 / 30 / 50 / 70 / 100% — scale BOM)\n" +
          "• Mức đá (Không / Ít / Vừa / Nhiều)\n" +
          "• Topping (rỗng — anh tự thêm sau vì cần link NVL)\n\n" +
          "Nhóm nào đã có sẽ được bỏ qua, không trùng.\n" +
          "Anh có thể sửa/xoá sau khi tạo. Tiếp tục?",
      )
    )
      return;
    setSeeding(true);
    try {
      const result = await seedFnbVnPreset();
      const parts: string[] = [];
      if (result.groupsCreated > 0)
        parts.push(`tạo ${result.groupsCreated} nhóm + ${result.optionsCreated} options`);
      if (result.groupsSkipped > 0) parts.push(`bỏ qua ${result.groupsSkipped} nhóm đã có`);
      toast({
        variant: "success",
        title: result.groupsCreated > 0 ? "Đã tạo bộ tuỳ chọn mẫu" : "Không có gì mới",
        description: parts.join(", ") || "Tất cả nhóm tuỳ chọn mẫu đã tồn tại",
      });
      await refresh();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi tạo bộ tuỳ chọn mẫu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSeeding(false);
    }
  }

  function openCreateGroup() {
    setGroupDialog({ open: true, editing: null });
  }
  function openEditGroup(g: ModifierGroup) {
    setGroupDialog({ open: true, editing: g });
  }
  async function handleDeleteGroup(g: ModifierGroup) {
    if (!window.confirm(`Xoá nhóm "${g.name}"? Tất cả options bên trong cũng bị xoá.`)) return;
    try {
      await deleteModifierGroup(g.id);
      toast({ variant: "success", title: "Đã xoá", description: `Xoá nhóm "${g.name}".` });
      await refresh();
    } catch (err) {
      toast({
        variant: "error",
        title: "Không xoá được",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
      });
    }
  }

  function openCreateOption(groupId: string) {
    setOptionDialog({ open: true, groupId, editing: null });
  }
  function openEditOption(groupId: string, o: ModifierOption) {
    setOptionDialog({ open: true, groupId, editing: o });
  }
  async function handleDeleteOption(o: ModifierOption) {
    if (!window.confirm(`Xoá option "${o.label}"?`)) return;
    try {
      await deleteModifierOption(o.id);
      // Reload options for that group
      const list = await listModifierOptions(o.groupId);
      setOptionsByGroup((prev) => ({ ...prev, [o.groupId]: list }));
      toast({ variant: "success", title: "Đã xoá", description: `Xoá option "${o.label}".` });
    } catch (err) {
      toast({
        variant: "error",
        title: "Không xoá được",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Tuỳ chọn món FnB"
        subtitle="Quản lý nhóm tuỳ chọn (Size, Mức đường, Mức đá, Topping...) — gắn vào nhóm SP hoặc SP riêng để hiện trên POS FnB."
        actions={[
          {
            label: seeding ? "Đang tạo..." : "Tạo bộ tuỳ chọn mẫu",
            icon: <Icon name="auto_awesome" size={18} />,
            variant: "outline",
            onClick: handleSeedPreset,
            disabled: seeding,
          },
          {
            label: "Tạo nhóm tuỳ chọn",
            icon: <Icon name="add" size={18} />,
            onClick: openCreateGroup,
          },
        ]}
      />

      {/* Empty state hint — gợi ý click preset */}
      {!loading && groups.length === 0 && (
        <div className="rounded-lg border border-status-info/30 bg-status-info/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <Icon name="lightbulb" size={18} className="text-status-info shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-status-info">Mới setup quán cà phê?</p>
              <p className="text-xs text-muted-foreground">
                Bấm <span className="font-semibold">"Tạo bộ tuỳ chọn mẫu"</span> ở góc trên để tự sinh sẵn 4 nhóm chuẩn (Size + Mức đường + Mức đá + Topping). Sau đó vào trang <a href="/hang-hoa/nhom" className="text-primary underline">Nhóm hàng</a> để gán cho từng nhóm SP — tất cả món trong nhóm sẽ tự thừa kế.
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Icon name="progress_activity" size={24} className="mr-2 animate-spin" />
          Đang tải...
        </div>
      ) : groups.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
          <Icon name="tune" size={36} className="text-muted-foreground" />
          <p className="text-sm font-medium">Chưa có nhóm tuỳ chọn nào</p>
          <p className="text-xs text-muted-foreground">
            Bấm "Tạo nhóm tuỳ chọn" để thêm Size, Mức đường, Topping...
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const expanded = expandedId === g.id;
            const opts = optionsByGroup[g.id] ?? [];
            const loadingOpts = loadingOptions[g.id];
            return (
              <div key={g.id} className="rounded-xl border bg-card">
                {/* Group row */}
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(g.id)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <Icon name={expanded ? "expand_more" : "chevron_right"} size={20} className="text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{g.name}</h3>
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", RULE_BADGE[g.rule])}>
                          {RULE_LABEL[g.rule].split(" — ")[0]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {g.optionCount ?? 0} option{(g.optionCount ?? 0) !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{RULE_LABEL[g.rule]}</p>
                    </div>
                  </button>
                  <Button variant="outline" size="sm" onClick={() => openEditGroup(g)}>
                    <Icon name="edit" size={14} className="mr-1" />
                    Sửa
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteGroup(g)} className="text-status-error hover:bg-status-error/10">
                    <Icon name="delete" size={14} />
                  </Button>
                </div>

                {/* Expanded options */}
                {expanded && (
                  <div className="border-t bg-muted/30 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-medium">Options trong "{g.name}"</h4>
                      <Button size="sm" onClick={() => openCreateOption(g.id)}>
                        <Icon name="add" size={14} className="mr-1" />
                        Thêm option
                      </Button>
                    </div>
                    {loadingOpts ? (
                      <p className="py-2 text-xs text-muted-foreground">Đang tải options...</p>
                    ) : opts.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        Chưa có option nào. Bấm "Thêm option" để thêm.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {opts.map((o) => (
                          <div key={o.id} className="flex items-center gap-2 rounded-md bg-card p-2 text-sm">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{o.label}</span>
                                {o.isDefault && (
                                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                    mặc định
                                  </span>
                                )}
                                {o.priceDelta > 0 && (
                                  <span className="text-xs text-status-success">+{formatCurrency(o.priceDelta)}</span>
                                )}
                                {o.scaleFactor !== null && (
                                  <span className="text-xs text-status-info">scale × {o.scaleFactor}</span>
                                )}
                                {o.linkedProductName && (
                                  <span className="text-xs text-muted-foreground">→ {o.linkedProductCode} {o.linkedProductName}</span>
                                )}
                              </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => openEditOption(g.id, o)}>
                              <Icon name="edit" size={12} />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteOption(o)} className="text-status-error hover:bg-status-error/10">
                              <Icon name="delete" size={12} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dialogs */}
      {groupDialog.open && (
        <GroupDialog
          editing={groupDialog.editing}
          onClose={() => setGroupDialog({ open: false, editing: null })}
          onSuccess={refresh}
        />
      )}
      {optionDialog.open && optionDialog.groupId && (
        <OptionDialog
          groupId={optionDialog.groupId}
          editing={optionDialog.editing}
          onClose={() => setOptionDialog({ open: false, groupId: null, editing: null })}
          onSuccess={async () => {
            if (optionDialog.groupId) {
              const list = await listModifierOptions(optionDialog.groupId);
              setOptionsByGroup((prev) => ({ ...prev, [optionDialog.groupId!]: list }));
              // Also refresh count
              await refresh();
            }
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Group dialog
// ════════════════════════════════════════════════════════════════
function GroupDialog({
  editing,
  onClose,
  onSuccess,
}: {
  editing: ModifierGroup | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(editing?.name ?? "");
  const [rule, setRule] = useState<ModifierRule>(editing?.rule ?? "single");
  const [channel, setChannel] = useState<ModifierChannel>(editing?.channel ?? "fnb");
  const [sortOrder, setSortOrder] = useState(editing?.sortOrder ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast({ variant: "warning", title: "Thiếu tên", description: "Vui lòng nhập tên nhóm." });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateModifierGroup(editing.id, { name, rule, channel, sortOrder });
        toast({ variant: "success", title: "Đã lưu", description: `Cập nhật "${name}".` });
      } else {
        await createModifierGroup({ name, rule, channel, sortOrder });
        toast({ variant: "success", title: "Đã tạo", description: `Tạo nhóm "${name}".` });
      }
      await onSuccess();
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa nhóm tuỳ chọn" : "Tạo nhóm tuỳ chọn"}</DialogTitle>
          <DialogDescription>
            Vd: "Mức đường" (chọn 1), "Topping" (chọn nhiều), "Size" (chọn 1 bắt buộc).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Tên nhóm *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Mức đường"
              maxLength={80}
            />
          </div>
          <div>
            <Label>Quy tắc chọn *</Label>
            <select
              value={rule}
              onChange={(e) => setRule(e.target.value as ModifierRule)}
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="single_required">Chọn 1 — bắt buộc (vd Size)</option>
              <option value="single">Chọn 1 — tuỳ chọn (vd Mức đường)</option>
              <option value="multi">Chọn nhiều (vd Topping)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kênh áp dụng</Label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as ModifierChannel)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="fnb">FnB (đồ uống)</option>
                <option value="retail">Retail</option>
                <option value="all">Cả 2</option>
              </select>
            </div>
            <div>
              <Label>Thứ tự</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name="save" size={16} className="mr-2" />
            )}
            {editing ? "Cập nhật" : "Tạo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════
// Option dialog
// ════════════════════════════════════════════════════════════════
function OptionDialog({
  groupId,
  editing,
  onClose,
  onSuccess,
}: {
  groupId: string;
  editing: ModifierOption | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState(editing?.label ?? "");
  const [priceDelta, setPriceDelta] = useState(editing?.priceDelta ?? 0);
  const [scaleFactor, setScaleFactor] = useState<string>(
    editing?.scaleFactor !== null && editing?.scaleFactor !== undefined ? String(editing.scaleFactor) : "",
  );
  const [linkedCode, setLinkedCode] = useState(editing?.linkedProductCode ?? "");
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);
  const [sortOrder, setSortOrder] = useState(editing?.sortOrder ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!label.trim()) {
      toast({ variant: "warning", title: "Thiếu tên", description: "Vui lòng nhập tên option." });
      return;
    }
    setSaving(true);
    try {
      // Resolve linkedProductId từ linkedCode (lookup products by code)
      let linkedProductId: string | null | undefined = undefined;
      if (linkedCode.trim()) {
        const { getClient } = await import("@/lib/services/supabase/base");
        const supabase = getClient();
        const { data } = await supabase
          .from("products")
          .select("id")
          .eq("code", linkedCode.trim())
          .maybeSingle();
        if (!data) {
          toast({
            variant: "warning",
            title: "Không tìm thấy mã SP",
            description: `Mã "${linkedCode.trim()}" không có trong hàng hoá. Kiểm tra lại.`,
          });
          setSaving(false);
          return;
        }
        linkedProductId = data.id;
      } else if (editing?.linkedProductId) {
        linkedProductId = null; // user cleared
      }

      const parsedScale = scaleFactor.trim() ? parseFloat(scaleFactor) : null;
      const input = {
        label,
        priceDelta,
        scaleFactor: parsedScale !== null && !isNaN(parsedScale) ? parsedScale : null,
        linkedProductId,
        isDefault,
        sortOrder,
      };
      if (editing) {
        await updateModifierOption(editing.id, input);
        toast({ variant: "success", title: "Đã lưu", description: `Cập nhật "${label}".` });
      } else {
        await createModifierOption(groupId, input);
        toast({ variant: "success", title: "Đã tạo", description: `Tạo option "${label}".` });
      }
      await onSuccess();
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu option",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa option" : "Thêm option"}</DialogTitle>
          <DialogDescription>
            Vd: "70%" (scale 0.7 cho Mức đường), "Trân châu đen" (+7,000, link NVL-TPV-001).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Tên option *</Label>
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: 70%, Trân châu đen, Size L..."
              maxLength={80}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phí cộng (đ)</Label>
              <Input
                type="number"
                value={priceDelta || ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setPriceDelta(Number.isFinite(n) ? n : 0);
                }}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Scale BOM (×)</Label>
              <Input
                type="number"
                step="0.01"
                value={scaleFactor}
                onChange={(e) => setScaleFactor(e.target.value)}
                placeholder="VD: 0.7"
              />
            </div>
          </div>
          <div>
            <Label>Mã SP liên kết (NVL/topping)</Label>
            <Input
              value={linkedCode}
              onChange={(e) => setLinkedCode(e.target.value)}
              placeholder="VD: NVL-TPV-001"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Topping cần điền — POS sẽ trừ tồn của mã này khi cashier chọn.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="size-4"
              />
              Mặc định
            </label>
            <div>
              <Label>Thứ tự</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name="save" size={16} className="mr-2" />
            )}
            {editing ? "Cập nhật" : "Tạo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
