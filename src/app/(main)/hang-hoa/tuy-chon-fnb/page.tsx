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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { LoadErrorState } from "@/components/shared/load-error-state";
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
import { useAuth } from "@/lib/contexts/auth-context";
import { getFnbReadiness, type FnbReadiness } from "@/lib/services/supabase/fnb-readiness";
import { FnbReadinessBand } from "./fnb-readiness-band";
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
  getModifierStockConfigError,
} from "@/lib/services/supabase/modifier-groups";

const RULE_LABEL: Record<ModifierRule, string> = {
  single_required: "Chọn 1 — bắt buộc (vd Size)",
  single: "Chọn 1 — tuỳ chọn (vd Mức đường)",
  multi: "Chọn nhiều (vd Topping)",
};

const CHANNEL_LABEL: Record<ModifierChannel, string> = {
  fnb: "F&B",
  retail: "Bán lẻ",
  all: "Dùng chung",
};

/** Bộ lọc kênh trên thanh công cụ. */
const BO_LOC_KENH: { value: "all_channels" | ModifierChannel; label: string }[] = [
  { value: "all_channels", label: "Tất cả kênh" },
  { value: "fnb", label: "F&B" },
  { value: "retail", label: "Bán lẻ" },
  { value: "all", label: "Dùng chung" },
];

function moTaQuyTac(g: ModifierGroup): string {
  if (g.rule !== "multi") return RULE_LABEL[g.rule];
  if (g.minSelect > 0 && g.maxSelect !== null) {
    return `Chọn từ ${g.minSelect} đến ${g.maxSelect}`;
  }
  if (g.minSelect > 0) return `Chọn ít nhất ${g.minSelect}`;
  if (g.maxSelect !== null) return `Chọn tối đa ${g.maxSelect}`;
  return RULE_LABEL.multi;
}
const RULE_BADGE: Record<ModifierRule, string> = {
  single_required: "bg-status-error/10 text-status-error",
  single: "bg-status-info/10 text-status-info",
  multi: "bg-status-success/10 text-status-success",
};

