import { OrderStatus, Product, Order, KPI, Activity } from './types';
import { DollarSign, Package, ShoppingCart, Users } from 'lucide-react';

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Ghế Công Thái Học ErgoPro', sku: 'FUR-001', category: 'Nội thất', stock: 45, price: 4500000, status: 'In Stock', image: 'https://picsum.photos/100/100?random=1' },
  { id: '2', name: 'Bàn Đứng Thông Minh', sku: 'FUR-002', category: 'Nội thất', stock: 12, price: 8900000, status: 'Low Stock', image: 'https://picsum.photos/100/100?random=2' },
  { id: '3', name: 'Đèn Bàn LED Chống Cận', sku: 'LIG-001', category: 'Đèn', stock: 120, price: 650000, status: 'In Stock', image: 'https://picsum.photos/100/100?random=3' },
  { id: '4', name: 'Giá Đỡ Laptop Nhôm', sku: 'ACC-005', category: 'Phụ kiện', stock: 0, price: 350000, status: 'Out of Stock', image: 'https://picsum.photos/100/100?random=4' },
  { id: '5', name: 'Bàn Phím Cơ Keychron', sku: 'TEC-008', category: 'Công nghệ', stock: 25, price: 2100000, status: 'In Stock', image: 'https://picsum.photos/100/100?random=5' },
];

export const MOCK_ORDERS: Order[] = [
  { id: '#ORD-7782', customer: 'Nguyễn Văn A', date: '2023-10-24', total: 5150000, status: OrderStatus.COMPLETED, items: 2 },
  { id: '#ORD-7783', customer: 'Trần Thị B', date: '2023-10-24', total: 8900000, status: OrderStatus.PROCESSING, items: 1 },
  { id: '#ORD-7784', customer: 'Lê Văn C', date: '2023-10-23', total: 350000, status: OrderStatus.PENDING, items: 1 },
  { id: '#ORD-7785', customer: 'Phạm Thị D', date: '2023-10-23', total: 12500000, status: OrderStatus.COMPLETED, items: 4 },
  { id: '#ORD-7786', customer: 'Công ty TNHH XYZ', date: '2023-10-22', total: 45000000, status: OrderStatus.CANCELLED, items: 10 },
];

export const MOCK_ACTIVITIES: Activity[] = [
  { id: '1', user: 'Nguyễn Admin', action: 'đã tạo đơn hàng mới', target: '#ORD-7787', time: '5 phút trước', type: 'order' },
  { id: '2', user: 'Trần Kho', action: 'cập nhật tồn kho', target: 'Ghế Công Thái Học', time: '12 phút trước', type: 'inventory' },
  { id: '3', user: 'Hệ thống', action: 'cảnh báo sắp hết hàng', target: 'Bàn Đứng Thông Minh', time: '30 phút trước', type: 'warning' },
  { id: '4', user: 'Lê Sale', action: 'đã hủy đơn hàng', target: '#ORD-7786', time: '1 giờ trước', type: 'order' },
  { id: '5', user: 'Nguyễn Admin', action: 'đã đăng nhập', target: 'IP: 192.168.1.1', time: '2 giờ trước', type: 'system' },
];

export const REVENUE_DATA = [
  { name: 'T2', value: 12000000 },
  { name: 'T3', value: 18000000 },
  { name: 'T4', value: 15000000 },
  { name: 'T5', value: 24000000 },
  { name: 'T6', value: 32000000 },
  { name: 'T7', value: 45000000 },
  { name: 'CN', value: 38000000 },
];

export const CATEGORY_DATA = [
  { name: 'Nội thất', value: 45 },
  { name: 'Công nghệ', value: 30 },
  { name: 'Phụ kiện', value: 15 },
  { name: 'Khác', value: 10 },
];

// Helper to format currency VND
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};