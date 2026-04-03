// Chương trình khuyến mãi
export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  type: "discount_percent" | "discount_fixed" | "buy_x_get_y" | "gift";
  value: number;
  minOrderAmount: number;
  buyQuantity: number | null;
  getQuantity: number | null;
  appliesTo: "all" | "category" | "product";
  appliesToIds: string[];
  startDate: string;
  endDate: string;
  isActive: boolean;
  autoApply: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}
