// Pricing types — Price tiers, UOM conversions, packaging variants

/**
 * Channel áp dụng tier:
 * - retail: tier gắn vào KH (B2B đại lý / quán / lẻ) — POS Retail
 * - fnb:    tier gắn vào CHI NHÁNH (quán) — POS FnB
 * - both:   dùng cho cả 2 channel
 */
export type PriceTierScope = "retail" | "fnb" | "both";

export interface PriceTier {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description?: string;
  priority: number;
  scope: PriceTierScope;
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
  /**
   * CEO 01/06/2026 — Sprint 2.1 (migration 00121) + Sprint 2.4a:
   * Mã BOM riêng cho variant. Vd Bạc xỉu size M dùng BOM "CFS-002-M"
   * (18g cà phê), size L dùng "CFS-002-L" (25g). Null = fallback BOM
   * của product cha.
   */
  bomCode?: string | null;
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
