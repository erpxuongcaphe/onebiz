"use client";

/**
 * ReceiptPreviewPanel — preview live cho phiếu in F&B.
 *
 * CEO 13/05: trang Cài đặt in trước đây không có preview → user phải vào
 * POS tạo đơn thử mới thấy mẫu in. Component này render sample receipt
 * dùng cùng HTML builder (`buildPreBillHtml`, `buildFnbReceiptHtml`,
 * `buildKitchenTicketHtml`) → preview 100% giống bản in thật.
 *
 * Update LIVE khi user toggle paperSize / receiptStyle / kitchenTicketStyle.
 * Dùng iframe srcDoc để isolate CSS (tránh inherit Tailwind global).
 */

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  buildPreBillHtml,
  buildFnbReceiptHtml,
  buildKitchenTicketHtml,
  type PreBillData,
  type FnbReceiptData,
  type KitchenTicketDataV2,
} from "@/lib/print-fnb";

type Tab = "receipt" | "prebill" | "kitchen";
type PaperSize = "58mm" | "80mm";

interface ReceiptPreviewPanelProps {
  paperSize: "58mm" | "80mm" | "A4" | "A5";
  receiptStyle: "minimal" | "standard" | "full";
  kitchenTicketStyle: "compact" | "standard" | "detailed";
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  footer?: string;
  showStoreName?: boolean;
  showStoreAddress?: boolean;
  showStorePhone?: boolean;
  showQr?: boolean;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
}

const SAMPLE_DATE = "2026-05-13T10:30:00";

/**
 * Mock data realistic — 2 món tiêu biểu quán cà phê + 1 topping + ghi chú.
 * Dùng để render preview, không ảnh hưởng data thật.
 */
const SAMPLE_ITEMS = [
  {
    name: "Cà phê sữa đá",
    variant: "Size L",
    quantity: 2,
    unitPrice: 35000,
    toppings: [
      { name: "Bánh mì pate", quantity: 1, price: 15000 },
    ],
    note: "Ít đường",
  },
  {
    name: "Bạc xỉu",
    quantity: 1,
    unitPrice: 32000,
    toppings: [],
    note: undefined,
  },
];

