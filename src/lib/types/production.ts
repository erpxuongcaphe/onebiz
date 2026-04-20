// Production module types — Lệnh sản xuất, BOM, Lot tracking

export interface BOM {
  id: string;
  tenantId: string;
  productId: string;
  variantId?: string;
  code?: string;
  name: string;
  version: number;
  isActive: boolean;
  batchSize: number;
  yieldQty: number;
  yieldUnit: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  productName?: string;
  productCode?: string;
  items?: BOMItem[];
  totalCost?: number;
}

export interface BOMItem {
  id: string;
  bomId: string;
  materialId: string;
  quantity: number;
  unit: string;
  wastePercent: number;
  sortOrder: number;
  note?: string;
  // Joined
  materialName?: string;
  materialCode?: string;
  materialCostPrice?: number;
  lineCost?: number;
}

export interface ProductionOrder {
  id: string;
  tenantId: string;
  code: string;
  branchId: string;
  bomId: string;
  productId: string;
  variantId?: string;
  plannedQty: number;
  completedQty: number;
  status: ProductionOrderStatus;
  lotNumber?: string;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  notes?: string;
  /** Tổng giá vốn NVL (sum unit_cost × actual_qty) — cập nhật khi tiêu hao NVL */
  cogsAmount?: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  branchName?: string;
  productName?: string;
  productCode?: string;
  bomName?: string;
  createdByName?: string;
  materials?: ProductionOrderMaterial[];
}

export type ProductionOrderStatus =
  | 'planned'
  | 'material_check'
  | 'in_production'
  | 'quality_check'
  | 'completed'
  | 'cancelled';

export interface ProductionOrderMaterial {
  id: string;
  productionOrderId: string;
  productId: string;
  plannedQty: number;
  actualQty?: number;
  unit: string;
  /** Giá vốn/đơn vị NVL (snapshot từ products.cost_price khi tiêu hao). */
  unitCost?: number;
  note?: string;
  // Joined
  productName?: string;
  productCode?: string;
  currentStock?: number;
}

export interface ProductLot {
  id: string;
  tenantId: string;
  productId: string;
  variantId?: string;
  lotNumber: string;
  sourceType: 'production' | 'purchase';
  productionOrderId?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  manufacturedDate?: string;
  expiryDate?: string;
  receivedDate: string;
  initialQty: number;
  currentQty: number;
  branchId: string;
  status: 'active' | 'expired' | 'consumed' | 'disposed';
  note?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  productName?: string;
  productCode?: string;
  branchName?: string;
  expiryStatus?: 'ok' | 'expiring_soon' | 'expired' | 'no_expiry';
  daysUntilExpiry?: number;
}

export interface LotAllocation {
  id: string;
  tenantId: string;
  lotId: string;
  sourceType: 'invoice' | 'production' | 'transfer' | 'disposal';
  sourceId: string;
  quantity: number;
  allocatedAt: string;
  allocatedBy?: string;
  // Joined
  lotNumber?: string;
  expiryDate?: string;
}

export interface BOMCostBreakdown {
  bomId: string;
  totalCost: number;
  items: {
    materialId: string;
    materialName: string;
    materialCode: string;
    quantity: number;
    unit: string;
    wastePercent: number;
    costPrice: number;
    lineCost: number;
  }[];
}

export interface ExpiringLot {
  lotId: string;
  lotNumber: string;
  productId: string;
  productName: string;
  productCode: string;
  expiryDate: string;
  currentQty: number;
  branchName: string;
  daysRemaining: number;
  isExpired: boolean;
}
