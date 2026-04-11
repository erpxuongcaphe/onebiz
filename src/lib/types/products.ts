// Các kiểu dữ liệu liên quan đến hàng hoá, kho, sản xuất

export type ProductType = 'nvl' | 'sku';
export type ProductStatus = 'active' | 'inactive';

export interface Product {
  id: string;
  code: string;
  name: string;
  image?: string;
  productType: ProductType;
  hasBom: boolean;
  /** Trạng thái kinh doanh — dùng cho filter "Đang bán / Ngừng bán" */
  status?: ProductStatus;
  sellPrice: number;
  costPrice: number;
  stock: number;
  ordered: number;
  categoryId: string;
  categoryName: string;
  categoryCode?: string;
  supplierId?: string;
  supplierName?: string;
  unit: string;
  purchaseUnit?: string;
  stockUnit?: string;
  sellUnit?: string;
  shelfLifeDays?: number;
  shelfLifeUnit?: 'day' | 'month' | 'year';
  vatRate: number;
  oldCode?: string;
  groupCode?: string;
  createdAt: string;
}

// Chi tiết sản phẩm mở rộng từ danh sách sản phẩm
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

// Category with scope
export interface ProductCategory {
  id: string;
  name: string;
  code?: string;
  scope?: 'nvl' | 'sku' | 'customer' | 'supplier';
  parentId?: string;
  sortOrder: number;
  productCount?: number;
  createdAt?: string;
}

// Lịch sử xuất nhập kho
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

// Lịch sử bán hàng của sản phẩm
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

// Bảng giá
export interface PriceBook {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  status: "active" | "inactive" | "scheduled";
  statusName: string;
  productCount: number;
  createdBy: string;
  createdAt: string;
}

// Kiểm kho
export interface InventoryCheck {
  id: string;
  code: string;
  date: string;
  status: "balanced" | "unbalanced" | "processing";
  statusName: string;
  totalProducts: number;
  increaseQty: number;
  decreaseQty: number;
  increaseAmount: number;
  decreaseAmount: number;
  note?: string;
  createdBy: string;
}

// Lệnh sản xuất
export interface ManufacturingOrder {
  id: string;
  code: string;
  date: string;
  productName: string;
  productCode: string;
  quantity: number;
  status: "completed" | "processing" | "cancelled";
  statusName: string;
  costAmount: number;
  createdBy: string;
}

// Xuất huỷ
export interface DisposalExport {
  id: string;
  code: string;
  date: string;
  totalProducts: number;
  totalAmount: number;
  reason: string;
  status: "completed" | "draft";
  statusName: string;
  createdBy: string;
}

// Xuất nội bộ
export interface InternalExport {
  id: string;
  code: string;
  date: string;
  totalProducts: number;
  totalAmount: number;
  status: "completed" | "draft";
  statusName: string;
  note?: string;
  createdBy: string;
}
