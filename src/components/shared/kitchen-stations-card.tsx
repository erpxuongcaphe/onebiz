"use client";

/**
 * KitchenStationsCard — Quản lý Trạm chế biến (Sprint KITCHEN-1, CEO 07/05).
 *
 * CRUD station per branch: thêm / sửa tên / đổi màu / đổi icon / xoá.
 * Hỗ trợ:
 *   - Toggle is_active (tạm dừng station không xoá)
 *   - Toggle auto_print, show_on_kds per-station
 *   - Custom header text + size
 *   - Color picker 8 màu predefined
 *   - Icon picker subset Material Symbols phù hợp FnB
 *   - HelpTip cho mọi setting
 *
 * Sort_order: stations xuất hiện theo thứ tự trong UI + KDS + phiếu in.
 */

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useAuth, useToast } from "@/lib/contexts";
import { HelpTip } from "@/components/shared/help-tip";
import {
  getKitchenStationsByBranch,
  createKitchenStation,
  updateKitchenStation,
  deleteKitchenStation,
  type KitchenStation,
  type KitchenStationSettings,
} from "@/lib/services/supabase/kitchen-stations";
import { getBranches } from "@/lib/services/supabase/branches";
import type { BranchDetail } from "@/lib/services/supabase/branches";

// 8 màu predefined cho station badge — đủ phân biệt visually trong KDS
const COLOR_PALETTE = [
  { hex: "#2563eb", name: "Xanh dương" },
  { hex: "#16a34a", name: "Xanh lá" },
  { hex: "#f59e0b", name: "Cam" },
  { hex: "#dc2626", name: "Đỏ" },
  { hex: "#9333ea", name: "Tím" },
  { hex: "#0891b2", name: "Xanh ngọc" },
  { hex: "#db2777", name: "Hồng" },
  { hex: "#475569", name: "Xám" },
];

// Icon Material Symbols phổ biến cho station FnB
const ICON_PRESETS = [
  { name: "local_cafe", label: "Cà phê" },
  { name: "local_drink", label: "Nước uống" },
  { name: "emoji_food_beverage", label: "Trà" },
  { name: "blender", label: "Sinh tố / xay" },
  { name: "icecream", label: "Kem / sữa" },
  { name: "restaurant", label: "Bếp" },
  { name: "outdoor_grill", label: "Bếp nướng" },
  { name: "bakery_dining", label: "Bánh ngọt" },
  { name: "lunch_dining", label: "Set ăn" },
  { name: "soup_kitchen", label: "Bếp lỏng" },
  { name: "ramen_dining", label: "Mì / phở" },
  { name: "kitchen", label: "Bếp tổng" },
];

interface KitchenStationsCardProps {
  /** Override branchId — mặc định lấy currentBranch từ useAuth. */
  branchId?: string;
}

