"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/lib/contexts/toast-context";
import {
  listPrintTemplates,
  createPrintTemplate,
  updatePrintTemplate,
  setDefaultPrintTemplate,
  deletePrintTemplate,
  duplicatePrintTemplate,
  getResolvedBrand,
} from "@/lib/services";
import type {
  PrintChannel,
  PrintDocType,
  PrintPaperSize,
  PrintTemplateConfig,
  PrintTemplate,
  ResolvedBrand,
} from "@/lib/services";
import { buildVietQrUrl } from "@/lib/vietqr";

// ──────────────────────────────────────────────────────────────
// Hằng số nhãn (Tiếng Việt có dấu)
// ──────────────────────────────────────────────────────────────
const CHANNEL_OPTIONS: { value: PrintChannel; label: string }[] = [
  { value: "retail", label: "Bán lẻ" },
  { value: "wholesale", label: "Bán sỉ" },
  { value: "fnb", label: "F&B (quán)" },
  { value: "backoffice", label: "Kho / Mua / Tài chính" },
];

const DOC_TYPE_LABELS: Record<PrintDocType, string> = {
  sale_invoice: "Hóa đơn bán",
  sales_order: "Đơn đặt hàng bán",
  sale_return: "Phiếu trả hàng bán",
  kitchen_ticket: "Phiếu chế biến (bếp/bar)",
  purchase_order: "Đơn đặt hàng nhập",
  goods_receipt: "Phiếu nhập hàng",
  input_invoice: "Hóa đơn đầu vào",
  purchase_return: "Phiếu trả hàng nhập",
  internal_sale: "Phiếu bán nội bộ",
  internal_export: "Phiếu xuất nội bộ",
  inventory_check: "Phiếu kiểm kho",
  disposal: "Phiếu xuất hủy",
  production_order: "Lệnh sản xuất",
  cash_voucher: "Phiếu thu / chi",
};

// 2 THẾ GIỚI GIẤY tách biệt (CEO 25/06): F&B = bill nhiệt 80/58mm (máy in bill);
// Bán lẻ / Sỉ / Kho / Xưởng / Tài chính = chứng từ A4/A5 (máy in laser/phun).
// Khổ giấy gắn theo MẢNG, KHÔNG cho chọn lung tung giữa 2 thế giới.
function paperSizesForChannel(channel: PrintChannel): PrintPaperSize[] {
  return channel === "fnb" ? ["80mm", "58mm"] : ["A4", "A5"];
}
function defaultPaperForChannel(channel: PrintChannel): PrintPaperSize {
  return channel === "fnb" ? "80mm" : "A4";
}
/** Nhãn thế giới giấy để hiển thị rõ "đang in cho ai". */
function paperWorldLabel(channel: PrintChannel): string {
  return channel === "fnb" ? "Khổ bill nhiệt (máy in bill)" : "Khổ chứng từ (máy in A4/A5)";
}

// ── 2 THẾ GIỚI IN (CEO 25/06): chọn thế giới TRƯỚC, rồi mới tới mảng/loại ──
type PrintWorld = "document" | "thermal";
const WORLD_META: Record<PrintWorld, { label: string; sub: string; icon: string }> = {
  document: { label: "In chứng từ", sub: "A4 / A5 · bán lẻ · sỉ · kho · xưởng", icon: "description" },
  thermal: { label: "In bill nhiệt", sub: "80 / 58mm · quán F&B", icon: "receipt_long" },
};
function worldForChannel(c: PrintChannel): PrintWorld {
  return c === "fnb" ? "thermal" : "document";
}
function channelsForWorld(w: PrintWorld): PrintChannel[] {
  return w === "thermal" ? ["fnb"] : ["retail", "wholesale", "backoffice"];
}

const SALES_DOC_TYPES: PrintDocType[] = [
  "sale_invoice",
  "sales_order",
  "sale_return",
];

const BACKOFFICE_DOC_TYPES: PrintDocType[] = [
  "purchase_order",
  "goods_receipt",
  "input_invoice",
  "purchase_return",
  "internal_sale",
  "internal_export",
  "inventory_check",
  "disposal",
  "production_order",
  "cash_voucher",
];

/** Loại chứng từ hợp lệ theo từng mảng. */
function docTypesForChannel(channel: PrintChannel): PrintDocType[] {
  switch (channel) {
    case "retail":
    case "wholesale":
      return SALES_DOC_TYPES;
    case "fnb":
      return [...SALES_DOC_TYPES, "kitchen_ticket"];
    case "backoffice":
      return BACKOFFICE_DOC_TYPES;
  }
}

/** Các chứng từ có khối khách hàng. */
const CUSTOMER_DOC_TYPES: PrintDocType[] = [
  "sale_invoice",
  "sales_order",
  "sale_return",
];

// ── Cấu hình cột bảng mặt hàng theo nhóm chứng từ ──
type ColumnOption = { key: string; label: string };

