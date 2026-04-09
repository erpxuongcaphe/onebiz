// Pricing types — Price tiers, UOM conversions, packaging variants

export interface PriceTier {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description?: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
}

export interface PriceTierItem {
  id: string;
  priceTierId: string;
  productId: string;
  variantId?: string;
  price: number;
  minQty: number;
  createdAt: string;
  // Joined
  productName?: string;
  productCode?: string;
  variantName?: string;
}

export interface ProductVariant {
  id: string;
  tenantId: string;
  productId: string;
  sku?: string;
  name: string;
  packagingType?: string;
  packagingSize?: string;
  unitCount: number;
  barcode?: string;
  sellPrice: number;
  costPrice: number;
  weight?: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface UOMConversion {
  id: string;
  tenantId: string;
  productId: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  isActive: boolean;
  createdAt: string;
}

export interface BranchStock {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  variantId?: string;
  quantity: number;
  reserved: number;
  updatedAt: string;
  // Joined
  branchName?: string;
  productName?: string;
  variantName?: string;
}

// Packaging type options
export const PACKAGING_TYPES = [
  { value: 'chai', label: 'Chai' },
  { value: 'bich', label: 'Bịch' },
  { value: 'bao', label: 'Bao' },
  { value: 'thung', label: 'Thùng' },
  { value: 'hop', label: 'Hộp' },
  { value: 'can', label: 'Can' },
  { value: 'goi', label: 'Gói' },
  { value: 'loc', label: 'Lốc' },
  { value: 'lon', label: 'Lon' },
  { value: 'tui', label: 'Túi' },
] as const;

export type PackagingType = typeof PACKAGING_TYPES[number]['value'];