export function KitchenStationsCard({ branchId: branchIdProp }: KitchenStationsCardProps) {
  const { currentBranch } = useAuth();
  const { toast } = useToast();
  const branchId = branchIdProp ?? currentBranch?.id;

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | undefined>(branchId);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<KitchenStation | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<KitchenStation | null>(null);

  const reload = useCallback(async () => {
    if (!selectedBranchId) {
      setStations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getKitchenStationsByBranch(selectedBranchId);
      setStations(data);
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi tải trạm",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Load branches list cho dropdown switch giữa các quán
  useEffect(() => {
    let cancelled = false;
    getBranches()
      .then((list) => {
        if (cancelled) return;
        // Chỉ filter branch type "store" cho FnB (không hiện kho/xưởng)
        const stores = list.filter(
          (b) => b.branchType === "store" || !b.branchType,
        );
        setBranches(stores);
        // Auto select default branch nếu chưa có
        if (!selectedBranchId && stores.length > 0) {
          setSelectedBranchId(stores.find((b) => b.isDefault)?.id ?? stores[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBranchId]);

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await deleteKitchenStation(deleting.id);
      toast({
        variant: "success",
        title: "Đã xoá trạm",
        description: `${deleting.name} (categories đã gán giữ tham chiếu cho audit, không in nữa).`,
      });
      setDeleting(null);
      reload();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi xoá",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    }
  }, [deleting, toast, reload]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="ramen_dining" />
            Trạm chế biến (Bar / Bếp / Quầy bánh)
            <HelpTip>
              Mỗi quán có 1+ trạm chế biến. Khi nhân viên gửi bếp, hệ thống
              tự động <strong>chia phiếu theo trạm</strong>: VD đơn có cà phê
              + bánh → Bar in 1 phiếu drink, Quầy bánh in 1 phiếu food.
              <br />
              Mỗi danh mục SP gán vào 1 trạm tại trang <strong>Hàng hoá → Nhóm hàng</strong>.
              <br />
              Mặc định mỗi quán có sẵn trạm <em>"Bar pha chế"</em> sau migration.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch selector — chỉ hiện nếu user có nhiều branch FnB */}
          {branches.length > 1 && (
            <div className="space-y-1">
              <Label className="text-sm font-medium flex items-center gap-1">
                Chi nhánh
                <HelpTip>
                  Mỗi quán có danh sách trạm riêng. Đổi để xem/sửa trạm cho
                  từng quán. Trạm KHÔNG share giữa các quán — quán A có "Bar"
                  + "Bếp", quán B có thể chỉ có "Bar".
                </HelpTip>
              </Label>
              <select
                value={selectedBranchId ?? ""}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full max-w-sm h-9 px-3 rounded-lg border border-input bg-background text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code ? `${b.code} — ${b.name}` : b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Station list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Icon name="progress_activity" className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : stations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Icon name="ramen_dining" size={36} className="text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">
                Chưa có trạm chế biến cho quán này.
              </p>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Icon name="add" size={14} className="mr-1" />
                Tạo trạm đầu tiên
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {stations.map((s) => (
                <StationRow
                  key={s.id}
                  station={s}
                  onEdit={() => setEditing(s)}
                  onDelete={() => setDeleting(s)}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreating(true)}
                className="w-full mt-3"
              >
                <Icon name="add" size={14} className="mr-1" />
                Thêm trạm
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      {creating && selectedBranchId && (
        <StationDialog
          mode="create"
          branchId={selectedBranchId}
          existingCount={stations.length}
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {/* Edit dialog */}
      {editing && (
        <StationDialog
          mode="edit"
          station={editing}
          branchId={editing.branchId}
          existingCount={stations.length}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Xoá trạm “{deleting.name}”?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Trạm sẽ bị tạm dừng (soft-delete, is_active=false). Categories
              đã gán vào trạm này sẽ KHÔNG còn in tự động — anh nên gán lại
              vào trạm khác trước khi xoá.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Đóng
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                Xoá
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Station row ──

function StationRow({
  station,
  onEdit,
  onDelete,
}: {
  station: KitchenStation;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const settings = station.settings;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary/50 transition-colors">
      {/* Color + icon badge */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ring-2 ring-white"
        style={{ backgroundColor: station.color, color: "#fff" }}
      >
        <Icon name={station.icon} size={22} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{station.name}</span>
          <span className="text-xs text-muted-foreground">#{station.sortOrder}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {settings.auto_print !== false && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-status-success/10 text-status-success">
              <Icon name="print" size={12} />
              Tự in
            </span>
          )}
          {settings.show_on_kds !== false && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-status-info/10 text-status-info">
              <Icon name="monitor" size={12} />
              KDS
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} title="Sửa">
          <Icon name="edit" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-status-error hover:text-status-error hover:bg-status-error/10"
          onClick={onDelete}
          title="Xoá"
        >
          <Icon name="delete" size={14} />
        </Button>
      </div>
    </div>
  );
}

// ── Station dialog (create + edit) ──

function StationDialog({
  mode,
  station,
  branchId,
  existingCount,
  onClose,
  onSuccess,
}: {
  mode: "create" | "edit";
  station?: KitchenStation;
  branchId: string;
  existingCount: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(station?.name ?? "");
  const [color, setColor] = useState(station?.color ?? COLOR_PALETTE[0].hex);
  const [icon, setIcon] = useState(station?.icon ?? ICON_PRESETS[0].name);
  const [sortOrder, setSortOrder] = useState(station?.sortOrder ?? existingCount + 1);
  const [autoPrint, setAutoPrint] = useState(station?.settings.auto_print ?? true);
  const [showOnKds, setShowOnKds] = useState(station?.settings.show_on_kds ?? true);
  const [headerText, setHeaderText] = useState(station?.settings.header_text ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      toast({
        variant: "error",
        title: "Thiếu tên trạm",
        description: "Nhập tên trước khi lưu.",
      });
      return;
    }
    setSaving(true);
    try {
      const settings: KitchenStationSettings = {
        auto_print: autoPrint,
        show_on_kds: showOnKds,
        ...(headerText.trim() ? { header_text: headerText.trim() } : {}),
      };
      if (mode === "create") {
        await createKitchenStation({
          branchId,
          name: name.trim(),
          sortOrder,
          color,
          icon,
          settings,
        });
        toast({
          variant: "success",
          title: "Đã tạo trạm",
          description: `${name} sẽ xuất hiện trên POS + KDS từ giờ.`,
        });
      } else if (station) {
        await updateKitchenStation(station.id, {
          name: name.trim(),
          sortOrder,
          color,
          icon,
          settings,
        });
        toast({
          variant: "success",
          title: "Đã cập nhật trạm",
        });
      }
      onSuccess();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu trạm",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSaving(false);
    }
  }, [
    mode,
    station,
    branchId,
    name,
    color,
    icon,
    sortOrder,
    autoPrint,
    showOnKds,
    headerText,
    onSuccess,
    toast,
  ]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Thêm trạm chế biến" : `Sửa: ${station?.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Tên trạm
              <HelpTip>
                Nhập tên ngắn gọn nhân viên dễ hiểu. VD: "Bar pha chế",
                "Bếp nóng", "Quầy bánh ngọt", "Bếp lạnh / salad".
              </HelpTip>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Bar pha chế"
              autoFocus
              maxLength={50}
            />
          </div>

          {/* Color picker */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Màu badge
              <HelpTip>
                Màu hiển thị trên KDS + phiếu in để bar/bếp dễ phân biệt
                trạm trong giờ peak. Mỗi trạm chọn 1 màu khác nhau.
              </HelpTip>
            </Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setColor(c.hex)}
                  className={cn(
                    "w-10 h-10 rounded-xl ring-2 transition-all",
                    color === c.hex ? "ring-foreground scale-110" : "ring-transparent",
                  )}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Icon picker */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Icon
              <HelpTip>
                Biểu tượng hiển thị cùng tên trạm. Chọn icon phù hợp loại
                chế biến để staff nhận biết nhanh.
              </HelpTip>
            </Label>
            <div className="grid grid-cols-6 gap-2">
              {ICON_PRESETS.map((i) => (
                <button
                  key={i.name}
                  type="button"
                  onClick={() => setIcon(i.name)}
                  className={cn(
                    "h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 ring-2 transition-all",
                    icon === i.name
                      ? "ring-primary bg-primary/5"
                      : "ring-transparent bg-surface-container hover:bg-surface-container-high",
                  )}
                  title={i.label}
                >
                  <Icon name={i.name} size={18} className={icon === i.name ? "text-primary" : ""} />
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <ToggleRow
              checked={autoPrint}
              onCheckedChange={setAutoPrint}
              label="Tự động in phiếu"
              helpTip="Khi nhân viên gửi bếp, phiếu của trạm này tự in ngay. Tắt nếu trạm chỉ dùng KDS không in giấy (vd quán nhỏ ít người, bar chỉ xem màn hình)."
            />
            <ToggleRow
              checked={showOnKds}
              onCheckedChange={setShowOnKds}
              label="Hiển thị trên KDS"
              helpTip="Hiện đơn của trạm này trên màn hình bếp /pos/fnb/kds. Tắt nếu trạm chỉ in giấy không có màn hình."
            />
          </div>

          {/* Header text custom */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Header phiếu in (tuỳ chọn)
              <HelpTip>
                Text in LỚN ở đầu phiếu. Để trống = dùng tên trạm in hoa.
                VD: "BAR — KHẨN" để alert bar pha nhanh.
              </HelpTip>
            </Label>
            <Input
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder={`Mặc định: ${name.toUpperCase() || "TÊN TRẠM"}`}
              maxLength={40}
            />
          </div>

          {/* Sort order */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Thứ tự sắp xếp
              <HelpTip>
                Số nhỏ hơn xuất hiện trước trên UI + KDS. Mặc định #1, #2,
                #3... theo thứ tự tạo.
              </HelpTip>
            </Label>
            <Input
              type="number"
              min={1}
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 1)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Đóng
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? "Đang lưu..." : mode === "create" ? "Tạo trạm" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Toggle helper inline ──

function ToggleRow({
  checked,
  onCheckedChange,
  label,
  helpTip,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  helpTip?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium flex items-center">
        {label}
        {helpTip && <HelpTip>{helpTip}</HelpTip>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