const SALE_COLUMNS: ColumnOption[] = [
  { key: "name", label: "Tên hàng" },
  { key: "qty", label: "SL" },
  { key: "price", label: "Đơn giá" },
  { key: "discount", label: "Giảm giá" },
  { key: "total", label: "Thành tiền" },
];

const PURCHASE_COLUMNS: ColumnOption[] = [
  { key: "code", label: "Mã hàng" },
  { key: "name", label: "Tên hàng" },
  { key: "qty", label: "SL" },
  { key: "unitPrice", label: "Đơn giá nhập" },
  { key: "total", label: "Thành tiền" },
];

const STOCK_COLUMNS: ColumnOption[] = [
  { key: "name", label: "Tên hàng" },
  { key: "qty", label: "SL" },
  { key: "unit", label: "ĐVT" },
  { key: "systemQty", label: "SL hệ thống" },
  { key: "actualQty", label: "SL thực" },
  { key: "diff", label: "Lệch" },
];

const SALE_GROUP: PrintDocType[] = [
  "sale_invoice",
  "sales_order",
  "sale_return",
  "kitchen_ticket",
];
const PURCHASE_GROUP: PrintDocType[] = [
  "purchase_order",
  "goods_receipt",
  "input_invoice",
  "purchase_return",
];
const STOCK_GROUP: PrintDocType[] = [
  "inventory_check",
  "disposal",
  "internal_export",
  "internal_sale",
  "production_order",
];

/** Danh sách cột khả dụng cho loại chứng từ. cash_voucher → không có bảng mặt hàng. */
function columnsForDocType(docType: PrintDocType): ColumnOption[] {
  if (SALE_GROUP.includes(docType)) return SALE_COLUMNS;
  if (PURCHASE_GROUP.includes(docType)) return PURCHASE_COLUMNS;
  if (STOCK_GROUP.includes(docType)) return STOCK_COLUMNS;
  return [];
}

const FONT_SIZE_OPTIONS: { value: "sm" | "md" | "lg"; label: string }[] = [
  { value: "sm", label: "Nhỏ" },
  { value: "md", label: "Vừa" },
  { value: "lg", label: "Lớn" },
];

// ── Cờ nhóm toggle (Đầu trang / Khách hàng / Thanh toán / Chân trang) ──
const HEADER_FLAGS: { key: keyof NonNullable<PrintTemplateConfig["header"]>; label: string }[] = [
  { key: "logo", label: "Logo" },
  { key: "businessName", label: "Tên DN" },
  { key: "taxCode", label: "MST" },
  { key: "address", label: "Địa chỉ" },
  { key: "branch", label: "Chi nhánh" },
  { key: "phone", label: "Điện thoại" },
];

const CUSTOMER_FLAGS: { key: keyof NonNullable<PrintTemplateConfig["customer"]>; label: string }[] = [
  { key: "name", label: "Tên khách" },
  { key: "code", label: "Mã khách" },
  { key: "phone", label: "Điện thoại" },
  { key: "address", label: "Địa chỉ" },
];

const PAYMENT_FLAGS: { key: keyof NonNullable<PrintTemplateConfig["payment"]>; label: string }[] = [
  { key: "showQr", label: "QR chuyển khoản" },
  { key: "showDiscount", label: "Giảm giá" },
  { key: "showDebt", label: "Công nợ" },
];

const FOOTER_BOOL_FLAGS: { key: "signature" | "thankYou"; label: string }[] = [
  { key: "signature", label: "Ô chữ ký" },
  { key: "thankYou", label: "Lời cảm ơn" },
];

const ALL_BRANCHES = "__all__";

// ──────────────────────────────────────────────────────────────
// Toggle nội tuyến — y phong cách trang Cài đặt in
// ──────────────────────────────────────────────────────────────
function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
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

// ──────────────────────────────────────────────────────────────
// Component chính
// ──────────────────────────────────────────────────────────────
/**
 * Quản lý mẫu in.
 *
 * - KHÔNG truyền props → giữ hành vi cũ: tự cho chọn thế giới + mảng + loại
 *   chứng từ + chi nhánh (backward compat).
 * - Truyền `fixedChannel` + `fixedDocType` → ngữ cảnh CỐ ĐỊNH (đã chọn ở nav
 *   master–detail bên trái). Khi đó ẨN bộ chọn "thế giới" + dropdown "Mảng" +
 *   dropdown "Loại chứng từ", chỉ còn dropdown "Chi nhánh" + danh sách + editor.
 */
