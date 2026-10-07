"use client";

import { useSettings } from "@/lib/contexts/settings-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useId } from "react";
import { Icon } from "@/components/ui/icon";
import {
  requestPrinter,
  isWebUsbSupported,
  loadPrinterByRole,
  savePrinterByRole,
  clearPrinterByRole,
  isSamePrinterAcrossRoles,
  type StoredPrinter,
  type PrinterRole,
} from "@/lib/printer";
import { useToast } from "@/lib/contexts/toast-context";
import { HelpTip } from "@/components/shared/help-tip";
import { BusinessLogoUpload } from "@/components/shared/business-logo-upload";
import { BranchPrintInfoCard } from "@/components/shared/branch-print-info-card";
import { PrintSetupChecklist } from "@/components/shared/print-setup-checklist";
import { BranchPrintSetup } from "@/components/shared/branch-print-setup";
import { KitchenStationsCard } from "@/components/shared/kitchen-stations-card";
import { BridgePrinterSetup } from "@/components/shared/bridge-printer-setup";
import { PrinterTestPreview } from "@/components/shared/printer-test-preview";
import { sendPrintJob, getPrintSettings } from "@/lib/printer/print-job";
import { generateDocumentHtml, type PaperSize } from "@/lib/print-document";
import { ReceiptPreviewPanel } from "@/components/shared/receipt-preview-panel";
import { PrintTemplateManager } from "@/components/shared/print-template-manager";
import {
  getTenantBusinessInfo,
  updateTenantBusinessInfo,
} from "@/lib/services";
import type { InvoiceFieldFlags } from "@/lib/print-templates";
import type { PrintChannel, PrintDocType } from "@/lib/services";
import Link from "next/link";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";

// ── Bật/tắt từng dòng thông tin trên phiếu bán (CEO 24/06) ──
const INVOICE_FIELD_GROUPS: {
  title: string;
  items: { key: keyof InvoiceFieldFlags; label: string }[];
}[] = [
  {
    title: "Bên bán (xưởng / cửa hàng)",
    items: [
      { key: "logo", label: "Logo" },
      { key: "businessName", label: "Tên doanh nghiệp" },
      { key: "taxCode", label: "Mã số thuế (MST)" },
      { key: "address", label: "Địa chỉ" },
      { key: "phone", label: "Điện thoại" },
      { key: "branch", label: "Chi nhánh" },
    ],
  },
  {
    title: "Bên mua (khách hàng)",
    items: [
      { key: "customerName", label: "Tên khách hàng" },
      { key: "customerCode", label: "Mã khách hàng" },
      { key: "customerPhone", label: "Điện thoại khách" },
      { key: "customerAddress", label: "Địa chỉ khách" },
    ],
  },
  {
    title: "Khác",
    items: [
      { key: "createdBy", label: "Người tạo phiếu" },
      { key: "signature", label: "Ô chữ ký (Người lập / Người duyệt)" },
      { key: "debt", label: "Khối công nợ (Nợ cũ / Còn nợ)" },
      { key: "footer", label: "Lời cảm ơn / chân phiếu" },
    ],
  },
];

// ── Toggle component ──
function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  helpTip,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  description?: string;
  /** Sprint FIX-1: optional HelpTip content (string or JSX) — bấm icon i để xem hướng dẫn. */
  helpTip?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {helpTip && <HelpTip>{helpTip}</HelpTip>}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        aria-label={label}
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden="true" className={cn("relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors", checked ? "bg-primary" : "bg-muted")}>
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-none transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
        </span>
      </button>
    </div>
  );
}

// ── Paper size templates ──
const templates = [
  { id: "58mm" as const, label: "58mm", desc: "Máy in bill nhỏ" },
  { id: "80mm" as const, label: "80mm", desc: "Máy in bill tiêu chuẩn" },
  { id: "A4" as const, label: "A4", desc: "In giấy A4" },
  { id: "A5" as const, label: "A5", desc: "In giấy A5" },
];

// ── Kitchen ticket styles ──
const kitchenStyles = [
  { id: "compact" as const, label: "Gọn", desc: "Đủ thông tin pha chế, ít khoảng cách" },
  { id: "standard" as const, label: "Tiêu chuẩn", desc: "Đủ thông tin pha chế, dễ đọc" },
  { id: "detailed" as const, label: "Chi tiết", desc: "Đủ thông tin pha chế và giá" },
];

// ── Receipt styles ──
const receiptStyles = [
  { id: "minimal" as const, label: "Tối giản", desc: "Chỉ tổng tiền + thanh toán" },
  { id: "standard" as const, label: "Tiêu chuẩn", desc: "Món + giá + thanh toán" },
  { id: "full" as const, label: "Đầy đủ", desc: "Đầy đủ + topping + giảm giá + QR" },
];

// ── Print backends ──
const backends = [
  {
    id: "qz-tray" as const,
    label: "Qua QZ Tray trên máy quầy",
    desc: "Chọn máy đã cài driver: USB, LAN, Wi-Fi hoặc Bluetooth. Cần ứng dụng QZ Tray chạy trên cùng máy tính và cấp quyền in.",
    icon: "desktop_windows" as const,
  },
  {
    id: "browser" as const,
    label: "Qua trình duyệt",
    desc: "Dùng máy in đã cài driver hoặc được hệ điều hành hỗ trợ (USB / LAN / Wi-Fi / AirPrint). Chọn máy trong hộp thoại in; in thử đúng thiết bị trước khi dùng.",
    icon: "print" as const,
  },
  {
    id: "escpos-usb" as const,
    label: "Máy in nhiệt USB (ESC/POS)",
    desc: "In trực tiếp tới máy nhiệt ESC/POS tương thích WebUSB. Phải in thử đúng model; driver đang giữ cổng USB có thể gây lỗi.",
    icon: "bolt" as const,
  },
];

