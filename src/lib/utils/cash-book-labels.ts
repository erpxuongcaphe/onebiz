const CATEGORY_LABELS: Record<string, string> = {
  customer_payment: "Thu bán hàng",
  thu_tien_khach: "Thu bán hàng",
  thu_tien_mat: "Thu tiền mặt",
  thu_khac: "Thu khác",
  supplier_payment: "Thanh toán NCC",
  chi_tra_ncc: "Thanh toán NCC",
  "Trả nhà cung cấp": "Thanh toán NCC",
  "Chi trả NCC": "Thanh toán NCC",
  supplier_advance: "Ứng trước NCC",
  customer_advance: "Khách trả trước",
  supplier_advance_refund: "NCC hoàn ứng",
  customer_advance_refund: "Hoàn ứng khách",
  purchase: "Thanh toán NCC",
  invoice_payment: "Thu bán hàng",
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
    return "Thanh toán NCC";
  }
  if (row.referenceType === "invoice" && row.category === "customer_payment") {
    return "Thu bán hàng";
  }
  return cashCategoryLabel(row.category);
}

export function cashPaymentSplit(row: {
  category?: string | null;
  referenceType?: string | null;
  amount: number;
  advanceOriginal?: number | null;
}) {
  const linkedPayment =
    (row.referenceType === "purchase_order" &&
      ["purchase", "supplier_payment", "chi_tra_ncc"].includes(
        row.category ?? "",
      )) ||
    (row.referenceType === "invoice" && row.category === "customer_payment");
  const advance = row.advanceOriginal;
  if (
    !linkedPayment ||
    advance == null ||
    !Number.isFinite(advance) ||
    !Number.isFinite(row.amount) ||
    advance <= 0 ||
    advance > row.amount
  )
    return null;
  return { documentAmount: row.amount - advance, advanceAmount: advance };
}

/** Shorten only known generated text; the original note remains the audit source. */
export function cashNoteSummary(
  row: {
    note?: string | null;
    status?: string;
    referenceType?: string | null;
    referenceCode?: string | null;
    refundSourceCode?: string | null;
  },
  partyName: string,
) {
  const original = row.note ?? "";
  let summary = original.trim();
  let cancellationReason = "";
  if (row.status === "cancelled") {
    const marker = /(?:^|\s)\[(?:HỦY|HỦY HOÀN ỨNG)\]\s*/.exec(summary);
    if (marker) {
      cancellationReason = summary
        .slice(marker.index + marker[0].length)
        .trim();
      summary = summary.slice(0, marker.index).trim();
    }
  }
  const prefix =
    row.referenceType === "purchase_order"
      ? "PO"
      : row.referenceType === "invoice"
        ? "HĐ"
        : null;
  if (prefix && row.referenceCode) {
    for (const suffix of [
      ` — phân bổ ${prefix} ${row.referenceCode}`,
      ` — ${prefix} ${row.referenceCode}`,
    ]) {
      if (summary.endsWith(suffix))
        summary = summary.slice(0, -suffix.length).trim();
    }
  }
  if (row.refundSourceCode && summary.endsWith(` · ${row.refundSourceCode}`)) {
    summary = summary.slice(0, -` · ${row.refundSourceCode}`.length).trim();
  }
  if (
    row.referenceType === "purchase_order" &&
    summary === `Trả nợ tổng NCC ${partyName}`
  )
    summary = "Thanh toán tiền hàng";
  if (
    row.referenceType === "invoice" &&
    summary === `Thu nợ tổng KH ${partyName}`
  )
    summary = "Thu tiền bán hàng";
  return {
    summary: summary || "Chưa ghi nội dung",
    original,
    cancellationReason,
    shortened: summary !== original.trim(),
  };
}

export function cashPaymentMethodLabel(
  method: string | null | undefined,
): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
