// Kiểu dữ liệu liên quan đến bán hàng nội bộ giữa các chi nhánh

export interface InternalSaleItem {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  amount: number;
  note?: string;
}

export interface InternalSale {
  id: string;
  code: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  invoiceId?: string;
  inputInvoiceId?: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  subtotal: number;
  taxAmount: number;
  total: number;
  note?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  items?: InternalSaleItem[];
}
