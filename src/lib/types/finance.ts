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
}

// Giao dịch thu chi
export interface CashTransaction extends CashBookEntry {
  paymentMethod?: string;
  referenceId?: string;
  referenceType?: string;
}