export function ReceiptPreviewPanel(props: ReceiptPreviewPanelProps) {
  const [tab, setTab] = useState<Tab>("receipt");

  // Quy đổi paperSize từ settings → preview width (58mm/80mm only — A4/A5
  // dùng cho retail invoice, FnB ticket fix 58/80).
  const previewPaper: PaperSize =
    props.paperSize === "58mm" ? "58mm" : "80mm";

  // Build HTML mỗi lần props/tab thay đổi — memo để tránh re-render thừa.
  const html = useMemo(() => {
    const common = {
      orderNumber: "KB-DEMO-001",
      tableName: "Bàn 5",
      orderType: "dine_in" as const,
      items: SAMPLE_ITEMS,
      createdAt: SAMPLE_DATE,
      cashierName: "Nguyễn Văn A",
      storeName: props.showStoreName !== false ? props.storeName ?? "Quán OneBiz Demo" : undefined,
      storeAddress: props.showStoreAddress !== false ? props.storeAddress ?? "123 Lê Lợi, Q.1, TP.HCM" : undefined,
      storePhone: props.showStorePhone !== false ? props.storePhone ?? "0912 345 678" : undefined,
      paperSize: previewPaper,
      footer: props.footer ?? "Cảm ơn quý khách — hẹn gặp lại!",
    };

    const subtotal = SAMPLE_ITEMS.reduce(
      (s, it) =>
        s +
        it.unitPrice * it.quantity +
        it.toppings.reduce((ts, t) => ts + t.price * t.quantity * it.quantity, 0),
      0,
    );

    if (tab === "prebill") {
      const data: PreBillData = {
        ...common,
        subtotal,
        discountAmount: 5000,
        deliveryFee: 0,
        total: subtotal - 5000,
      };
      return buildPreBillHtml(data);
    }

    if (tab === "kitchen") {
      const data: KitchenTicketDataV2 = {
        orderNumber: common.orderNumber,
        tableName: common.tableName,
        orderType: common.orderType,
        items: SAMPLE_ITEMS,
        createdAt: common.createdAt,
        cashierName: common.cashierName,
        style: props.kitchenTicketStyle,
        paperSize: previewPaper,
        stationName: "BAR PHA CHẾ",
        stationColor: "#0EA5E9",
        orderNote: "Khách kiêng đường — pha nhạt",
      };
      return buildKitchenTicketHtml(data);
    }

    // tab === "receipt" (default)
    const total = subtotal - 5000;
    const data: FnbReceiptData = {
      ...common,
      invoiceCode: "HD000123",
      subtotal,
      discountAmount: 5000,
      deliveryFee: 0,
      total,
      paid: total,
      change: 0,
      paymentMethod: "cash",
      customerName: "Khách lẻ",
      receiptStyle: props.receiptStyle,
      showQr: props.showQr,
      bankInfo:
        props.showQr && props.bankName && props.bankAccount
          ? {
              bankName: props.bankName,
              bankAccount: props.bankAccount,
              bankHolder: props.bankHolder ?? "",
            }
          : undefined,
    };
    return buildFnbReceiptHtml(data);
  }, [
    tab,
    previewPaper,
    props.receiptStyle,
    props.kitchenTicketStyle,
    props.storeName,
    props.storeAddress,
    props.storePhone,
    props.footer,
    props.showStoreName,
    props.showStoreAddress,
    props.showStorePhone,
    props.showQr,
    props.bankName,
    props.bankAccount,
    props.bankHolder,
  ]);

  // Khổ giấy 58mm = 220px, 80mm = 302px (cộng padding 20px hai bên thoáng).
  // Wrap trong scale 0.85 nếu 80mm để vừa sidebar.
  const containerWidth = previewPaper === "58mm" ? 240 : 322;

  return (
    <div className="flex flex-col gap-3">
      {/* Tab switcher */}
      <div className="inline-flex rounded-lg border border-outline-variant/30 bg-surface-container-low p-1 self-start">
        {([
          { id: "receipt", label: "Hoá đơn", icon: "receipt_long" },
          { id: "prebill", label: "Tạm tính", icon: "description" },
          { id: "kitchen", label: "Phiếu bếp", icon: "restaurant" },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-primary text-on-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-container",
            )}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Paper size info */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="aspect_ratio" size={14} />
        <span>
          Khổ giấy đang preview: <strong>{previewPaper}</strong>{" "}
          {previewPaper === "58mm" ? "(220px / máy in bill nhỏ)" : "(302px / máy in tiêu chuẩn)"}
        </span>
        {(props.paperSize === "A4" || props.paperSize === "A5") && (
          <span className="text-status-warning">
            • Đã chọn {props.paperSize} (preview vẫn show 80mm — F&B chỉ in nhiệt)
          </span>
        )}
      </div>

      {/* Iframe preview — isolate CSS để không inherit Tailwind global */}
      <div
        className="rounded-lg border border-outline-variant/40 bg-[#f3f4f6] p-4 overflow-auto"
        style={{ maxHeight: 600 }}
      >
        <div
          className="mx-auto bg-white shadow-md"
          style={{ width: containerWidth }}
        >
          <iframe
            srcDoc={html}
            sandbox="allow-same-origin"
            title="Receipt preview"
            className="block border-0"
            style={{
              width: containerWidth,
              height: tab === "kitchen" ? 580 : 540,
              backgroundColor: "white",
            }}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        <Icon name="info" size={12} className="inline mr-1 align-text-bottom" />
        Đây là <strong>bản preview với data mẫu</strong> (2 món + 1 topping +
        ghi chú). Đổi tab/khổ giấy/kiểu phiếu để xem mẫu cập nhật ngay.
        Bản in thật trên POS sẽ dùng đúng data đơn hàng thực tế.
      </p>
    </div>
  );
}
