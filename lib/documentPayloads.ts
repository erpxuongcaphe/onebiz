import type { DocumentPayload } from './documentPrint';
import type { InventoryDocument, InventoryDocumentLine } from './inventoryDocuments';
import type { PosOrderReceipt } from './pos';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Tiền mặt',
  bank_transfer: 'Chuyển khoản',
  card: 'Thẻ',
  momo: 'MoMo',
  zalopay: 'ZaloPay',
  other: 'Khác',
};

export function buildPosInvoicePayload(receipt: PosOrderReceipt, company: DocumentPayload['company']): DocumentPayload {
  const subtotal = receipt.items.reduce((acc, i) => acc + i.quantity * i.unit_price, 0);
  const total = receipt.order.total ?? subtotal;
  const methodLabel = PAYMENT_LABELS[receipt.payment.method ?? ''] ?? receipt.payment.method ?? '';
  return {
    title: 'Hóa đơn bán hàng',
    doc_no: receipt.order.order_number,
    doc_date: receipt.order.created_at,
    branch_name: receipt.branch_name ?? undefined,
    customer_name: receipt.order.customer_name ?? undefined,
    payment_method: methodLabel,
    notes: receipt.order.notes ?? undefined,
    company,
    lines: receipt.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total: i.quantity * i.unit_price,
      note: null,
    })),
    subtotal,
    vat_rate: receipt.vat_rate ?? 0,
    vat_amount: receipt.vat_amount ?? 0,
    total,
  };
}

export function buildPaymentSlipPayload(receipt: PosOrderReceipt, company: DocumentPayload['company']): DocumentPayload {
  const total = receipt.payment.amount;
  const methodLabel = PAYMENT_LABELS[receipt.payment.method ?? ''] ?? receipt.payment.method ?? '';
  return {
    title: 'Phiếu thanh toán',
    doc_no: receipt.payment.payment_number ?? receipt.order.order_number,
    doc_date: receipt.order.created_at,
    branch_name: receipt.branch_name ?? undefined,
    customer_name: receipt.order.customer_name ?? undefined,
    payment_method: methodLabel,
    notes: receipt.order.notes ?? undefined,
    company,
    lines: [
      {
        name: `Thanh toán đơn ${receipt.order.order_number}`,
        total,
      },
    ],
    subtotal: total,
    vat_rate: 0,
    vat_amount: 0,
    total,
  };
}

export function buildInventoryDocumentPayload(params: {
  doc: InventoryDocument;
  lines: InventoryDocumentLine[];
  productNameById: Record<string, string>;
  warehouseFrom?: string | null;
  warehouseTo?: string | null;
  branchName?: string | null;
  company: DocumentPayload['company'];
}): DocumentPayload {
  const total = params.lines.reduce((acc, l) => acc + l.quantity * l.unit_cost, 0);
  const docTypeLabel = params.doc.doc_type === 'receipt' ? 'Phiếu nhập kho' : params.doc.doc_type === 'issue' ? 'Phiếu xuất kho' : 'Phiếu chuyển kho';
  return {
    title: docTypeLabel,
    doc_no: params.doc.doc_number,
    doc_date: params.doc.doc_date,
    branch_name: params.branchName ?? undefined,
    from_name: params.warehouseFrom ?? undefined,
    to_name: params.warehouseTo ?? undefined,
    notes: params.doc.notes ?? undefined,
    company: params.company,
    lines: params.lines.map((l) => ({
      name: params.productNameById[l.product_id] ?? l.product_id,
      quantity: l.quantity,
      unit_price: l.unit_cost,
      total: l.quantity * l.unit_cost,
      note: l.notes ?? null,
    })),
    subtotal: total,
    vat_rate: 0,
    vat_amount: 0,
    total,
  };
}
