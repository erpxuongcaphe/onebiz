// Các kiểu dữ liệu liên quan đến khách hàng

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  /** Địa chỉ đầy đủ (legacy). Auto-compose từ 5 fields structured khi save. */
  address?: string;
  // Day 17/05/2026: structured address — CEO yêu cầu tách để filter/quản lý
  houseNumber?: string;
  /** Day 18/05/2026 (CEO): tên đường tách riêng khỏi số nhà */
  street?: string;
  quarter?: string;
  ward?: string;
  province?: string;
  country?: string;
  /** Day 18/05/2026 (CEO): MST cho KH doanh nghiệp khi cần xuất VAT */
  taxCode?: string;
  currentDebt: number;
  totalSales: number;
  totalSalesMinusReturns: number;
  groupId?: string;
  groupName?: string;
  /** Auto-applied discount % from customer group (0–100). */
  groupDiscountPercent?: number;
  type: "individual" | "company";
  gender?: "male" | "female";
  isInternal?: boolean;
  branchId?: string;
  /** Bảng giá B2B mặc định áp dụng khi KH này check out POS Retail. */
  priceTierId?: string;
  /** L-3: Số điểm tích lũy hiện tại — POS dùng để hiển thị + redeem. */
  loyaltyPoints?: number;
  /** Hạng thành viên (Bronze/Silver/Gold/...) — FK loyalty_tiers. */
  loyaltyTierId?: string;
  /** Tên hạng thành viên (joined từ loyalty_tiers) cho hiển thị nhanh. */
  loyaltyTierName?: string;
  /** % ưu đãi của hạng (cached từ loyalty_tiers.discount_percent). */
  loyaltyTierDiscount?: number;
  /** CEO 06/06/2026 — Migration 00131. Ngày mua hàng cuối, auto-sync qua
   *  trigger từ invoices.created_at WHERE status='completed'. */
  lastPurchaseAt?: string | null;
  /** CEO 06/06/2026 — Migration 00131. Sinh nhật cho loyalty marketing. */
  birthday?: string | null;
  /** CEO 06/06/2026 — Migration 00131. Tags tự do (VIP, dị ứng sữa,
   *  KH Shopee...). Pattern Sapo/HubSpot/Square. */
  tags?: string[];
  createdAt: string;
}

// Lịch sử mua hàng của khách hàng
export interface PurchaseHistory {
  id: string;
  invoiceCode: string;
  date: string;
  totalAmount: number;
  status: string;
  statusName: string;
  createdBy: string;
}