// ── Cài đặt In V3 — master–detail kiểu KiotViet (CEO 30/06) ──
// Nav trái = danh sách nhóm + mục; nội dung phải đổi theo `selected`.
// Mục có channel+docType → render <PrintTemplateManager> ngữ cảnh cố định.
type NavItem = {
  id: string;
  label: string;
  icon: string;
  channel?: PrintChannel;
  docType?: PrintDocType;
};
type NavGroup = {
  label: string;
  /** Icon + màu nhấn cho cả nhóm (gắn vào icon từng mục để phân biệt mảng). */
  accent?: "info" | "amber";
  items: NavItem[];
};

const PRINT_NAV: NavGroup[] = [
  {
    label: "Thông tin chung",
    items: [
      { id: "doanh-nghiep", label: "Doanh nghiệp", icon: "store" },
      { id: "chi-nhanh", label: "Thông tin chi nhánh", icon: "location_on" },
    ],
  },
  {
    label: "In chứng từ — Bán lẻ / Sỉ / Kho (A4/A5)",
    accent: "info",
    items: [
      { id: "ret-sale_invoice", label: "Hóa đơn bán", icon: "description", channel: "retail", docType: "sale_invoice" },
      { id: "ret-sales_order", label: "Đơn đặt hàng", icon: "description", channel: "retail", docType: "sales_order" },
      { id: "ret-sale_return", label: "Phiếu trả hàng bán", icon: "description", channel: "retail", docType: "sale_return" },
      { id: "bo-goods_receipt", label: "Phiếu nhập hàng", icon: "description", channel: "backoffice", docType: "goods_receipt" },
      { id: "bo-input_invoice", label: "Hóa đơn đầu vào", icon: "description", channel: "backoffice", docType: "input_invoice" },
      { id: "bo-purchase_order", label: "Đơn đặt hàng nhập", icon: "description", channel: "backoffice", docType: "purchase_order" },
      { id: "bo-purchase_return", label: "Phiếu trả hàng nhập", icon: "description", channel: "backoffice", docType: "purchase_return" },
      { id: "bo-inventory_check", label: "Phiếu kiểm kho", icon: "description", channel: "backoffice", docType: "inventory_check" },
      { id: "bo-disposal", label: "Phiếu xuất hủy", icon: "description", channel: "backoffice", docType: "disposal" },
      { id: "bo-production_order", label: "Lệnh sản xuất", icon: "description", channel: "backoffice", docType: "production_order" },
      { id: "bo-internal_sale", label: "Phiếu bán nội bộ", icon: "description", channel: "backoffice", docType: "internal_sale" },
      { id: "bo-internal_export", label: "Phiếu xuất nội bộ", icon: "description", channel: "backoffice", docType: "internal_export" },
      { id: "bo-cash_voucher", label: "Phiếu thu / chi", icon: "description", channel: "backoffice", docType: "cash_voucher" },
    ],
  },
  {
    label: "In quán F&B (bill nhiệt 80/58)",
    accent: "amber",
    items: [
      { id: "fnb-sale_invoice", label: "Bill thanh toán", icon: "receipt", channel: "fnb", docType: "sale_invoice" },
      { id: "fnb-kitchen_ticket", label: "Phiếu chế biến", icon: "receipt", channel: "fnb", docType: "kitchen_ticket" },
    ],
  },
  {
    label: "Thiết bị",
    items: [{ id: "may-in", label: "Máy in & vận hành", icon: "print" }],
  },
];

// Tra cứu nhanh mục theo id (để render đúng nội dung phải + nhãn breadcrumb).
const NAV_ITEM_BY_ID: Record<string, NavItem> = Object.fromEntries(
  PRINT_NAV.flatMap((g) => g.items).map((it) => [it.id, it]),
);

