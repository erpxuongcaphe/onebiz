"use client";

import { useSettings } from "@/lib/contexts/settings-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import {
  requestPrinter,
  isWebUsbSupported,
  testPrint,
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
import { KitchenStationsCard } from "@/components/shared/kitchen-stations-card";
import { ReceiptPreviewPanel } from "@/components/shared/receipt-preview-panel";
import { PrintTemplateManager } from "@/components/shared/print-template-manager";
import {
  getTenantBusinessInfo,
  updateTenantBusinessInfo,
} from "@/lib/services";
import type { InvoiceFieldFlags } from "@/lib/print-templates";
import Link from "next/link";

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
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm font-medium">
          {label}
          {helpTip && <HelpTip>{helpTip}</HelpTip>}
        </span>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
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
  { id: "compact" as const, label: "Gọn", desc: "Chỉ tên món + số lượng" },
  { id: "standard" as const, label: "Tiêu chuẩn", desc: "Tên + topping + ghi chú" },
  { id: "detailed" as const, label: "Chi tiết", desc: "Đầy đủ + giá + variant" },
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
    id: "browser" as const,
    label: "Qua trình duyệt",
    desc: "Tương thích mọi máy in đã cài driver (USB / LAN / WiFi / AirPrint). Sẽ hiện hộp thoại chọn máy in.",
    icon: "print" as const,
  },
  {
    id: "escpos-usb" as const,
    label: "Máy in nhiệt USB (ESC/POS)",
    desc: "In tức thì, không popup. Tự cắt giấy + mở ngăn kéo. Hỗ trợ Xprinter, Epson TM, Sunmi, Gprinter...",
    icon: "bolt" as const,
  },
];

// ── In Pha 3: 3 tab theo blueprint (Thông tin in / Mẫu in / Máy in) ──
type PrintTab = "thong-tin" | "mau-in" | "may-in";
const PRINT_TABS: { id: PrintTab; label: string; icon: string; desc: string }[] = [
  { id: "thong-tin", label: "Thông tin in", icon: "badge", desc: "Công ty + chi nhánh + nội dung phiếu" },
  { id: "mau-in", label: "Mẫu in", icon: "description", desc: "Mẫu theo mảng × loại chứng từ × chi nhánh" },
  { id: "may-in", label: "Máy in & thiết bị", icon: "print", desc: "Máy in, khổ giấy, trạm bếp, tự động in" },
];

export default function PrintSettingsPage() {
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
  // In Pha 3 Item 5 (CEO 24/06): gom cài đặt theo kênh để rõ "đang setup cho ai".
  const [tab, setTab] = useState<PrintTab>("thong-tin");

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
        await updateTenantBusinessInfo({ logoUrl: url ?? undefined });
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
          title: role === "cashier" ? "Đã kết nối máy in thu ngân" : "Đã kết nối máy in bếp",
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
      const result = await testPrint({ backend: print.backend });
      if (result.success) {
        setTestStatus("success");
        if (result.fallback) {
          setTestError(result.warning ?? "");
        }
      } else {
        setTestStatus("error");
        setTestError(result.warning ?? "Lỗi in thử");
      }
      setTimeout(() => {
        setTestStatus("idle");
        setTestError("");
      }, 4000);
    } catch (err) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : String(err));
      setTimeout(() => {
        setTestStatus("idle");
        setTestError("");
      }, 4000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt in ấn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cấu hình máy in, khổ giấy và mẫu in cho POS &amp; F&amp;B
        </p>
      </div>

      {/* ── In Pha 3 Item 5: tab theo kênh ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {PRINT_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5 ring-2 ring-primary"
                  : "border-border hover:border-primary/50",
              )}
            >
              <Icon
                name={t.icon}
                size={22}
                className={active ? "text-primary" : "text-muted-foreground"}
              />
              <div className="min-w-0">
                <div className={cn("text-sm font-semibold", active && "text-primary")}>
                  {t.label}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Tab Mẫu in (V3 — engine nhiều mẫu) ── */}
      {tab === "mau-in" && <PrintTemplateManager />}

      {tab === "may-in" && (<>
      {/* ── 0. Print Backend (MỚI) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="tune" />
            Phương thức in
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {backends.map((b) => {
              const isActive = print.backend === b.id;
              const disabled = b.id === "escpos-usb" && !webusbSupported;
              return (
                <button
                  key={b.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => update({ backend: b.id })}
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
                  <span className="text-xs text-muted-foreground">{b.desc}</span>
                  {disabled && (
                    <span className="mt-1 text-xs text-status-warning">
                      Trình duyệt hiện tại không hỗ trợ WebUSB — vui lòng dùng Chrome/Edge
                    </span>
                  )}
                </button>
              );
            })}
          </div>

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
                sublabel="In phiếu pha chế (KHÔNG có giá, có modifier + ghi chú)"
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
                    Đang dùng chung 1 máy in — sau thanh toán in 2 phiếu lần lượt (HĐ trước, phiếu bếp sau)
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
          <div className="flex items-center gap-3 pt-2">
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

      {tab === "thong-tin" && (<>
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

      {tab === "thong-tin" && (<>
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

      {/* ── Tầng chi nhánh: địa chỉ/SĐT in riêng từng chi nhánh (CEO 25/06) ── */}
      <BranchPrintInfoCard />
      </>)}

      {tab === "may-in" && (<>
      {/* ── Sprint KITCHEN-1: Trạm chế biến (CEO 07/05) ── */}
      <KitchenStationsCard />
      </>)}

      {tab === "thong-tin" && (<>
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

      {tab === "may-in" && (<>
      {/* ── 4. FnB Print Styles ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="restaurant" />
            Cài đặt in F&amp;B
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto-print toggles */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Tự động in</h4>
            <div className="divide-y">
              <Toggle
                checked={print.autoPrintKitchen}
                onCheckedChange={(v) => update({ autoPrintKitchen: v })}
                label="Phiếu bếp/bar"
                description="Tự động in phiếu khi gửi bếp"
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

      {tab === "may-in" && (<>
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
    </div>
  );
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
                <p className="text-[11px] text-muted-foreground font-mono">
                  VID: 0x{stored.vendorId.toString(16).padStart(4, "0")} · PID: 0x
                  {stored.productId.toString(16).padStart(4, "0")}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground italic">
                Chưa kết nối — bấm bên phải để chọn thiết bị.
              </p>
            )}
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
          {extraAction}
        </div>
      </div>
    </div>
  );
}