export default function ModifierFnbPage() {
  const { toast } = useToast();
  const { tenant, activeBranchId, currentBranch } = useAuth();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [readiness, setReadiness] = useState<FnbReadiness | null>(null);
  const [readinessError, setReadinessError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [optionsByGroup, setOptionsByGroup] = useState<Record<string, ModifierOption[]>>({});
  const [loadingOptions, setLoadingOptions] = useState<Record<string, boolean>>({});
  const [optionErrors, setOptionErrors] = useState<Record<string, string>>({});

  // CEO 16/08/2026 (mục B): tìm theo tên nhóm + lọc theo kênh. Trang tên
  // "Tuỳ chọn món FnB" nhưng danh sách gồm cả nhóm Bán lẻ và Dùng chung.
  const [tuKhoa, setTuKhoa] = useState("");
  const [locKenh, setLocKenh] = useState<"all_channels" | ModifierChannel>(
    "all_channels",
  );
  const dangLoc = tuKhoa.trim() !== "" || locKenh !== "all_channels";

  const groupsHienThi = useMemo(() => {
    const tu = tuKhoa.trim().toLowerCase();
    return groups.filter((g) => {
      if (locKenh !== "all_channels" && g.channel !== locKenh) return false;
      if (tu === "") return true;
      return g.name.toLowerCase().includes(tu);
    });
  }, [groups, tuKhoa, locKenh]);

  const xoaBoLoc = useCallback(() => {
    setTuKhoa("");
    setLocKenh("all_channels");
  }, []);

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
  // CEO 16/08/2026: chống kết quả cũ đè kết quả mới. Đổi chi nhánh / bấm Thử
  // lại nhiều lần thì lượt tải trước có thể về sau lượt sau — chỉ lượt mới nhất
  // được phép ghi vào state.
  const loadRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setLoadError(null);
    setReadinessError(false);
    try {
      const readinessPromise = tenant?.id
        ? getFnbReadiness(tenant.id, activeBranchId).catch(() => {
            if (requestId === loadRequestIdRef.current) setReadinessError(true);
            return null;
          })
        : Promise.resolve(null);
      const [list, nextReadiness] = await Promise.all([
        listModifierGroups(),
        readinessPromise,
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      setGroups(list);
      setReadiness(nextReadiness);
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return;
      setLoadError(err instanceof Error ? err.message : "Không tải được nhóm tuỳ chọn.");
      toast({
        variant: "error",
        title: "Lỗi tải nhóm tuỳ chọn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, tenant?.id, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Load options of one group when expanded ──
  const loadOptions = useCallback(
    async (groupId: string) => {
      if (optionsByGroup[groupId]) return; // cached
      setLoadingOptions((prev) => ({ ...prev, [groupId]: true }));
      setOptionErrors((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      try {
        const list = await listModifierOptions(groupId);
        setOptionsByGroup((prev) => ({ ...prev, [groupId]: list }));
      } catch (err) {
        setOptionErrors((prev) => ({
          ...prev,
          [groupId]: err instanceof Error ? err.message : "Không tải được lựa chọn.",
        }));
        toast({
          variant: "error",
          title: "Lỗi tải lựa chọn",
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
      if (result.groupsCreated > 0) {
        const optPart =
          result.optionsCreated > 0 ? ` + ${result.optionsCreated} tuỳ chọn` : "";
        parts.push(`tạo/khôi phục ${result.groupsCreated} nhóm${optPart}`);
      }
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
        searchPlaceholder="Tìm theo tên nhóm tuỳ chọn..."
        searchValue={tuKhoa}
        onSearchChange={setTuKhoa}
        actions={[
          {
            label: seeding ? "Đang tạo..." : "Tạo bộ tuỳ chọn mẫu",
            icon: <Icon name="auto_awesome" size={18} />,
            variant: "outline",
            onClick: handleSeedPreset,
            disabled: seeding || Boolean(loadError),
          },
          {
            label: "Tạo nhóm tuỳ chọn",
            icon: <Icon name="add" size={18} />,
            onClick: openCreateGroup,
            disabled: Boolean(loadError),
          },
        ]}
      />

      <FnbReadinessBand
        readiness={readiness}
        loading={loading}
        error={readinessError}
        branchName={currentBranch?.name}
      />

      {/* Empty state hint — gợi ý click preset */}
      {!loading && !loadError && groups.length === 0 && (
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

      {/* Thanh lọc — chỉ hiện khi đã tải xong và có dữ liệu để lọc */}
      {!loading && !loadError && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Kênh:</span>
          {BO_LOC_KENH.map((muc) => (
            <button
              key={muc.value}
              type="button"
              onClick={() => setLocKenh(muc.value)}
              aria-pressed={locKenh === muc.value}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                locKenh === muc.value
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-outline-variant/40 text-muted-foreground hover:bg-muted",
              )}
            >
              {muc.label}
            </button>
          ))}
          {dangLoc && (
            <>
              <span className="text-xs text-muted-foreground">
                {groupsHienThi.length}/{groups.length} nhóm
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={xoaBoLoc}>
                <Icon name="filter_alt_off" size={14} className="mr-1" />
                Xoá bộ lọc
              </Button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Icon name="progress_activity" size={24} className="mr-2 animate-spin" />
          Đang tải...
        </div>
      ) : loadError ? (
        <LoadErrorState
          title="Không tải được nhóm tuỳ chọn"
          description={`${loadError} Không thể chỉnh sửa cho tới khi tải lại thành công.`}
          onRetry={() => void refresh()}
        />
      ) : groups.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
          <Icon name="tune" size={36} className="text-muted-foreground" />
          <p className="text-sm font-medium">Chưa có nhóm tuỳ chọn nào</p>
          <p className="text-xs text-muted-foreground">
            Bấm "Tạo nhóm tuỳ chọn" để thêm Size, Mức đường, Topping...
          </p>
        </div>
      ) : groupsHienThi.length === 0 ? (
        // Không khớp bộ lọc KHÁC hẳn chưa có dữ liệu — nói rõ để người dùng
        // biết phải xoá bộ lọc chứ không tưởng là mất dữ liệu.
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
          <Icon name="search_off" size={36} className="text-muted-foreground" />
          <p className="text-sm font-medium">Không có nhóm nào khớp bộ lọc</p>
          <p className="text-xs text-muted-foreground">
            Đang có {groups.length} nhóm, nhưng không nhóm nào khớp điều kiện đang chọn.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={xoaBoLoc}>
            <Icon name="filter_alt_off" size={14} className="mr-1" />
            Xoá bộ lọc
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {groupsHienThi.map((g) => {
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
                          {moTaQuyTac(g).split(" — ")[0]}
                        </span>
                        {/* Kênh: trang này liệt kê cả nhóm Bán lẻ và Dùng
                            chung, nên phải nói rõ nhóm nào thuộc kênh nào. */}
                        <span className="inline-flex items-center rounded-full border border-outline-variant/40 px-2 py-0.5 text-xs text-muted-foreground">
                          {CHANNEL_LABEL[g.channel]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {g.optionCount ?? 0} lựa chọn
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{moTaQuyTac(g)}</p>
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
                      <h4 className="text-sm font-medium">Lựa chọn trong "{g.name}"</h4>
                      <Button size="sm" onClick={() => openCreateOption(g.id)}>
                        <Icon name="add" size={14} className="mr-1" />
                        Thêm lựa chọn
                      </Button>
                    </div>
                    {loadingOpts ? (
                      <p className="py-2 text-xs text-muted-foreground">Đang tải lựa chọn...</p>
                    ) : optionErrors[g.id] ? (
                      <div className="flex items-center justify-between gap-3 rounded-md border border-status-error/30 bg-status-error/5 p-3">
                        <p className="text-xs text-status-error">
                          Không tải được lựa chọn. Dữ liệu hiện có không bị thay đổi.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadOptions(g.id)}
                        >
                          <Icon name="refresh" size={14} className="mr-1" />
                          Thử lại
                        </Button>
                      </div>
                    ) : opts.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        Chưa có lựa chọn nào. Bấm "Thêm lựa chọn" để thêm.
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
                                  <span className="text-xs text-status-info">hệ số × {o.scaleFactor}</span>
                                )}
                                {o.linkedProductName && (
                                  <span className="text-xs text-muted-foreground">→ {o.linkedProductCode} {o.linkedProductName}</span>
                                )}
                                {o.scaleFactor !== null && o.linkedProductId && (
                                  <span className="text-xs font-medium text-status-error">
                                    Cấu hình trừ kho bị trùng
                                  </span>
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
  const [minSelect, setMinSelect] = useState(editing?.minSelect ?? 0);
  const [maxSelect, setMaxSelect] = useState<string>(
    editing?.maxSelect === null || editing?.maxSelect === undefined
      ? ""
      : String(editing.maxSelect),
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast({ variant: "warning", title: "Thiếu tên", description: "Vui lòng nhập tên nhóm." });
      return;
    }
    const parsedMax = maxSelect.trim() === "" ? null : Number(maxSelect);
    if (
      rule === "multi" &&
      (!Number.isInteger(minSelect) ||
        minSelect < 0 ||
        (parsedMax !== null &&
          (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax < minSelect)))
    ) {
      toast({
        variant: "warning",
        title: "Giới hạn chưa hợp lệ",
        description: "Số tối thiểu phải từ 0; số tối đa phải lớn hơn hoặc bằng số tối thiểu.",
      });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateModifierGroup(editing.id, {
          name,
          rule,
          channel,
          sortOrder,
          minSelect: rule === "multi" ? minSelect : 0,
          maxSelect: rule === "multi" ? parsedMax : null,
        });
        toast({ variant: "success", title: "Đã lưu", description: `Cập nhật "${name}".` });
      } else {
        await createModifierGroup({
          name,
          rule,
          channel,
          sortOrder,
          minSelect: rule === "multi" ? minSelect : 0,
          maxSelect: rule === "multi" ? parsedMax : null,
        });
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
          {rule === "multi" && (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
              <div>
                <Label>Chọn tối thiểu</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={minSelect}
                  onChange={(e) => setMinSelect(Number.parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <Label>Chọn tối đa</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={maxSelect}
                  onChange={(e) => setMaxSelect(e.target.value)}
                  placeholder="Không giới hạn"
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Để trống tối đa nếu nhân viên được chọn không giới hạn.
              </p>
            </div>
          )}
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
      // Resolve linkedProductId theo đúng tenant hiện tại.
      let linkedProductId: string | null | undefined = undefined;
      if (linkedCode.trim()) {
        const { getClient, getCurrentTenantId } = await import("@/lib/services/supabase/base");
        const supabase = getClient();
        const tenantId = await getCurrentTenantId();
        const { data } = await supabase
          .from("products")
          .select("id")
          .eq("tenant_id", tenantId)
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
      const configError = getModifierStockConfigError(input);
      if (configError) {
        toast({
          variant: "warning",
          title: "Cách trừ kho chưa đúng",
          description: configError,
        });
        return;
      }
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
        title: "Lỗi lưu lựa chọn",
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
          <DialogTitle>{editing ? "Sửa lựa chọn" : "Thêm lựa chọn"}</DialogTitle>
          <DialogDescription>
            Dùng hệ số cho thành phần đã có trong công thức, hoặc trừ thẳng một mã hàng. Không dùng cả hai.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Tên lựa chọn *</Label>
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
              <Label>Hệ số công thức (×)</Label>
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
            <Label>Mã hàng trừ trực tiếp</Label>
            <Input
              value={linkedCode}
              onChange={(e) => setLinkedCode(e.target.value)}
              placeholder="VD: NVL-TPV-001"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Mỗi lần chọn sẽ trừ trực tiếp 1 đơn vị của mã này. Không điền cho mức đường/đá dùng hệ số công thức.
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
