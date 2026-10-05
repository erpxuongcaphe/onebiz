"use client";

import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";
import { applyTemplateToDocData } from "@/lib/print-apply-template";

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
import { buildKitchenTicketHtml } from "@/lib/print-fnb";
import { PrintHtmlPreview } from "@/components/shared/print-html-preview";
import { buildCashTransactionPrintData } from "@/lib/print-templates";

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
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-none transition-transform",
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
        footer: { signature: true, thankYou: true, customText: "" },
        signatures: [{ label: "Người lập phiếu" }, { label: "Người duyệt" }],
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
  // ── Ô ký tùy biến ──
  const sigList = (c: PrintTemplateConfig): { label: string }[] =>
    c.signatures ?? [{ label: "Người lập phiếu" }, { label: "Người duyệt" }];
  const addSignature = useCallback(() => {
    setConfig((prev) => ({ ...prev, signatures: [...sigList(prev), { label: "Ô ký mới" }] }));
  }, []);
  const removeSignature = useCallback((idx: number) => {
    setConfig((prev) => ({ ...prev, signatures: sigList(prev).filter((_, i) => i !== idx) }));
  }, []);
  const setSignatureLabel = useCallback((idx: number, label: string) => {
    setConfig((prev) => ({
      ...prev,
      signatures: sigList(prev).map((s, i) => (i === idx ? { label } : s)),
    }));
  }, []);
  const moveSignature = useCallback((idx: number, dir: -1 | 1) => {
    setConfig((prev) => {
      const arr = [...sigList(prev)];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...prev, signatures: arr };
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
            {docType === "kitchen_ticket" ? <>
              <ToggleGroupBox title="Bố cục phiếu bếp">
                <p className="text-sm text-muted-foreground mb-2">Bàn, số lượng, topping, tùy chọn và yêu cầu pha chế luôn được giữ trên phiếu.</p>
                <div className="flex flex-wrap gap-2">
                  {([{value:"compact",label:"Gọn"},{value:"standard",label:"Tiêu chuẩn"},{value:"detailed",label:"Chi tiết · có giá"}] as const).map(option => <Button key={option.value} type="button"
                    variant={(config.kitchen?.style ?? "standard") === option.value ? "default" : "outline"}
                    onClick={() => setConfig(c => ({...c,kitchen:{...c.kitchen,style:option.value}}))}>{option.label}</Button>)}
                </div>
                <p className="text-sm font-medium mt-3 mb-2">Cỡ chữ tên món</p>
                <div className="flex gap-2">{FONT_SIZE_OPTIONS.map(option => <Button key={option.value} type="button"
                  variant={(config.items?.fontSize ?? "md") === option.value ? "default" : "outline"}
                  onClick={() => setFontSize(option.value)}>{option.label}</Button>)}</div>
              </ToggleGroupBox>
              <ToggleGroupBox title="Chân phiếu bếp">
                <label className="text-sm font-medium" htmlFor="kitchen-template-footer">Ghi chú cố định</label>
                <Textarea id="kitchen-template-footer" value={config.footer?.customText ?? ""} onChange={e => setFooterText(e.target.value)} rows={2} maxLength={300}
                  placeholder="VD: Kiểm tra yêu cầu riêng trước khi giao món" />
              </ToggleGroupBox>
            </> : <>
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
                        const mandatory = ["name", "qty", "total"].includes(col.key);
                        const checked = mandatory || selectedColumns.includes(col.key);
                        return (
                          <label
                            key={col.key}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={mandatory}
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
            {["sale_invoice", "sales_order", "sale_return", "internal_sale", "input_invoice", "purchase_order"].includes(docType) && <ToggleGroupBox title="Thanh toán">
              <div className="grid gap-x-6 sm:grid-cols-2">
                {PAYMENT_FLAGS.filter(() => ["sale_invoice", "sales_order", "sale_return", "internal_sale", "input_invoice", "purchase_order"].includes(docType)).map((f) => (
                  <Toggle
                    key={f.key}
                    label={f.label}
                    checked={config.payment?.[f.key] ?? false}
                    onCheckedChange={(v) => setPaymentFlag(f.key, v)}
                  />
                ))}
              </div>
            </ToggleGroupBox>

            }
            {/* Chân trang */}
            <ToggleGroupBox title="Chân trang">
              <div className="space-y-2">
                <div className="grid gap-x-6 sm:grid-cols-2">
                  {FOOTER_BOOL_FLAGS.filter(f => f.key !== "signature" || (paperSize !== "58mm" && paperSize !== "80mm")).map((f) => (
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

                {/* Ô ký tùy biến — hiện khi bật "Ô chữ ký" */}
                {config.footer?.signature && paperSize !== "58mm" && paperSize !== "80mm" && (
                  <div className="space-y-1.5 rounded-lg border p-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Ô ký cuối phiếu</label>
                      <Button type="button" size="sm" variant="outline" onClick={addSignature}>
                        <Icon name="add" size={14} className="mr-1" />
                        Thêm ô ký
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {(config.signatures ?? [
                        { label: "Người lập phiếu" },
                        { label: "Người duyệt" },
                      ]).map((s, i, arr) => (
                        <div key={i} className="flex items-center gap-1">
                          <Input
                            value={s.label}
                            onChange={(e) => setSignatureLabel(i, e.target.value)}
                            placeholder="VD: Thủ kho, Kế toán, Khách hàng…"
                            className="flex-1"
                          />
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={() => moveSignature(i, -1)}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                            aria-label="Lên"
                          >
                            <Icon name="keyboard_arrow_up" size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={i === arr.length - 1}
                            onClick={() => moveSignature(i, 1)}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                            aria-label="Xuống"
                          >
                            <Icon name="keyboard_arrow_down" size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSignature(i)}
                            className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10"
                            aria-label="Xoá ô ký"
                          >
                            <Icon name="close" size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Các ô ký để trống để ký tay. Dùng nút lên/xuống để đổi thứ tự.
                    </p>
                  </div>
                )}
              </div>
            </ToggleGroupBox>
            </>}
          </div>

          {/* ── Cột phải: preview ── */}
          <div className="lg:sticky lg:top-0 lg:self-start">
            <div role="note" className="mb-2 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">Xem trước · dữ liệu minh họa</p>
              <p>Món, số phiếu, bàn và thời gian trong bản xem trước là ví dụ, không phải giao dịch thật.</p>
            </div>
            <BillPreview
              docType={docType}
              title={title.trim() || DOC_TYPE_LABELS[docType]}
              config={config}
              showCustomer={showCustomer}
              columnOptions={columnOptions}
              selectedColumns={selectedColumns}
              brand={brand}
              brandLoading={brandLoading}
              paperSize={paperSize}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {docType === "kitchen_ticket"
                ? `Phiếu bếp minh họa khổ ${paperSize} — bàn, số lượng và yêu cầu pha chế được ưu tiên.`
                : `Minh họa khổ ${paperSize} — đầu trang lấy thông tin doanh nghiệp/chi nhánh; dùng cùng bộ dựng HTML với bản in thật; dữ liệu giao dịch là ví dụ.`}
            </p>
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 border-t bg-background py-3">
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
function BillPreview({
  docType,
  title,
  config,
  showCustomer,
  columnOptions,
  selectedColumns,
  brand,
  brandLoading,
  paperSize = "80mm",
}: {
  docType: PrintDocType;
  title: string;
  config: PrintTemplateConfig;
  showCustomer: boolean;
  columnOptions: ColumnOption[];
  selectedColumns: string[];
  brand: ResolvedBrand | null;
  brandLoading: boolean;
  paperSize?: PrintPaperSize;
}) {
  if (docType === "kitchen_ticket") {
    const html = buildKitchenTicketHtml({
      orderNumber: "KB-DEMO-001",
      tableName: "Bàn 5",
      orderType: "dine_in",
      stationName: "BAR PHA CHẾ",
      createdAt: "2026-10-05T10:30:00+07:00",
      paperSize: paperSize === "58mm" ? "58mm" : "80mm",
      style: config.kitchen?.style ?? "standard",
      title,
      itemFontSize: config.items?.fontSize,
      footerText: config.footer?.customText,
      items: [
        { name: "Cà phê sữa đá", variant: "Size L", quantity: 2, unitPrice: 35000,
          modifierLabels: ["Đường: 70%", "Đá: ít"], note: "Pha nhạt, đá riêng" },
        { name: "Bạc xỉu", quantity: 1, unitPrice: 32000 },
      ],
    });
    return <div className="grid gap-2">
      <p role="note" className="border-l-4 border-status-warning bg-status-warning/10 px-3 py-2 text-sm">
        Mẫu mặc định của chi nhánh được áp dụng khi gửi bếp và in lại từ KDS. Nếu chi nhánh chưa có mẫu, hệ thống dùng mẫu chung; nếu chưa có mẫu chung hoặc đang offline, dùng kiểu phiếu ở Máy in &amp; vận hành.
      </p>
      <PrintHtmlPreview title="Phiếu bếp minh họa" html={html} paperSize={paperSize === "58mm" ? "58mm" : "80mm"} />
    </div>;
  }
  const base: DocumentPrintData = {
    documentType: title, documentCode: docType === "cash_voucher" ? "PT-DEMO-001" : "HD-DEMO-001", date: "2026-10-06T10:30:00+07:00",
    businessName: brand?.businessName || "(Chưa đặt tên doanh nghiệp)", businessAddress: brand?.address, businessPhone: brand?.phone,
    createdBy: "Nhân viên minh họa", showSignature: true, branchName: "Chi nhánh minh họa",
    headerFields: docType === "cash_voucher" ? [{label:"Người nộp / nhận",value:"Nguyễn Văn An"},{label:"Nội dung",value:"Thu tiền thanh toán hóa đơn"},{label:"Phương thức",value:"Tiền mặt"}] : [...(showCustomer ? [{label:"Khách hàng",value:"Nguyễn Văn An"},{label:"Mã KH",value:"KH-DEMO"},{label:"Điện thoại",value:"0900000000"},{label:"Địa chỉ",value:"Địa chỉ minh họa"}] : [])],
    items: columnOptions.length ? [{code:"CF001",name:"Cà phê sữa đá",quantity:2,unitPrice:35000,total:70000,note:"Size L • Đường: 70% • Đá: ít"},{code:"CF002",name:"Bạc xỉu",quantity:1,unitPrice:39000,total:39000,note:"Pha nhạt"}] : undefined,
    itemColumns: ["Mã hàng","Tên hàng","SL","Đơn giá","Thành tiền","Ghi chú"],
    summaryRows: docType === "cash_voucher" ? [{label:"Số tiền",value:"109.000 đ",bold:true}] : [{label:"Tạm tính",value:"109.000 đ"},{label:"Giảm giá",value:"9.000 đ"},{label:"Tổng thanh toán",value:"100.000 đ",bold:true},{label:"Đã thanh toán",value:"80.000 đ"},{label:"Khách còn phải trả",value:"20.000 đ",bold:true}],
  };
  const previewBase = docType === "cash_voucher" ? {...base,...buildCashTransactionPrintData({
    id:"cash-demo",code:"PT-DEMO-001",type:"receipt",typeName:"Thu tiền",date:"2026-10-06",occurredAt:"2026-10-06T10:30:00+07:00",createdAt:"2026-10-06T10:31:00+07:00",
    category:"Thanh toán hóa đơn",counterparty:"Nguyễn Văn An",amount:109000,createdBy:"demo",createdByName:"Nhân viên minh họa",note:"Dữ liệu minh họa — không phải phiếu thu thật.",
  })} : base;
  const rendered = applyTemplateToDocData(previewBase, {config:{...config,title,items:{...config.items,columns:selectedColumns}},brand:brand ?? {}});
  const html = generateDocumentHtml(rendered, paperSize ?? "80mm");
  return <div className="space-y-2">
    {brandLoading && <p className="text-sm text-muted-foreground">Đang tải thông tin thương hiệu…</p>}
    <PrintHtmlPreview title="Bản in minh họa từ bộ dựng bản in thật" html={html} paperSize={paperSize ?? "80mm"} />
  </div>;
}
