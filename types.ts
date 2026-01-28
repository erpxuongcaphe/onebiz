export enum OrderStatus {
  PENDING = 'Chờ xử lý',
  WAITING_PICK = 'Chờ kho chuẩn bị',
  PROCESSING = 'Đang xử lý',
  COMPLETED = 'Hoàn thành',
  CANCELLED = 'Đã hủy'
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  price: number;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
  image: string;
  archived?: boolean;
}

export interface Order {
  id: string;
  customer: string;
  date: string;
  total: number;
  status: OrderStatus;
  items: number;
  // Extended fields for full ERP
  customerId?: string;
  branchId?: string;
  warehouseId?: string;
  paymentStatus?: 'pending' | 'partial' | 'paid' | 'overdue';
  amountPaid?: number;
  dueDate?: string;
}

export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface InvoicePayment {
  id: string;
  orderId: string;
  amount: number;
  method: 'cash' | 'bank_transfer' | 'card' | 'momo' | 'zalopay' | 'other';
  paidAt: string;
  reference?: string;
  notes?: string;
}

export interface AccountsReceivable {
  customerId: string;
  customerName: string;
  totalReceivable: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
  oldestInvoiceDate?: string;
}

export interface AgingReport {
  customerId: string;
  customerName: string;
  current07: number;
  days830: number;
  days3160: number;
  daysOver60: number;
  totalOutstanding: number;
}

export interface KPI {
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
  icon: any; // Lucide icon type
}

export interface Activity {
  id: string;
  user: string;
  action: string;
  target: string;
  time: string;
  type: 'order' | 'inventory' | 'system' | 'warning';
}

export enum Tab {
  DASHBOARD = 'dashboard',
  INVENTORY = 'inventory',
  ORDERS = 'orders',
  POS = 'pos',
  REPORTS = 'reports',
  FINANCE = 'finance',
  CUSTOMERS = 'customers',
  SETTINGS = 'settings'
}

export type ViewMode = 'comfort' | 'compact';
