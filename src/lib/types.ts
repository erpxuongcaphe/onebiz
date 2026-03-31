export interface Product {
  id: string;
  code: string;
  name: string;
  image?: string;
  sellPrice: number;
  costPrice: number;
  stock: number;
  ordered: number;
  categoryId: string;
  categoryName: string;
  supplierId?: string;
  supplierName?: string;
  unit: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  currentDebt: number;
  totalSales: number;
  totalSalesMinusReturns: number;
  groupId?: string;
  groupName?: string;
  type: "individual" | "company";
  gender?: "male" | "female";
  createdAt: string;
}

export interface Invoice {
  id: string;
  code: string;
  date: string;
  returnCode?: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  totalAmount: number;
  discount: number;
  status: "processing" | "completed" | "cancelled" | "delivery_failed";
  deliveryType: "no_delivery" | "delivery";
  deliveryStatus?: "pending" | "shipping" | "delivered" | "failed";
  createdBy: string;
}

export interface PurchaseOrder {
  id: string;
  code: string;
  orderCode?: string;
  date: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  amountOwed: number;
  status: "draft" | "imported" | "cancelled";
  createdBy: string;
  importedBy?: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  currentDebt: number;
  totalPurchases: number;
  createdAt: string;
}

// Extended product detail with additional fields
export interface ProductDetail extends Product {
  barcode?: string;
  weight?: number;
  description?: string;
  minStock?: number;
  maxStock?: number;
  position?: string; // Vị trí kho
  allowSale: boolean;
  properties?: { name: string; value: string }[];
  priceBooks?: { name: string; price: number }[];
  images: string[];
}

export interface StockMovement {
  id: string;
  code: string;
  type: "import" | "export" | "adjustment" | "transfer" | "return";
  typeName: string;
  quantity: number;
  costPrice: number;
  totalAmount: number;
  date: string;
  note?: string;
  createdBy: string;
  supplierName?: string;
}

export interface SalesHistory {
  id: string;
  invoiceCode: string;
  date: string;
  customerName: string;
  quantity: number;
  sellPrice: number;
  discount: number;
  totalAmount: number;
  status: "completed" | "cancelled" | "returned";
  statusName: string;
  createdBy: string;
}

export interface QueryParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, string | string[]>;
}

export interface QueryResult<T> {
  data: T[];
  total: number;
}
