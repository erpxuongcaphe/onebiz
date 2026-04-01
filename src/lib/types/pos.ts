// Sản phẩm trong giỏ hàng
export interface CartItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  price: number;
  discount: number;
}

// Tab đơn hàng tại quầy
export interface OrderTab {
  id: string;
  label: string;
  cart: CartItem[];
  customerId: string | null;
  customerName: string;
}

// Chế độ bán hàng
export type SaleMode = "quick" | "normal" | "delivery";

// Phương thức thanh toán
export type PaymentMethod = "cash" | "transfer" | "card";