export function PrintTemplateManager(props?: {
  fixedChannel?: PrintChannel;
  fixedDocType?: PrintDocType;
}) {
  const { branches } = useAuth();
  const { toast } = useToast();

  // Ngữ cảnh cố định khi cả mảng + loại chứng từ được truyền từ nav trái.
  const fixedContext =
    props?.fixedChannel != null && props?.fixedDocType != null;

  // ── Bộ chọn ngữ cảnh ──
  const [channel, setChannel] = useState<PrintChannel>(
    props?.fixedChannel ?? "retail",
  );
  const [branchId, setBranchId] = useState<string | null>(null);
  const [docType, setDocType] = useState<PrintDocType>(
    props?.fixedDocType ?? "sale_invoice",
  );

  // Khi nav trái đổi mục (channel/docType cố định đổi) → đồng bộ state nội bộ.
  useEffect(() => {
    if (props?.fixedChannel != null) setChannel(props.fixedChannel);
  }, [props?.fixedChannel]);
  useEffect(() => {
    if (props?.fixedDocType != null) setDocType(props.fixedDocType);
  }, [props?.fixedDocType]);

  // ── Danh sách mẫu ──
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Dialog editor ──
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const availableDocTypes = useMemo(() => docTypesForChannel(channel), [channel]);
  // Thế giới in suy ra từ mảng (F&B = bill nhiệt; còn lại = chứng từ).
  const world = worldForChannel(channel);
  const channelOptionsForWorld = useMemo(
    () => CHANNEL_OPTIONS.filter((c) => channelsForWorld(world).includes(c.value)),
    [world],
  );

  // Khi đổi mảng: nếu docType hiện tại không còn hợp lệ → reset về cái đầu.
  // Ngữ cảnh cố định (nav master–detail) tự quản channel/docType → bỏ qua.
  useEffect(() => {
    if (fixedContext) return;
    if (!availableDocTypes.includes(docType)) {
      setDocType(availableDocTypes[0]);
    }
  }, [availableDocTypes, docType, fixedContext]);

  // ── Load danh sách mẫu theo ngữ cảnh ──
  const reloadList = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPrintTemplates({ channel, docType, branchId });
      setTemplates(rows);
    } catch (err) {
      toast({
        title: "Lỗi tải danh sách mẫu in",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [channel, docType, branchId, toast]);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  // ── Hành động trên 1 mẫu ──
  const handleSetDefault = useCallback(
    async (tpl: PrintTemplate) => {
      try {
        await setDefaultPrintTemplate(tpl.id);
        toast({ title: "Đã đặt làm mẫu mặc định", variant: "success" });
        await reloadList();
      } catch (err) {
        toast({
          title: "Lỗi đặt mặc định",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    },
    [toast, reloadList],
  );

  const handleDuplicate = useCallback(
    async (tpl: PrintTemplate) => {
      try {
        await duplicatePrintTemplate(tpl.id);
        toast({ title: "Đã nhân bản mẫu", variant: "success" });
        await reloadList();
      } catch (err) {
        toast({
          title: "Lỗi nhân bản mẫu",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    },
    [toast, reloadList],
  );

  const handleDelete = useCallback(
    async (tpl: PrintTemplate) => {
      if (
        !window.confirm(
          `Xóa mẫu "${tpl.name}"? Khi in sẽ quay về mẫu mặc định của hệ thống.`,
        )
      ) {
        return;
      }
      try {
        await deletePrintTemplate(tpl.id);
        toast({ title: "Đã xóa mẫu", variant: "success" });
        await reloadList();
      } catch (err) {
        toast({
          title: "Lỗi xóa mẫu",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    },
    [toast, reloadList],
  );

  const openCreate = useCallback(() => {
    setEditId(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((tpl: PrintTemplate) => {
    setEditId(tpl.id);
    setEditorOpen(true);
  }, []);

  const branchLabel = useCallback(
    (id: string | null) => {
      if (!id) return "Tất cả chi nhánh";
      return branches.find((b) => b.id === id)?.name ?? id;
    },
    [branches],
  );

  return (
    <div className="space-y-4">
      {/* Banner: làm rõ mẫu in là TÙY CHỌN nâng cao (PM 25/06) — giảm áp lực nhân viên */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
        <Icon name="info" className="mt-0.5 shrink-0 text-blue-500" size={18} />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Mẫu in là tùy chọn nâng cao.</span>{" "}
          Đa số trường hợp chỉ cần điền <span className="font-medium">Thông tin in</span> + chọn{" "}
          <span className="font-medium">Máy in</span> là hệ thống đã in đẹp sẵn. Chỉ tạo mẫu khi
          muốn tùy biến riêng (đổi tiêu đề, ẩn/hiện cột, khổ giấy đặc biệt…).
        </p>
      </div>

      {/* ── Bộ chọn ngữ cảnh ──
          Ngữ cảnh cố định (nav master–detail): ẨN thế giới + Mảng + Loại,
          chỉ còn dropdown Chi nhánh. Ngược lại: giữ nguyên bộ chọn đầy đủ. */}
      {fixedContext ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon name="storefront" />
              Chi nhánh áp dụng
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:max-w-xs">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Chi nhánh</label>
                <Select
                  value={branchId ?? ALL_BRANCHES}
                  onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? null : (v ?? null))}
                  items={[
                    { value: ALL_BRANCHES, label: "Tất cả chi nhánh" },
                    ...branches.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v) =>
                        !v || v === ALL_BRANCHES
                          ? "Tất cả chi nhánh"
                          : branches.find((b) => b.id === v)?.name ?? "Chọn chi nhánh"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BRANCHES}>Tất cả chi nhánh</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              <Icon name="info" size={12} className="inline-block mr-1 align-text-bottom" />
              Mẫu áp dụng cho: <strong>{CHANNEL_OPTIONS.find((c) => c.value === channel)?.label}</strong>
              {" · "}
              {branchLabel(branchId)}
              {" · "}
              {DOC_TYPE_LABELS[docType]}
            </p>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="tune" />
            Ngữ cảnh in
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* CHỌN THẾ GIỚI IN TRƯỚC — 2 thế giới tách hẳn (CEO 25/06) */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {(["document", "thermal"] as PrintWorld[]).map((w) => {
              const active = world === w;
              const meta = WORLD_META[w];
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => {
                    if (w !== world) setChannel(channelsForWorld(w)[0]);
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <Icon
                    name={meta.icon}
                    className={active ? "text-primary" : "text-muted-foreground"}
                  />
                  <div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        active && "text-primary",
                      )}
                    >
                      {meta.label}
                    </div>
                    <div className="text-xs text-muted-foreground">{meta.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {/* Mảng */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mảng</label>
              <Select
                value={channel}
                onValueChange={(v) => v && setChannel(v as PrintChannel)}
                items={channelOptionsForWorld.map((c) => ({ value: c.value, label: c.label }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v) =>
                      CHANNEL_OPTIONS.find((c) => c.value === v)?.label ?? "Chọn mảng"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {channelOptionsForWorld.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Chi nhánh */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Chi nhánh</label>
              <Select
                value={branchId ?? ALL_BRANCHES}
                onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? null : (v ?? null))}
                items={[
                  { value: ALL_BRANCHES, label: "Tất cả chi nhánh" },
                  ...branches.map((b) => ({ value: b.id, label: b.name })),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v) =>
                      !v || v === ALL_BRANCHES
                        ? "Tất cả chi nhánh"
                        : branches.find((b) => b.id === v)?.name ?? "Chọn chi nhánh"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES}>Tất cả chi nhánh</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Loại chứng từ */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Loại chứng từ</label>
              <Select
                value={docType}
                onValueChange={(v) => v && setDocType(v as PrintDocType)}
                items={availableDocTypes.map((d) => ({
                  value: d,
                  label: DOC_TYPE_LABELS[d],
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v) =>
                      v ? DOC_TYPE_LABELS[v as PrintDocType] : "Chọn loại chứng từ"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableDocTypes.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DOC_TYPE_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <Icon name="info" size={12} className="inline-block mr-1 align-text-bottom" />
            Mẫu áp dụng cho: <strong>{CHANNEL_OPTIONS.find((c) => c.value === channel)?.label}</strong>
            {" · "}
            {branchLabel(branchId)}
            {" · "}
            {DOC_TYPE_LABELS[docType]}
          </p>
        </CardContent>
      </Card>
      )}

      {/* ── Danh sách mẫu ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Icon name="description" />
            Mẫu in của ngữ cảnh
          </CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Icon name="add" size={14} className="mr-1" />
            Tạo mẫu
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Icon name="progress_activity" size={18} className="animate-spin" />
              Đang tải danh sách mẫu...
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed py-10 px-4 text-center">
              <Icon name="print_disabled" size={32} className="text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">
                Chưa có mẫu riêng cho ngữ cảnh này — khi in sẽ dùng mẫu mặc định của hệ thống.
              </p>
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Icon name="add" size={14} className="mr-1" />
                Tạo mẫu
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{tpl.name}</span>
                    <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                      {tpl.paperSize}
                    </span>
                    {tpl.isDefault && (
                      <Badge variant="secondary" className="gap-1">
                        <Icon name="star" size={12} />
                        Mặc định
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <Button size="xs" variant="outline" onClick={() => openEdit(tpl)}>
                      <Icon name="edit" size={14} className="mr-1" />
                      Sửa
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => handleDuplicate(tpl)}>
                      <Icon name="content_copy" size={14} className="mr-1" />
                      Nhân bản
                    </Button>
                    {!tpl.isDefault && (
                      <Button size="xs" variant="ghost" onClick={() => handleSetDefault(tpl)}>
                        <Icon name="star" size={14} className="mr-1" />
                        Đặt mặc định
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => handleDelete(tpl)}>
                      <Icon name="delete" size={14} className="mr-1 text-destructive" />
                      <span className="text-destructive">Xóa</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialog editor ── */}
      {editorOpen && (
        <TemplateEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          editId={editId}
          channel={channel}
          docType={docType}
          branchId={branchId}
          existing={editId ? templates.find((t) => t.id === editId) ?? null : null}
          onSaved={() => {
            setEditorOpen(false);
            void reloadList();
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Dialog editor (create + edit chung)
// ──────────────────────────────────────────────────────────────
function TemplateEditorDialog({
  open,
  onOpenChange,
  editId,
  channel,
  docType,
  branchId,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editId: string | null;
  channel: PrintChannel;
  docType: PrintDocType;
  branchId: string | null;
  existing: PrintTemplate | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();

  const showCustomer = CUSTOMER_DOC_TYPES.includes(docType);
  const columnOptions = useMemo(() => columnsForDocType(docType), [docType]);
  const showItems = columnOptions.length > 0;

  // ── Form state ──
  const [name, setName] = useState("");
  const [paperSize, setPaperSize] = useState<PrintPaperSize>(
    defaultPaperForChannel(channel),
  );
  const [title, setTitle] = useState("");
  const [config, setConfig] = useState<PrintTemplateConfig>({});
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);

  // ── Thông tin thật DN + chi nhánh (chỉ ĐỌC) để xem trước sát bản in thật ──
  const [brand, setBrand] = useState<ResolvedBrand | null>(null);
  const [brandLoading, setBrandLoading] = useState(false);

  // Khi mở dialog: nạp thương hiệu đã resolve (tenant ← override chi nhánh).
  // Chỉ đọc — không set/update/save. Tránh setState sau khi dialog đóng.
  useEffect(() => {
    if (!open) {
      setBrand(null);
      return;
    }
    let alive = true;
    setBrandLoading(true);
    void getResolvedBrand(branchId)
      .then((b) => {
        if (alive) setBrand(b);
      })
      .catch(() => {
        // Không chặn editor nếu nạp thương hiệu lỗi — preview tự fallback.
        if (alive) setBrand(null);
      })
      .finally(() => {
        if (alive) setBrandLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, branchId]);

  // Khởi tạo form khi mở dialog (prefill từ existing nếu edit).
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name);
      setPaperSize(existing.paperSize);
      setTitle(existing.config.title ?? "");
      setConfig(existing.config ?? {});
    } else {
      setName("");
      setPaperSize(defaultPaperForChannel(channel));
      setTitle("");
      // Mặc định bật các trường phổ biến cho mẫu mới.
      setConfig({
        header: {
          logo: true,
          businessName: true,
          taxCode: false,
          address: true,
          branch: true,
          phone: true,
        },
        customer: CUSTOMER_DOC_TYPES.includes(docType)
          ? { name: true, code: false, phone: true, address: false }
          : undefined,
        items: showItems
          ? { fontSize: "md", columns: columnOptions.map((c) => c.key) }
          : undefined,
        payment: { showQr: true, showDiscount: true, showDebt: false },
        footer: { signature: false, thankYou: true, customText: "" },
      });
    }
    setNameError(false);
  }, [open, existing, docType, channel, showItems, columnOptions]);

  // ── Helpers cập nhật cờ lồng nhau ──
  const setHeaderFlag = useCallback(
    (key: keyof NonNullable<PrintTemplateConfig["header"]>, val: boolean) => {
      setConfig((prev) => ({ ...prev, header: { ...prev.header, [key]: val } }));
    },
    [],
  );
  const setCustomerFlag = useCallback(
    (key: keyof NonNullable<PrintTemplateConfig["customer"]>, val: boolean) => {
      setConfig((prev) => ({ ...prev, customer: { ...prev.customer, [key]: val } }));
    },
    [],
  );
  const setPaymentFlag = useCallback(
    (key: keyof NonNullable<PrintTemplateConfig["payment"]>, val: boolean) => {
      setConfig((prev) => ({ ...prev, payment: { ...prev.payment, [key]: val } }));
    },
    [],
  );
  const setFooterBool = useCallback(
    (key: "signature" | "thankYou", val: boolean) => {
      setConfig((prev) => ({ ...prev, footer: { ...prev.footer, [key]: val } }));
    },
    [],
  );
  const setFooterText = useCallback((val: string) => {
    setConfig((prev) => ({ ...prev, footer: { ...prev.footer, customText: val } }));
  }, []);
  const setFontSize = useCallback((val: "sm" | "md" | "lg") => {
    setConfig((prev) => ({ ...prev, items: { ...prev.items, fontSize: val } }));
  }, []);
  const toggleColumn = useCallback((key: string, on: boolean) => {
    setConfig((prev) => {
      const current = prev.items?.columns ?? [];
      const next = on
        ? Array.from(new Set([...current, key]))
        : current.filter((c) => c !== key);
      return { ...prev, items: { ...prev.items, columns: next } };
    });
  }, []);

  const selectedColumns = config.items?.columns ?? [];

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setSaving(true);
    // Gộp tiêu đề override vào config (trim → trống thì bỏ field title).
    const finalConfig: PrintTemplateConfig = {
      ...config,
      title: title.trim() ? title.trim() : undefined,
    };
    try {
      if (editId) {
        await updatePrintTemplate(editId, {
          name: name.trim(),
          paperSize,
          config: finalConfig,
        });
        toast({ title: "Đã cập nhật mẫu in", variant: "success" });
      } else {
        await createPrintTemplate({
          channel,
          docType,
          branchId,
          name: name.trim(),
          paperSize,
          config: finalConfig,
        });
        toast({ title: "Đã tạo mẫu in", variant: "success" });
      }
      onSaved();
    } catch (err) {
      toast({
        title: editId ? "Lỗi cập nhật mẫu" : "Lỗi tạo mẫu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [name, title, config, editId, paperSize, channel, docType, branchId, toast, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-3xl lg:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Sửa mẫu in" : "Tạo mẫu in"}</DialogTitle>
          <DialogDescription>
            {DOC_TYPE_LABELS[docType]} — {CHANNEL_OPTIONS.find((c) => c.value === channel)?.label}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          {/* ── Cột trái: form ── */}
          <div className="space-y-5">
            {/* Tên mẫu */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Tên mẫu <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameError(false);
                }}
                placeholder="VD: Mẫu hóa đơn quán Hai Bà Trưng"
                aria-invalid={nameError}
              />
              {nameError && (
                <p className="text-xs text-destructive">Vui lòng nhập tên mẫu</p>
              )}
            </div>

            {/* Khổ giấy — gắn theo MẢNG (2 thế giới tách biệt) */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{paperWorldLabel(channel)}</label>
              <p className="text-xs text-muted-foreground">
                {channel === "fnb"
                  ? "Quán F&B in bill nhiệt — chỉ 80mm hoặc 58mm."
                  : "Bán lẻ / sỉ / kho / xưởng in chứng từ — chỉ A4 hoặc A5."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {paperSizesForChannel(channel).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPaperSize(p)}
                    className={cn(
                      "rounded-lg border py-2 text-sm font-semibold transition-colors",
                      paperSize === p
                        ? "border-primary bg-primary/5 ring-2 ring-primary"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Tiêu đề override */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tiêu đề phiếu</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Để trống = mặc định theo loại"
                maxLength={60}
              />
            </div>

            {/* Đầu trang */}
            <ToggleGroupBox title="Đầu trang">
              <div className="grid gap-x-6 sm:grid-cols-2 divide-border">
                {HEADER_FLAGS.map((f) => (
                  <Toggle
                    key={f.key}
                    label={f.label}
                    checked={config.header?.[f.key] ?? false}
                    onCheckedChange={(v) => setHeaderFlag(f.key, v)}
                  />
                ))}
              </div>
            </ToggleGroupBox>

            {/* Khách hàng (chỉ khi doc bán có khách) */}
            {showCustomer && (
              <ToggleGroupBox title="Khách hàng">
                <div className="grid gap-x-6 sm:grid-cols-2">
                  {CUSTOMER_FLAGS.map((f) => (
                    <Toggle
                      key={f.key}
                      label={f.label}
                      checked={config.customer?.[f.key] ?? false}
                      onCheckedChange={(v) => setCustomerFlag(f.key, v)}
                    />
                  ))}
                </div>
              </ToggleGroupBox>
            )}

            {/* Mặt hàng (ẩn cho cash_voucher) */}
            {showItems && (
              <ToggleGroupBox title="Mặt hàng">
                <div className="space-y-3">
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Cỡ chữ</p>
                    <div className="inline-flex rounded-lg border p-0.5">
                      {FONT_SIZE_OPTIONS.map((fs) => {
                        const active = (config.items?.fontSize ?? "md") === fs.value;
                        return (
                          <button
                            key={fs.value}
                            type="button"
                            onClick={() => setFontSize(fs.value)}
                            className={cn(
                              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {fs.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Cột hiển thị</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {columnOptions.map((col) => {
                        const checked = selectedColumns.includes(col.key);
                        return (
                          <label
                            key={col.key}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => toggleColumn(col.key, v === true)}
                            />
                            {col.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </ToggleGroupBox>
            )}

            {/* Thanh toán */}
            <ToggleGroupBox title="Thanh toán">
              <div className="grid gap-x-6 sm:grid-cols-2">
                {PAYMENT_FLAGS.map((f) => (
                  <Toggle
                    key={f.key}
                    label={f.label}
                    checked={config.payment?.[f.key] ?? false}
                    onCheckedChange={(v) => setPaymentFlag(f.key, v)}
                  />
                ))}
              </div>
            </ToggleGroupBox>

            {/* Chân trang */}
            <ToggleGroupBox title="Chân trang">
              <div className="space-y-2">
                <div className="grid gap-x-6 sm:grid-cols-2">
                  {FOOTER_BOOL_FLAGS.map((f) => (
                    <Toggle
                      key={f.key}
                      label={f.label}
                      checked={config.footer?.[f.key] ?? false}
                      onCheckedChange={(v) => setFooterBool(f.key, v)}
                    />
                  ))}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Ghi chú / điều khoản
                  </label>
                  <Textarea
                    value={config.footer?.customText ?? ""}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="VD: Cảm ơn quý khách! Hàng đã mua không đổi trả."
                    rows={2}
                  />
                </div>
              </div>
            </ToggleGroupBox>
          </div>

          {/* ── Cột phải: preview ── */}
          <div className="lg:sticky lg:top-0 lg:self-start">
            <p className="mb-2 text-sm font-medium text-muted-foreground">Xem trước</p>
            <BillPreview
              title={title.trim() || DOC_TYPE_LABELS[docType]}
              config={config}
              showCustomer={showCustomer}
              columnOptions={columnOptions}
              selectedColumns={selectedColumns}
              brand={brand}
              brandLoading={brandLoading}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Minh họa khổ 80mm — đầu trang lấy thông tin thật của doanh nghiệp/chi nhánh,
              chỉ phản ánh bật/tắt, không phải bản in cuối.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            )}
            Lưu mẫu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Khối nhóm toggle bo viền ──
function ToggleGroupBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Preview bill 80mm đơn giản — phản ánh toggle
// ──────────────────────────────────────────────────────────────
const SAMPLE_ITEMS: {
  code: string;
  name: string;
  qty: number;
  price: number;
}[] = [
  { code: "CF001", name: "Cà phê sữa", qty: 2, price: 35000 },
  { code: "CF002", name: "Bạc xỉu", qty: 1, price: 39000 },
];

function fmt(n: number): string {
  return n.toLocaleString("vi-VN");
}

function BillPreview({
  title,
  config,
  showCustomer,
  columnOptions,
  selectedColumns,
  brand,
  brandLoading,
}: {
  title: string;
  config: PrintTemplateConfig;
  showCustomer: boolean;
  columnOptions: ColumnOption[];
  selectedColumns: string[];
  brand: ResolvedBrand | null;
  brandLoading: boolean;
}) {
  const header = config.header ?? {};
  const customer = config.customer ?? {};
  const payment = config.payment ?? {};
  const footer = config.footer ?? {};
  const fontSize = config.items?.fontSize ?? "md";

  const cols = columnOptions.filter((c) => selectedColumns.includes(c.key));
  const hasItemsTable = columnOptions.length > 0;

  // ── Nguồn dữ liệu THẬT cho đầu trang (fallback khi chưa có/đang nạp) ──
  const businessName = brand?.businessName?.trim() || "(Chưa đặt tên doanh nghiệp)";
  const taxCode = brand?.taxCode?.trim() || "";
  const address = brand?.address?.trim() || "(chưa có địa chỉ)";
  const phone = brand?.phone?.trim() || "";
  const logoUrl = brand?.logoUrl?.trim() || "";

  // ── QR thật: chỉ in khi đủ cấu hình ngân hàng (mirror logic engine in) ──
  const bankId = brand?.bankBin || brand?.bankCode || "";
  const bankEnough =
    !!brand &&
    brand.vietQrEnabled !== false &&
    Boolean(bankId) &&
    Boolean(brand.bankAccount);
  let qrImageUrl = "";
  if (bankEnough && brand) {
    try {
      qrImageUrl = buildVietQrUrl({
        bank: bankId,
        accountNumber: brand.bankAccount as string,
        accountHolder: brand.bankHolder,
        addInfo: "PB-0001",
        template: "print",
      });
    } catch {
      // Ngân hàng không hỗ trợ → bỏ ảnh QR, vẫn coi như "đã cấu hình".
      qrImageUrl = "";
    }
  }

  const itemTextSize =
    fontSize === "sm" ? "text-[10px]" : fontSize === "lg" ? "text-[13px]" : "text-[11px]";

  const subtotal = SAMPLE_ITEMS.reduce((s, it) => s + it.qty * it.price, 0);

  const cellValue = (key: string, it: (typeof SAMPLE_ITEMS)[number]): string => {
    switch (key) {
      case "code":
        return it.code;
      case "name":
        return it.name;
      case "qty":
        return String(it.qty);
      case "unit":
        return "ly";
      case "price":
      case "unitPrice":
        return fmt(it.price);
      case "discount":
        return "0";
      case "total":
        return fmt(it.qty * it.price);
      case "systemQty":
        return String(it.qty + 1);
      case "actualQty":
        return String(it.qty);
      case "diff":
        return "-1";
      default:
        return "";
    }
  };

  const isNumericCol = (key: string) =>
    ["qty", "price", "unitPrice", "discount", "total", "systemQty", "actualQty", "diff"].includes(
      key,
    );

  return (
    <div className="mx-auto w-full max-w-[260px] rounded-md border bg-white p-3 font-mono text-[11px] leading-tight text-black shadow-sm">
      {/* Đầu trang — dùng THÔNG TIN THẬT của DN/chi nhánh (chỉ đọc) */}
      <div className="text-center">
        {header.logo &&
          (logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo"
              className="mx-auto mb-1 h-8 w-auto max-w-[60px] object-contain"
            />
          ) : (
            <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded bg-gray-200 text-[8px] text-gray-500">
              LOGO
            </div>
          ))}
        {header.businessName && (
          <div className="text-[12px] font-bold uppercase">
            {brandLoading && !brand ? "…" : businessName}
          </div>
        )}
        {header.taxCode &&
          (taxCode ? <div>MST: {taxCode}</div> : <div className="text-gray-400">(chưa có MST)</div>)}
        {header.address && <div>{address}</div>}
        {header.branch && <div>CN: Quán Hai Bà Trưng</div>}
        {header.phone && phone && <div>ĐT: {phone}</div>}
      </div>

      <div className="my-1.5 border-t border-dashed border-gray-400" />

      {/* Tiêu đề */}
      <div className="text-center text-[13px] font-bold uppercase">{title}</div>
      <div className="text-center text-[10px] text-gray-500">Số: PB-0001 · 25/06/2026</div>

      {/* Khách hàng */}
      {showCustomer && (customer.name || customer.code || customer.phone || customer.address) && (
        <>
          <div className="my-1.5 border-t border-dashed border-gray-400" />
          <div className="space-y-0.5">
            {customer.name && <div>KH: Nguyễn Văn A</div>}
            {customer.code && <div>Mã KH: KH00123</div>}
            {customer.phone && <div>ĐT: 0912 345 678</div>}
            {customer.address && <div>ĐC: 45 Lê Lợi, Q.1</div>}
          </div>
        </>
      )}

      {/* Bảng mặt hàng */}
      {hasItemsTable && (
        <>
          <div className="my-1.5 border-t border-dashed border-gray-400" />
          {cols.length > 0 ? (
            <table className={cn("w-full", itemTextSize)}>
              <thead>
                <tr className="border-b border-gray-300">
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "py-0.5 font-semibold",
                        isNumericCol(c.key) ? "text-right" : "text-left",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ITEMS.map((it) => (
                  <tr key={it.code}>
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "py-0.5",
                          isNumericCol(c.key) ? "text-right" : "text-left",
                        )}
                      >
                        {cellValue(c.key, it)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-1 text-center text-[10px] italic text-gray-400">
              (Chưa chọn cột nào)
            </div>
          )}
        </>
      )}

      {/* Tổng + thanh toán */}
      <div className="my-1.5 border-t border-dashed border-gray-400" />
      <div className="space-y-0.5">
        <div className="flex justify-between font-semibold">
          <span>Tổng cộng</span>
          <span>{fmt(subtotal)}</span>
        </div>
        {payment.showDiscount && (
          <div className="flex justify-between text-gray-600">
            <span>Giảm giá</span>
            <span>-0</span>
          </div>
        )}
        {payment.showDebt && (
          <div className="flex justify-between text-gray-600">
            <span>Còn nợ</span>
            <span>0</span>
          </div>
        )}
      </div>

      {payment.showQr &&
        (bankEnough ? (
          <div className="mt-2 flex flex-col items-center">
            {qrImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrImageUrl}
                alt="QR thanh toán"
                className="h-16 w-16 object-contain"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded bg-gray-200 text-[8px] text-gray-500">
                QR
              </div>
            )}
            <div className="text-[9px] text-gray-500">QR thanh toán (đã cấu hình ngân hàng)</div>
          </div>
        ) : (
          <div className="mt-2 rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-[9px] leading-snug text-amber-700">
            Bật QR nhưng chưa cấu hình ngân hàng — QR sẽ KHÔNG in. Vào Cài đặt → Thanh toán để thêm.
          </div>
        ))}

      {/* Chân trang */}
      {(footer.signature || footer.thankYou || footer.customText) && (
        <div className="my-1.5 border-t border-dashed border-gray-400" />
      )}
      {footer.signature && (
        <div className="mt-1 flex justify-between text-[9px] text-gray-600">
          <div className="text-center">
            <div>Người lập</div>
            <div className="mt-4">______</div>
          </div>
          <div className="text-center">
            <div>Người nhận</div>
            <div className="mt-4">______</div>
          </div>
        </div>
      )}
      {footer.customText && (
        <div className="mt-1.5 text-center text-[9px] text-gray-600">{footer.customText}</div>
      )}
      {footer.thankYou && (
        <div className="mt-1 text-center text-[10px] font-medium">Cảm ơn quý khách!</div>
      )}
    </div>
  );
}
