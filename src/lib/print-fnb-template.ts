/**
 * Bill F&B qua ENGINE MẪU IN — CEO chốt 05/07/2026.
 *
 * Trước đây bill thanh toán quán F&B in bằng bộ cứng trong print-fnb.ts,
 * KHÔNG đọc mẫu "In quán F&B" trong Cài đặt In. Helper này là cầu nối:
 * resolve mẫu (fnb × sale_invoice × chi nhánh quầy) → build DocumentPrintData
 * → in qua engine (khổ 80/58 theo mẫu, QR tự build khi mẫu bật + đủ bank).
 *
 * Trả về true nếu ĐÃ in qua mẫu; false nếu chưa có mẫu/lỗi → caller PHẢI
 * fallback printFnbReceipt cũ (không bao giờ kẹt quầy — giống POS Retail).
 *
 * Tạm tính dùng cùng mẫu sale_invoice và chỉ đổi tiêu đề/phần tiền đã thu.
 * Phiếu bếp tiếp tục dùng mẫu riêng.
 */

import { resolvePrintTemplate } from "@/lib/services";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";
import { sendPrintJob, getPrintSettings } from "@/lib/printer/print-job";
import { formatCurrency } from "@/lib/format";
import { getFnbFreeTextNote } from "@/lib/fnb-item-note";

export interface FnbBillTemplatePayload {
  billPhase?: "prebill" | "receipt";
  branchId: string | null | undefined;
  branchName?: string;
  invoiceCode: string;
  /** Nhãn bàn/đơn (vd "Bàn 5", "MV-12"). */
  tableName: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  items: {
    name: string;
    variant?: string;
    quantity: number;
    unitPrice: number;
    toppings?: { name: string; quantity: number; price: number }[];
    modifierLabels?: string[];
    note?: string;
  }[];
  subtotal: number;
  discountAmount: number;
  /** Phí giao khách trả, đã nằm trong tổng hoá đơn. */
  deliveryFee: number;
  tipAmount: number;
  /** NET quán thực thu (đơn sàn đã trừ phí; migration 00070). */
  total: number;
  paid: number;
  customerName?: string;
  cashierName?: string;
  createdAt?: string;
  deliveryPlatform?: string | null;
  platformCommissionPercent?: number;
  platformCommissionAmount?: number;
  /** Ghi chú thêm cuối bill (vd "*** IN LẠI ***"). */
  note?: string;
  paymentMethod?: string;
}

const money = (n: number) => `${formatCurrency(n)} đ`;

export async function printFnbBillWithTemplate(
  p: FnbBillTemplatePayload,
): Promise<boolean> {
  try {
    const resolved = await resolvePrintTemplate(
      "fnb",
      "sale_invoice",
      p.branchId ?? null,
    );
    if (!resolved) return false;

    const isPlatform =
      p.orderType === "delivery" &&
      !!p.deliveryPlatform &&
      p.deliveryPlatform !== "direct" &&
      (p.platformCommissionAmount ?? 0) > 0;
    const commission = isPlatform ? (p.platformCommissionAmount ?? 0) : 0;
    const gross = p.total + commission; // khách trả qua app (gross)

    // Mỗi topping là 1 dòng riêng (giữ đúng số học: tổng dòng = tạm tính).
    const items: NonNullable<DocumentPrintData["items"]> = [];
    for (const it of p.items) {
      const freeTextNote = getFnbFreeTextNote(it.note, it.modifierLabels);
      const itemNote = [...(it.modifierLabels ?? []), ...(freeTextNote ? [freeTextNote] : [])]
        .filter(Boolean)
        .join(" • ");
      items.push({
        name: it.name + (it.variant ? ` (${it.variant})` : ""),
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.quantity * it.unitPrice,
        note: itemNote || undefined,
      });
      for (const t of it.toppings ?? []) {
        if (t.quantity <= 0) continue;
        const toppingQuantity = t.quantity * it.quantity;
        items.push({
          name: `+ ${t.name}`,
          quantity: toppingQuantity,
          unitPrice: t.price,
          total: toppingQuantity * t.price,
        });
      }
    }

    const summaryRows: NonNullable<DocumentPrintData["summaryRows"]> = [
      { label: "Tạm tính", value: money(p.subtotal) },
    ];
    if (p.discountAmount > 0)
      summaryRows.push({ label: "Giảm giá", value: money(p.discountAmount) });
    if (p.deliveryFee > 0)
      summaryRows.push({ label: "Phí giao hàng", value: money(p.deliveryFee) });
    if (p.tipAmount > 0)
      summaryRows.push({ label: "Tip", value: money(p.tipAmount) });
    if (isPlatform) {
      summaryRows.push({ label: "Khách trả qua app", value: money(gross) });
      summaryRows.push({
        label: `Phí sàn ${p.platformCommissionPercent ?? 0}%`,
        value: `-${money(commission)}`,
      });
      summaryRows.push({
        label: "QUÁN THỰC THU",
        value: money(p.total),
        bold: true,
      });
    } else {
      summaryRows.push({ label: "Tổng cộng", value: money(p.total), bold: true });
      if (p.billPhase !== "prebill") {
        summaryRows.push({ label: "Tiền khách đưa", value: money(p.paid) });
        const change = p.paid - p.total;
        if (change > 0)
          summaryRows.push({ label: "Tiền thối lại", value: money(change) });
        else
          summaryRows.push({
            label: "Khách còn phải trả",
            value: money(Math.max(-change, 0)),
            tone: -change > 0 ? "danger" : "success",
          });
      }
    }

    const base: DocumentPrintData = {
      documentType: "HÓA ĐƠN THANH TOÁN", // mẫu in sẽ đè tiêu đề
      documentCode: p.invoiceCode,
      date: p.createdAt ?? new Date().toISOString(),
      branchName: p.branchName,
      headerFields: [
        {
          label: p.orderType === "delivery" ? "Đơn" : "Bàn",
          value: p.tableName,
        },
        ...(p.customerName
          ? [{ label: "Khách hàng", value: p.customerName }]
          : []),
      ],
      items,
      itemColumns: ["Tên hàng", "SL", "Đơn giá", "Thành tiền"],
      summaryRows,
      note: p.note,
      createdBy: p.cashierName,
    };

    const data = applyTemplateToDocData(base,resolved);
    if (p.billPhase === "prebill") data.documentType = "PHIẾU TẠM TÍNH";
    const result = await sendPrintJob({html:generateDocumentHtml(data,resolved.paperSize), paperSize:resolved.paperSize, role:"cashier",branchId:p.branchId ?? undefined,label:`${p.billPhase === "prebill" ? "Tạm tính" : "Bill"} ${p.invoiceCode}`.slice(0,80),buildHtml:paper=>generateDocumentHtml(data,paper),openCashDrawer:p.billPhase !== "prebill" && getPrintSettings().openCashDrawer && p.paymentMethod === "cash"});
    // A failed send is reported by the service; don't silently retry a different
    // bill/device after a bridge may already have queued the job.
    if (!result.success) console.warn("[printFnbBillWithTemplate]",result.warning);
    return true;
  } catch (err) {
    console.warn("[printFnbBillWithTemplate] fallback bill nhiệt cũ:", err);
    return false;
  }
}