function PrintSettingsPageContent() {
  const { settings, updateSettings } = useSettings();
  const print = settings.print;
  const { toast } = useToast();
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState<string>("");
  // CEO 04/06/2026 — Sprint 5 multi-printer: 2 slot riêng (cashier + kitchen).
  // User có thể trỏ vào cùng 1 device (1 máy in chung) hoặc 2 device khác nhau.
  const [storedCashier, setStoredCashier] = useState<StoredPrinter | null>(null);
  const [storedKitchen, setStoredKitchen] = useState<StoredPrinter | null>(null);
  const [webusbSupported, setWebusbSupported] = useState(false);
  const [connecting, setConnecting] = useState<PrinterRole | null>(null);
  const sameDevice = isSamePrinterAcrossRoles();
  // Sprint TEMPLATE-1: logo doanh nghiệp + footer hoá đơn — load + save qua
  // tenants.settings.business_info (cùng nguồn với /he-thong/thiet-lap).
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [invoiceFooter, setInvoiceFooter] = useState<string>("");
  const [invoiceTitle, setInvoiceTitle] = useState<string>("");
  const [invoiceFields, setInvoiceFields] = useState<InvoiceFieldFlags>({});
  const [logoSaving, setLogoSaving] = useState(false);
  // Cài đặt In V3 (CEO 30/06): master–detail — `selected` = id mục nav đang chọn.
  const [selected, setSelected] = useState<string>("may-in");
  const [printerSection, setPrinterSection] = useState<"branch" | "slips" | "device">("branch");
  // Mobile: nav trái thu lại thành accordion → cờ mở/đóng.
  const [navOpen, setNavOpen] = useState(false);
  const selectedItem = NAV_ITEM_BY_ID[selected] ?? PRINT_NAV[0].items[0];

  const update = (values: Partial<typeof print>) => {
    updateSettings("print", values);
  };

  // Load stored printers + check WebUSB support on mount
  useEffect(() => {
    setWebusbSupported(isWebUsbSupported());
    setStoredCashier(loadPrinterByRole("cashier"));
    setStoredKitchen(loadPrinterByRole("kitchen"));
  }, []);

  // Sprint TEMPLATE-1: load logo + footer từ tenant settings
  useEffect(() => {
    let cancelled = false;
    getTenantBusinessInfo()
      .then((info) => {
        if (cancelled) return;
        setLogoUrl(info.logoUrl ?? null);
        setInvoiceFooter(info.invoiceFooter ?? "");
        setInvoiceTitle(info.invoiceTitle ?? "");
        setInvoiceFields(info.invoiceFields ?? {});
      })
      .catch(() => {
        // Silent — UI vẫn render với defaults
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogoChange = useCallback(
    async (url: string | null) => {
      setLogoUrl(url);
      setLogoSaving(true);
      try {
        await updateTenantBusinessInfo({ logoUrl: url ?? "" });
        toast({
          variant: "success",
          title: url ? "Đã cập nhật logo" : "Đã xoá logo",
          description: url
            ? "Logo sẽ tự xuất hiện trên hoá đơn + phiếu in"
            : "Hoá đơn sẽ in không có logo",
        });
      } catch (err) {
        toast({
          variant: "error",
          title: "Lỗi lưu logo",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
        });
      } finally {
        setLogoSaving(false);
      }
    },
    [toast],
  );

  const handleFooterSave = useCallback(async () => {
    setLogoSaving(true);
    try {
      await updateTenantBusinessInfo({ invoiceFooter });
      toast({
        variant: "success",
        title: "Đã lưu lời cảm ơn",
        description: "Sẽ in ở cuối hoá đơn từ giờ trở đi",
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu lời cảm ơn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setLogoSaving(false);
    }
  }, [invoiceFooter, toast]);

  const handleTitleSave = useCallback(async () => {
    setLogoSaving(true);
    try {
      await updateTenantBusinessInfo({ invoiceTitle: invoiceTitle.trim() });
      toast({
        variant: "success",
        title: "Đã lưu tiêu đề phiếu",
        description: `Phiếu bán sẽ in tiêu đề "${invoiceTitle.trim() || "PHIẾU THANH TOÁN"}"`,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu tiêu đề",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setLogoSaving(false);
    }
  }, [invoiceTitle, toast]);

  const handleFieldsSave = useCallback(async () => {
    setLogoSaving(true);
    try {
      await updateTenantBusinessInfo({ invoiceFields });
      toast({
        variant: "success",
        title: "Đã lưu hiển thị phiếu",
        description: "Phiếu bán sẽ in đúng các dòng anh bật/tắt",
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi lưu hiển thị",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setLogoSaving(false);
    }
  }, [invoiceFields, toast]);

  const handleConnectUsbPrinter = async (role: PrinterRole) => {
    setConnecting(role);
    try {
      const printer = await requestPrinter();
      if (printer) {
        savePrinterByRole(printer, role);
        const stored: StoredPrinter = {
          ...printer,
          role,
          connectedAt: new Date().toISOString(),
        };
        if (role === "cashier") setStoredCashier(stored);
        else setStoredKitchen(stored);
        toast({
          title: role === "cashier" ? "Đã chọn máy in thu ngân" : "Đã chọn máy in bếp",
          description: `${printer.manufacturer} — ${printer.name}`,
          variant: "success",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "Không kết nối được máy in",
        description: msg,
        variant: "error",
      });
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnectUsbPrinter = (role: PrinterRole) => {
    clearPrinterByRole(role);
    if (role === "cashier") setStoredCashier(null);
    else setStoredKitchen(null);
    toast({
      title: role === "cashier" ? "Đã ngắt máy in thu ngân" : "Đã ngắt máy in bếp",
      variant: "info",
    });
  };

  /** Mirror cashier printer sang kitchen slot (dùng chung 1 máy). */
  const handleMirrorCashierToKitchen = () => {
    if (!storedCashier) return;
    savePrinterByRole(
      {
        vendorId: storedCashier.vendorId,
        productId: storedCashier.productId,
        name: storedCashier.name,
        manufacturer: storedCashier.manufacturer,
        serialNumber: storedCashier.serialNumber,
      },
      "kitchen",
    );
    setStoredKitchen({ ...storedCashier, role: "kitchen" });
    toast({
      title: "Đã dùng chung 1 máy in",
      description: "Máy in thu ngân + bếp cùng 1 thiết bị. Phiếu thu ngân + phiếu bếp sẽ in lần lượt.",
      variant: "success",
    });
  };

  const handleTestPrint = async () => {
    setTestStatus("testing");
    setTestError("");
    try {
      const paperSize = print.paperSize as PaperSize;
      const result = await sendPrintJob({html: generateDocumentHtml({documentType:"IN THỬ ONEBIZ",documentCode:"TEST",date:new Date().toISOString(),items:[{name:"Cà phê sữa đá",quantity:2,total:70000,note:"Đường: 70% • Đá: ít"}],showSignature:false,note:"Kiểm tra chữ, lề, khổ giấy và đúng máy trước khi sử dụng."},paperSize),paperSize,role:"cashier"});
      if (result.success) {
        setTestStatus("success");
        if (result.fallback) {
          setTestError(result.warning ?? "");
        }
      } else {
        setTestStatus("error");
        setTestError(result.warning ?? "Lỗi in thử");
      }

    } catch (err) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : String(err));

    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt in ấn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cấu hình máy in, khổ giấy và mẫu in cho POS &amp; F&amp;B
        </p>
      </div>

      <details className="rounded-md border bg-background px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-primary">Phạm vi: máy này · chi nhánh · mẫu dùng chung</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3 text-sm" aria-label="Phạm vi cấu hình in">
        <div className="border-l-4 border-primary bg-primary/5 px-3 py-2"><strong className="text-primary">Máy / trình duyệt này</strong><p>Phương thức in, kết nối USB, khổ giấy và tự in ở mục Máy in &amp; vận hành. Các lựa chọn này lưu ngay trên trình duyệt hiện tại.</p></div>
        <div className="border-l-4 border-status-success bg-status-success/5 px-3 py-2"><strong className="text-status-success">Chi nhánh được chọn</strong><p>Thông tin chi nhánh và trạm Bar/Bếp. Kiểm tra tên chi nhánh trong từng mục trước khi lưu.</p></div>
        <div className="border-l-4 border-status-warning bg-status-warning/5 px-3 py-2"><strong className="text-status-warning">Mẫu và thương hiệu dùng chung</strong><p>Thông tin doanh nghiệp dùng chung. Mẫu in có phạm vi riêng theo chi nhánh hoặc dùng chung; xem phạm vi tại danh sách mẫu.</p></div>
      </div>
      </details>

      {/* ── Master–detail (CEO 30/06): nav trái + khung sửa/xem trước phải ── */}
      <div className="flex flex-col gap-3">
        {/* CỘT TRÁI — nav danh sách (sticky desktop, accordion mobile) */}
        <PrintSettingsNav
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setNavOpen(false);
          }}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          selectedItem={selectedItem}
        />

        {/* CỘT PHẢI — nội dung của mục đang chọn */}
        <div className="min-w-0 flex-1 space-y-4">

      {/* ── Mục có channel + docType → quản lý mẫu in ngữ cảnh cố định ── */}
      {selectedItem.channel && selectedItem.docType && (
        <PrintTemplateManager
          key={selectedItem.id}
          fixedChannel={selectedItem.channel}
          fixedDocType={selectedItem.docType}
        />
      )}

      {selected === "may-in" && (<>
      <div className="space-y-2"><p className="text-sm text-muted-foreground">Bắt đầu với kết nối chi nhánh để điện thoại và máy quầy cùng gửi phiếu, không chọn máy mỗi lần.</p><div role="group" aria-label="Nhóm cài đặt máy in" className="flex flex-wrap gap-2">{([{id:"branch",label:"Máy in chi nhánh"},{id:"slips",label:"Mẫu phiếu & tự động in"},{id:"device",label:"Nâng cao: in từ máy này"}] as const).map(item => <Button key={item.id} className="min-h-11" variant={printerSection===item.id ? "default" : "outline"} aria-pressed={printerSection===item.id} onClick={() => setPrinterSection(item.id)}>{item.label}</Button>)}</div></div>
      {printerSection === "branch" && <BranchPrintSetup />}
      </>)}
      {selected === "may-in" && printerSection === "device" && (<>
      {/* ── 0. Print Backend (MỚI) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="tune" />
            In riêng từ máy / trình duyệt này
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
            {backends.map((b) => {
              const isActive = print.backend === b.id;
              const disabled = b.id === "escpos-usb" && !webusbSupported;
              return (
                <button
                  key={b.id}
                  type="button"
                  disabled={disabled || testStatus === "testing"}
                  onClick={() => { update({ backend: b.id }); setTestError(""); setTestStatus("idle"); }}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                    isActive
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      name={b.icon}
                      className={cn(isActive ? "text-primary" : "text-muted-foreground")}
                    />
                    <span className="text-sm font-semibold">{b.label}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{b.desc}</span>
                  {disabled && (
                    <span className="mt-1 text-xs text-status-warning">
                      Trình duyệt hiện tại không hỗ trợ WebUSB — vui lòng dùng Chrome/Edge
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {print.backend === "qz-tray" && <div className="space-y-3">
            <div className="border-l-4 border-status-info bg-status-info/10 p-3 text-sm space-y-1">
              <p className="font-semibold text-status-info">Thiết lập trên máy quầy Windows / macOS / Linux</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Kết nối máy in với máy tính: cắm USB, thêm máy LAN/Wi-Fi theo IP, hoặc ghép Bluetooth; cài driver và in thử từ hệ điều hành.</li>
                <li>Cài và mở <a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="font-semibold text-primary underline">QZ Tray</a> trên cùng máy đang mở Onebiz.</li>
                <li>Bấm Tìm máy, cấp quyền khi QZ Tray hỏi, chọn máy theo vai trò rồi in thử đúng khổ giấy.</li>
              </ol>
              <p>Bản tích hợp hiện cần xác nhận quyền của QZ Tray khi được hỏi. Chưa có chữ ký để bỏ toàn bộ hộp thoại. Điện thoại/tablet không dùng cầu nối localhost của máy quầy.</p>
              <p>Bluetooth chỉ dùng được khi driver tạo máy in trong hệ điều hành; không phải kết nối Bluetooth trực tiếp từ web. Chưa kiểm chứng mọi model. Ngăn kéo ở chế độ này cấu hình qua driver nếu máy hỗ trợ.</p>
            </div>
            <BridgePrinterSetup role="cashier" label="Thu ngân — bill / tạm tính / báo cáo ca" paperSize={print.paperSize as PaperSize} />
            <BridgePrinterSetup role="kitchen" label="Bếp / Bar — máy chung" paperSize={print.paperSize as PaperSize} />
            <BridgePrinterSetup role="documents" label="Chứng từ ERP — A4 / A5" paperSize="A4" />
          </div>}

          {/* USB Printer connection UI — CEO 04/06/2026 Sprint 5: 2 slot */}
          {print.backend === "escpos-usb" && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
              {/* Tip banner */}
              <div className="rounded-lg bg-status-info/10 border border-status-info/25 p-3 text-xs space-y-1">
                <p className="font-semibold text-status-info">
                  💡 Có 2 ô cài đặt máy in — anh có thể trỏ vào cùng 1 máy HOẶC 2 máy khác nhau
                </p>
                <p className="text-muted-foreground">
                  <strong>Dùng chung 1 máy:</strong> hoá đơn thu ngân + phiếu bếp in lần lượt trên cùng 1 máy.
                  Bếp xé giấy ra dán riêng.
                  <br />
                  <strong>Dùng 2 máy riêng:</strong> phiếu cho khách in ở quầy, phiếu bếp in thẳng tại bếp.
                </p>
              </div>

              {/* Slot 1: CASHIER */}
              <PrinterSlotCard
                role="cashier"
                label="Máy in thu ngân"
                sublabel="In hoá đơn cho khách (có giá, tổng tiền)"
                icon="point_of_sale"
                stored={storedCashier}
                onConnect={() => handleConnectUsbPrinter("cashier")}
                onDisconnect={() => handleDisconnectUsbPrinter("cashier")}
                connecting={connecting === "cashier"}
                webusbSupported={webusbSupported}
              />

              {/* Slot 2: KITCHEN */}
              <PrinterSlotCard
                role="kitchen"
                label="Máy in bếp / bar"
                sublabel="In phiếu pha chế; giá theo kiểu phiếu, giữ tuỳ chọn và ghi chú"
                icon="restaurant"
                stored={storedKitchen}
                onConnect={() => handleConnectUsbPrinter("kitchen")}
                onDisconnect={() => handleDisconnectUsbPrinter("kitchen")}
                connecting={connecting === "kitchen"}
                webusbSupported={webusbSupported}
                extraAction={
                  storedCashier && !storedKitchen ? (
                    <Button size="sm" variant="outline" onClick={handleMirrorCashierToKitchen}>
                      <Icon name="content_copy" size={14} className="mr-1" />
                      Dùng chung máy thu ngân
                    </Button>
                  ) : null
                }
              />

              {/* Badge: 2 slot trỏ cùng 1 device */}
              {sameDevice && (
                <div className="rounded-lg bg-status-success/10 border border-status-success/25 p-2 text-xs flex items-center gap-2">
                  <Icon name="info" size={14} className="text-status-success" />
                  <span className="text-status-success font-medium">
                    Đã chọn cùng một máy. Bill và phiếu bếp gửi theo thao tác và chế độ tự in đã bật.
                  </span>
                </div>
              )}

              <Separator />

              <Toggle
                checked={print.openCashDrawer}
                onCheckedChange={(v) => update({ openCashDrawer: v })}
                label="Mở ngăn kéo tiền mặt"
                description="Tự động mở ngăn kéo khi thanh toán tiền mặt (cần máy in thu ngân có cổng RJ11/RJ12 kết nối drawer)"
              />

              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-medium">Lưu ý:</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  <li>WebUSB chỉ hoạt động trên Chrome, Edge, Opera (desktop + Android)</li>
                  <li>Yêu cầu HTTPS hoặc localhost</li>
                  <li>Khi reload trang, có thể phải kết nối lại (tuỳ browser)</li>
                  <li>Nếu máy in lỗi → hệ thống tự in qua trình duyệt → không mất đơn</li>
                </ul>
              </div>
            </div>
          )}

          {/* Test print */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <PrinterTestPreview paperSize={print.paperSize as PaperSize} />
            <Button
              variant="default"
              onClick={handleTestPrint}
              disabled={testStatus === "testing"}
            >
              <Icon name="print" size={16} className="mr-1" />
              {testStatus === "testing" ? "Đang in..." : "In thử"}
            </Button>
            {testStatus === "success" && (
              <span className="flex items-center gap-1 text-sm text-status-success">
                <Icon name="check_circle" size={16} /> Đã gửi lệnh in
              </span>
            )}
            {testStatus === "error" && (
              <span className="text-sm text-status-error">{testError || "Lỗi — kiểm tra kết nối"}</span>
            )}
          </div>
          {testStatus === "success" && testError && (
            <p className="text-xs text-status-warning">{testError}</p>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Paper Size ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="description" />
            Khổ giấy
            <HelpTip>
              <strong>58mm</strong>: máy in nhỏ, ít phổ biến.<br />
              <strong>80mm</strong>: chuẩn FnB Việt Nam (Xprinter, Epson...).<br />
              <strong>A4/A5</strong>: máy in văn phòng, dùng cho phiếu kho /
              hoá đơn VAT.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => update({ paperSize: tpl.id })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors",
                  print.paperSize === tpl.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <span className="text-lg font-bold">{tpl.label}</span>
                <span className="text-xs text-muted-foreground">{tpl.desc}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      </>)}

      {selected === "doanh-nghiep" && (<>
      {/* ── Hoàn thiện thông tin in (PM 25/06): chủ động nhắc điền đủ logo/MST ── */}
      <PrintSetupChecklist />
      {/* ── Tiêu đề phiếu bán hàng (CEO 24/06) — đặt tên chứng từ ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="receipt_long" />
            Tiêu đề phiếu bán hàng
            <HelpTip>
              Tên in to ở đầu phiếu bán (mặc định &quot;PHIẾU THANH TOÁN&quot;).
              Đây là chứng từ nội bộ, KHÔNG phải hoá đơn GTGT (hoá đơn đỏ) — nên
              tránh đặt &quot;HOÁ ĐƠN GTGT&quot;.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {["PHIẾU THANH TOÁN", "PHIẾU BÁN HÀNG", "HOÁ ĐƠN"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setInvoiceTitle(t)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  (invoiceTitle || "PHIẾU THANH TOÁN") === t
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={invoiceTitle}
              onChange={(e) => setInvoiceTitle(e.target.value)}
              placeholder="PHIẾU THANH TOÁN"
              maxLength={40}
              className="max-w-xs"
            />
            <Button size="sm" onClick={handleTitleSave} disabled={logoSaving}>
              Lưu tiêu đề
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Áp dụng cho phiếu in từ danh sách Hoá đơn. Để trống = &quot;PHIẾU
            THANH TOÁN&quot;.
          </p>
        </CardContent>
      </Card>

      {/* ── Hiển thị trên phiếu bán (CEO 24/06) — bật/tắt từng dòng ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="visibility" />
            Hiển thị trên phiếu bán
            <HelpTip>
              Bật/tắt từng dòng thông tin BÊN BÁN + BÊN MUA in trên phiếu bán
              hàng. Tắt dòng nào thì phiếu in ẩn dòng đó. Mặc định bật hết.
              Áp dụng cho phiếu in từ danh sách Hoá đơn.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {INVOICE_FIELD_GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-sm font-semibold mb-1">{g.title}</h4>
              <div className="divide-y">
                {g.items.map((it) => (
                  <Toggle
                    key={it.key}
                    checked={invoiceFields[it.key] !== false}
                    onCheckedChange={(v) =>
                      setInvoiceFields((prev) => ({ ...prev, [it.key]: v }))
                    }
                    label={it.label}
                  />
                ))}
              </div>
            </div>
          ))}
          <Button size="sm" onClick={handleFieldsSave} disabled={logoSaving}>
            Lưu hiển thị
          </Button>
        </CardContent>
      </Card>
      </>)}

      {selected === "doanh-nghiep" && (<>
      {/* ── Sprint TEMPLATE-1: Logo + Lời cảm ơn (CEO 07/05) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="image" />
            Logo &amp; Lời cảm ơn
            <HelpTip>
              Logo + lời cảm ơn xuất hiện đầu / cuối hoá đơn POS, phiếu tạm
              tính, phiếu kho. Cài 1 lần là dùng cho mọi loại phiếu in.
              Lưu vào <code>tenants.settings.business_info</code>, anh có thể
              chỉnh thêm tại Hệ thống → Thiết lập chung.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1">
              Logo doanh nghiệp
              <HelpTip>
                Khuyến nghị: PNG nền trong suốt (transparent) hoặc SVG. Kích
                thước hợp lý 200-400px rộng × 80-120px cao. Logo sẽ tự co theo
                khổ giấy (max-height 30px cho 80mm, 60px cho A4).
              </HelpTip>
            </label>
            <BusinessLogoUpload value={logoUrl} onChange={handleLogoChange} />
            <p className="text-xs text-muted-foreground">
              Hoặc cài qua{" "}
              <Link
                href="/he-thong/thiet-lap"
                className="text-primary underline hover:no-underline"
              >
                Hệ thống → Thiết lập chung
              </Link>{" "}
              cùng các thông tin pháp lý khác (MST, địa chỉ).
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1">
              Lời cảm ơn / chân hoá đơn
              <HelpTip>
                Text in ở CUỐI hoá đơn — thường ghi cảm ơn khách / link
                Facebook / mã WiFi / chính sách đổi trả. Tối đa 200 ký tự,
                hỗ trợ xuống dòng.
              </HelpTip>
            </label>
            <Input
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              placeholder="VD: Cảm ơn quý khách! WiFi: caphe123 — Hẹn gặp lại!"
              maxLength={200}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {invoiceFooter.length}/200
              </span>
              <Button
                size="sm"
                onClick={handleFooterSave}
                disabled={logoSaving}
              >
                <Icon name="save" size={14} className="mr-1" />
                {logoSaving ? "Đang lưu..." : "Lưu lời cảm ơn"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* ── Trang con: Thông tin chi nhánh ── */}
      {selected === "chi-nhanh" && (
      /* Tầng chi nhánh: địa chỉ/SĐT in riêng từng chi nhánh (CEO 25/06) */
      <BranchPrintInfoCard />
      )}

      {selected === "may-in" && printerSection === "slips" && (<>
      {/* ── Sprint KITCHEN-1: Trạm chế biến (CEO 07/05) ── */}
      <details className="rounded-lg border bg-card p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-primary">Nâng cao: chia trạm Bar / Bếp theo món</summary><div className="mt-3">
      <KitchenStationsCard printTargetLabel={print.backend === "escpos-usb"
        ? storedKitchen
          ? storedKitchen.name || "Máy USB đã gán cho bếp"
          : storedCashier
            ? `Chưa gán máy bếp riêng; dùng máy thu ngân dự phòng (${storedCashier.name || "USB"}).`
            : "Chưa gán máy USB; nếu không có thiết bị đã lưu, sẽ mở hộp thoại in trình duyệt."
        : print.backend === "qz-tray" ? "Máy QZ Tray đã chọn ở ô Bếp / Bar; mỗi trạm có thể gán máy riêng bên dưới." : "Chọn thiết bị trong hộp thoại in của trình duyệt này."} />
      </div></details></>)}

      {selected === "doanh-nghiep" && (<>
      {/* ── 3. Receipt Content ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="receipt" />
            Nội dung phiếu in
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={print.showStoreName}
              onCheckedChange={(v) => update({ showStoreName: v })}
              label="Tên cửa hàng"
              helpTip="Hiển thị tên cửa hàng (lấy từ Cài đặt → Cửa hàng → Tên doanh nghiệp) ở đầu phiếu in. Tắt nếu phiếu đã có sẵn header in từ máy."
            />
            <Toggle
              checked={print.showStoreAddress}
              onCheckedChange={(v) => update({ showStoreAddress: v })}
              label="Địa chỉ"
              helpTip="Hiển thị địa chỉ quán dưới tên cửa hàng. Hữu ích cho khách takeaway/delivery để có thông tin liên hệ."
            />
            <Toggle
              checked={print.showStorePhone}
              onCheckedChange={(v) => update({ showStorePhone: v })}
              label="Số điện thoại"
              helpTip="Hiển thị SĐT quán trên phiếu. Tắt nếu không muốn để khách gọi thẳng (vd quán chỉ nhận đơn qua app)."
            />
            <Toggle
              checked={print.showBarcode}
              onCheckedChange={(v) => update({ showBarcode: v })}
              label="Mã vạch"
              helpTip="In barcode mã hoá đơn → quét lại để tra cứu nhanh. Phù hợp quán tích hợp với hệ thống kế toán scan barcode."
            />
            <Toggle
              checked={print.showQr}
              onCheckedChange={(v) => update({ showQr: v })}
              label="Mã QR thanh toán"
              description="Hiện QR chuyển khoản trên phiếu"
              helpTip={
                <>
                  In QR VietQR/MoMo trên phiếu → khách quét chuyển khoản dễ
                  dàng. Cần cấu hình tài khoản ngân hàng tại{" "}
                  <strong>Cài đặt → Thanh toán</strong> trước.
                </>
              }
            />
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <label className="text-sm font-medium">Chân phiếu (footer)</label>
            <Input
              value={print.receiptFooter}
              onChange={(e) => update({ receiptFooter: e.target.value })}
              placeholder="VD: Cảm ơn quý khách!"
            />
          </div>
        </CardContent>
      </Card>
      </>)}

      {selected === "may-in" && printerSection === "slips" && (<>
      {/* ── 4. FnB Print Styles ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="restaurant" />
            Cài đặt in F&amp;B
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Auto-print toggles */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Tự động in</h4>
            <div className="divide-y">
              <Toggle
                checked={print.autoPrintKitchen}
                onCheckedChange={(v) => update({ autoPrintKitchen: v })}
                label="Phiếu bếp/bar"
                description="In đơn mới và món bổ sung khi gửi bếp"
                helpTip={
                  <>
                    <strong>Bật:</strong> Bấm “Gửi bếp” trong POS FnB → phiếu
                    chế biến tự in ra ngay, nhân viên bar/bếp thấy món + bàn
                    để pha chế.
                    <br />
                    <strong>Tắt:</strong> Bấm “Gửi bếp” nhưng KHÔNG in giấy.
                    Phù hợp nếu quán dùng KDS (màn hình bếp) thay phiếu giấy.
                  </>
                }
              />
              <Toggle
                checked={print.autoPrintReceipt}
                onCheckedChange={(v) => update({ autoPrintReceipt: v })}
                label="Phiếu thanh toán"
                description="Tự động in hoá đơn sau khi thanh toán"
                helpTip="Bật để in hoá đơn cho khách ngay sau khi nhân viên xác nhận thanh toán. Tắt nếu khách không cần phiếu giấy (vd thanh toán QR + nhận hoá đơn qua email/SMS sau)."
              />
            </div>
          </div>

          <Separator />

          {/* Kitchen ticket style */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Kiểu phiếu bếp/bar</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {kitchenStyles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => update({ kitchenTicketStyle: style.id })}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    print.kitchenTicketStyle === style.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="text-sm font-medium">{style.label}</span>
                  <span className="text-xs text-muted-foreground">{style.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Thông báo lỗi máy in */}
          <div>
            <h4 className="text-sm font-semibold mb-2">
              Thông báo &amp; Lỗi máy in
              <HelpTip>
                Cấu hình OneBiz hiển thị toast khi máy in lỗi (popup trình
                duyệt bị chặn / mất kết nối WebUSB / hết giấy). Tránh trường
                hợp nhân viên tưởng đã in nhưng thực tế không in được.
              </HelpTip>
            </h4>
            <div className="divide-y">
              <Toggle
                checked={print.notifyPrintFailure}
                onCheckedChange={(v) => update({ notifyPrintFailure: v })}
                label="Hiện toast khi máy in lỗi"
                description="Bật để biết phiếu fail thay vì silent fail"
                helpTip={
                  <>
                    <strong>Bật (khuyến nghị):</strong> Khi máy in lỗi sẽ hiện
                    toast đỏ ở góc màn hình + ghi chú lý do (vd "popup chặn",
                    "máy in mất kết nối"). Nhân viên biết để in lại.
                    <br />
                    <strong>Tắt:</strong> Silent — phù hợp khi quán không có
                    máy in, dùng phần mềm để theo dõi đơn qua KDS thôi.
                  </>
                }
              />
            </div>
          </div>

          {/* Receipt style */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Kiểu phiếu thanh toán</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {receiptStyles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => update({ receiptStyle: style.id })}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    print.receiptStyle === style.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="text-sm font-medium">{style.label}</span>
                  <span className="text-xs text-muted-foreground">{style.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      </>)}

      {selected === "may-in" && printerSection === "slips" && (<>
      {/* ── 5. Preview live (CEO 13/05) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="preview" />
            Xem trước mẫu in
            <HelpTip>
              Mẫu phiếu thực tế khi in. Đổi khổ giấy (58mm/80mm) / kiểu phiếu
              ở trên → preview tự cập nhật ngay. Dùng data mẫu (2 món + 1
              topping + ghi chú) để hiển thị đủ trường hợp. Bản in thật trên
              POS sẽ dùng đúng data đơn thật.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReceiptPreviewPanel
            paperSize={print.paperSize}
            receiptStyle={print.receiptStyle}
            kitchenTicketStyle={print.kitchenTicketStyle}
            storeName={settings.store.name}
            storeAddress={settings.store.address}
            storePhone={settings.store.phone}
            footer={print.receiptFooter || invoiceFooter}
            showStoreName={print.showStoreName}
            showStoreAddress={print.showStoreAddress}
            showStorePhone={print.showStorePhone}
            showQr={print.showQr}
            bankName={settings.payment.bankName}
            bankAccount={settings.payment.bankAccount}
            bankHolder={settings.payment.bankHolder}
          />
        </CardContent>
      </Card>
      </>)}

        </div>{/* /CỘT PHẢI */}
      </div>{/* /master–detail */}
    </div>
  );
}

export default function PrintSettingsPage() {
  return (
    <PermissionPage requires={PERMISSIONS.SYSTEM_MANAGE_BRANCHES}>
      <PrintSettingsPageContent />
    </PermissionPage>
  );
}

// ──────────────────────────────────────────────────────────────
// CỘT TRÁI — nav danh sách kiểu KiotViet (master của master–detail)
// Desktop: cột sticky ~210px, border phải. Mobile: accordion gọn phía trên.
// ──────────────────────────────────────────────────────────────
function PrintSettingsNav({ selected, onSelect }: { selected: string; onSelect: (id: string) => void; navOpen: boolean; onToggleNav: () => void; selectedItem: NavItem }) {
  return <label className="block min-w-0 text-sm font-semibold text-primary">Mục cài đặt
    <select aria-label="Mục cài đặt in" value={selected} onChange={event => onSelect(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-foreground">
      {PRINT_NAV.map(group => <optgroup key={group.label} label={group.label}>{group.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
    </select>
  </label>;
}

// ── PrinterSlotCard — CEO 04/06/2026 Sprint 5 multi-printer ──
function PrinterSlotCard({
  role,
  label,
  sublabel,
  icon,
  stored,
  onConnect,
  onDisconnect,
  connecting,
  webusbSupported,
  extraAction,
}: {
  role: PrinterRole;
  label: string;
  sublabel: string;
  icon: string;
  stored: StoredPrinter | null;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
  webusbSupported: boolean;
  extraAction?: React.ReactNode;
}) {
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const testSlot = async () => {
    setTesting(true);
    try {
      const paperSize = getPrintSettings().paperSize === "58mm" ? "58mm" : "80mm";
      const result = await sendPrintJob({html:generateDocumentHtml({documentType:label,documentCode:"TEST",date:new Date().toISOString(),items:[{name:"Cà phê sữa đá",quantity:2,total:70000,note:"Đường: 70% • Đá: ít"}],showSignature:false},paperSize),paperSize,role,printer:stored ?? undefined});
      setTestMessage(result.warning ?? "Đã gửi lệnh; kiểm tra giấy tại máy.");
    } catch (error) {setTestMessage(error instanceof Error ? error.message : "Không in được.");}
    finally {setTesting(false);}
  };
  return (
    <div
      className={cn(
        "rounded-lg border p-3 bg-card",
        stored ? "border-status-success/30" : "border-dashed border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "shrink-0 h-10 w-10 rounded-lg flex items-center justify-center",
              role === "cashier"
                ? "bg-primary/10 text-primary"
                : "bg-status-warning/10 text-status-warning",
            )}
          >
            <Icon name={icon} size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold">{label}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
            {stored ? (
              <div className="mt-2 text-xs space-y-0.5">
                <p>
                  <span className="text-muted-foreground">Hiệu:</span>{" "}
                  <span className="font-medium">{stored.manufacturer}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Tên:</span>{" "}
                  <span className="font-medium">{stored.name}</span>
                </p>
                <p className="text-xs text-muted-foreground">Đã chọn; chưa xác nhận đang online.{stored.serialNumber ? ` S/N: ${stored.serialNumber}` : ""}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  VID: 0x{stored.vendorId.toString(16).padStart(4, "0")} · PID: 0x
                  {stored.productId.toString(16).padStart(4, "0")}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground italic">
                Chưa chọn thiết bị — chọn máy rồi in thử.
              </p>
            )}
            {testMessage && <p role="status" className="mt-2 text-sm text-status-info">{testMessage}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            size="sm"
            onClick={onConnect}
            disabled={connecting || !webusbSupported}
            variant={stored ? "outline" : "default"}
          >
            <Icon name="usb" size={14} className="mr-1" />
            {connecting ? "Đang kết nối..." : stored ? "Đổi máy" : "Kết nối"}
          </Button>
          {stored && (
            <Button size="sm" variant="ghost" onClick={onDisconnect}>
              <Icon name="link_off" size={14} className="mr-1" />
              Ngắt
            </Button>
          )}
          {stored && <Button size="sm" variant="outline" disabled={testing} onClick={testSlot}>In thử máy này</Button>}
          {extraAction}
        </div>
      </div>
    </div>
  );
}
