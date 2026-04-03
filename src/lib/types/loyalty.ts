// Cài đặt tích điểm
export interface LoyaltySettings {
  id: string;
  tenantId: string;
  isEnabled: boolean;
  pointsPerAmount: number;
  amountPerPoint: number;
  redemptionPoints: number;
  redemptionValue: number;
  maxRedemptionPercent: number;
  createdAt: string;
  updatedAt: string;
}

// Hạng thành viên
export interface LoyaltyTier {
  id: string;
  name: string;
  minPoints: number;
  discountPercent: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

// Lịch sử điểm thưởng
export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  customerName?: string;
  type: "earn" | "redeem" | "adjust" | "expire";
  points: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
}
