const CATEGORY_LABELS: Record<string, string> = {
  customer_payment: "Thu tiền khách hàng",
  thu_tien_khach: "Thu tiền khách hàng",
  thu_tien_mat: "Thu tiền mặt",
  thu_khac: "Thu khác",
  supplier_payment: "Chi trả NCC",
  chi_tra_ncc: "Chi trả NCC",
  chi_phi_van_chuyen: "Chi phí vận chuyển",
  chi_phi_khac: "Chi phí khác",
  salary: "Lương nhân viên",
  rent: "Tiền thuê",
  utility: "Điện nước",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  ewallet: "Ví điện tử",
};

export function cashCategoryLabel(category: string | null | undefined): string {
  if (!category) return "—";
  return CATEGORY_LABELS[category] ?? category;
}

export function cashPaymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
