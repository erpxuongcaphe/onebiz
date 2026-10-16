const CATEGORY_LABELS: Record<string, string> = {
  customer_payment: "Thu tiền khách hàng",
  thu_tien_khach: "Thu tiền khách hàng",
  thu_tien_mat: "Thu tiền mặt",
  thu_khac: "Thu khác",
  supplier_payment: "Chi trả NCC",
  chi_tra_ncc: "Chi trả NCC",
  supplier_advance: "Ứng trước NCC",
  customer_advance: "Khách trả trước",
  supplier_advance_refund: "NCC hoàn tiền ứng",
  customer_advance_refund: "Hoàn tiền ứng cho khách",
  purchase: "Trả tiền nhập hàng",
  invoice_payment: "Thu tiền bán hàng",
  invoice_void: "Hoàn tiền hủy hóa đơn",
  chi_phi_van_chuyen: "Chi phí vận chuyển",
  chi_phi_khac: "Chi phí khác",
  salary: "Lương nhân viên",
  rent: "Tiền thuê",
  utility: "Điện nước",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  bank_transfer: "Chuyển khoản",
  card: "Thẻ",
  ewallet: "Ví điện tử",
  other: "Khác",
};

export function cashCategoryLabel(category: string | null | undefined): string {
  if (!category) return "—";
  return CATEGORY_LABELS[category] ?? category;
}

/** Classify by stored source links, never guess from a user's free-text note. */
export function cashOperationLabel(row: {
  category?: string | null;
  referenceType?: string | null;
  advanceOriginal?: number | null;
}): string {
  if (
    row.category === "supplier_advance" ||
    row.category === "customer_advance"
  ) {
    return cashCategoryLabel(row.category);
  }
  if (
    row.referenceType === "purchase_order" &&
    ["purchase", "supplier_payment", "chi_tra_ncc"].includes(row.category ?? "")
  ) {
    return Number(row.advanceOriginal ?? 0) > 0
      ? "Trả tiền nhập hàng và ứng trước NCC"
      : "Trả tiền nhập hàng";
  }
  if (row.referenceType === "invoice" && row.category === "customer_payment") {
    return "Thu tiền bán hàng";
  }
  return cashCategoryLabel(row.category);
}

export function cashPaymentMethodLabel(
  method: string | null | undefined,
): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
