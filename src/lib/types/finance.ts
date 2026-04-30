// Bút toán sổ quỹ
export interface CashBookEntry {
  id: string;
  code: string;
  date: string;
  type: "receipt" | "payment";
  typeName: string;
  category: string;
  counterparty: string;
  amount: number;
  note?: string;
  createdBy: string;
  createdByName?: string;
  /** Phương thức thanh toán (cash/transfer/card/ewallet). */
  paymentMethod?: string;
  /** Chi nhánh ghi nhận phiếu (UUID + tên đã resolve để render). */
  branchId?: string;
  branchName?: string;
  /** Liên kết tới chứng từ gốc (invoice/PO/return) — xác định reverse debt. */
  referenceType?: string;
  referenceId?: string;
}

// Giao dịch thu chi (alias vì CashBookEntry đã chứa toàn bộ field)
export type CashTransaction = CashBookEntry;
